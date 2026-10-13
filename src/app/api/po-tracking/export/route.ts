import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/server/auth-helpers";

type ExportRow = {
    bl: string;
    sealine: string;
    type: string;
    eta: string | null;
    etd: string | null;
    brand: string;
    customer: string;
    pol: string;
    pod: string;
    vol: number;
    qty: number;
    amount: number | null;
    factory: string;
};

const TEMPLATE_PATH = path.join(process.cwd(), "src", "lib", "server", "templates", "po-tracking-template.xlsx");
const COLUMNS = 23; // A..W in the template
const FIRST_DATA_ROW = 2;
const TEMPLATE_DATA_ROWS = 33; // rows 2..34, total row 35

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "YYYY-MM-DD" (the date as the carrier / Odoo wrote it) -> that exact calendar day in the workbook. */
function toDate(value: string | null) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
    return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

/**
 * Fills the user's own "TRACK SAMPLE" workbook (kept as a template, with its
 * table, number formats, conditional formatting and totals row) with the
 * shipments. Columns that Odoo/tracking can't provide (Freight, Extra,
 * Released, Shipping, Paid, Docs) are left blank for manual entry, and the
 * Freight Amt / Days / Event columns keep the template's formulas.
 */
export async function POST(request: Request) {
    try {
        await getUserIdFromRequest(request);
        const body = (await request.json()) as { rows?: ExportRow[] };
        const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 5000);
        if (rows.length === 0) {
            return NextResponse.json({ error: "There are no shipments to export." }, { status: 400 });
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load((await readFile(TEMPLATE_PATH)) as unknown as ArrayBuffer);
        const sheet = workbook.getWorksheet("Tracking");
        const table = sheet?.getTable("Table1");
        if (!sheet || !table) {
            throw new Error("The Excel template is missing its Tracking sheet or table.");
        }

        // Styles of the template's first data row and totals row, reused for every row written.
        const dataStyles = Array.from({ length: COLUMNS }, (_, index) => JSON.parse(JSON.stringify(sheet.getCell(FIRST_DATA_ROW, index + 1).style)));
        const totalsRowNumber = FIRST_DATA_ROW + TEMPLATE_DATA_ROWS;
        const totalsStyles = Array.from({ length: COLUMNS }, (_, index) => JSON.parse(JSON.stringify(sheet.getCell(totalsRowNumber, index + 1).style)));
        const totalsValues = Array.from({ length: COLUMNS }, (_, index) => sheet.getCell(totalsRowNumber, index + 1).value);

        for (let rowNumber = FIRST_DATA_ROW; rowNumber <= totalsRowNumber; rowNumber += 1) {
            for (let column = 1; column <= COLUMNS; column += 1) {
                sheet.getCell(rowNumber, column).value = null;
            }
        }

        const sorted = [...rows].sort((left, right) => (toDate(left.eta)?.getTime() ?? Infinity) - (toDate(right.eta)?.getTime() ?? Infinity));
        sorted.forEach((row, index) => {
            const r = FIRST_DATA_ROW + index;
            const etd = toDate(row.etd);
            const values: Array<ExcelJS.CellValue> = [
                row.bl,
                row.sealine || null,
                row.type || "BL",
                toDate(row.eta),
                etd,
                row.brand || null,
                row.customer || null,
                row.pol || null,
                row.pod || null,
                row.vol || null,
                row.qty || null,
                row.amount && row.amount > 0 ? row.amount : null,
                null, // Freight
                null, // Extra
                { formula: `J${r}*M${r}+N${r}` }, // Freight Amt
                { formula: `_xlfn.DAYS(TODAY(),D${r})` }, // Days
                { formula: `IF(P${r}>=0,"Discharged","")` }, // Event
                null, // Released
                etd ? MONTHS[etd.getUTCMonth()] : null,
                null, // Shipping
                row.factory || null,
                null, // Paid
                null, // Docs
            ];
            values.forEach((value, column) => {
                const cell = sheet.getCell(r, column + 1);
                cell.value = value;
                cell.style = dataStyles[column];
            });
        });

        const totalsRow = FIRST_DATA_ROW + sorted.length;
        for (let column = 1; column <= COLUMNS; column += 1) {
            const cell = sheet.getCell(totalsRow, column);
            cell.value = totalsValues[column - 1];
            cell.style = totalsStyles[column - 1];
        }

        // Grow the table, its filter and the conditional formatting to the new row count.
        // (ExcelJS keeps these on the loaded model but doesn't type them.)
        const tableModel = (table as unknown as { table: { tableRef: string; autoFilterRef: string } }).table;
        tableModel.tableRef = `A1:W${totalsRow}`;
        tableModel.autoFilterRef = `A1:W${totalsRow - 1}`;
        for (const formatting of (sheet as unknown as { conditionalFormattings: Array<{ ref: string }> }).conditionalFormattings) {
            formatting.ref = formatting.ref.replace(/\d+$/, String(totalsRow));
        }
        // Cached results from the template's old rows must not be shown — let Excel recalculate on open.
        workbook.calcProperties.fullCalcOnLoad = true;

        const buffer = await workbook.xlsx.writeBuffer();
        const stamp = new Date().toISOString().slice(0, 10);
        return new NextResponse(buffer as ArrayBuffer, {
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="PO-Tracking-${stamp}.xlsx"`,
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to build the Excel file" },
            { status: 400 }
        );
    }
}

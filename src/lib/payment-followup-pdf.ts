import { documentTypeLabel, signedResidual } from "@/lib/payment-followup-items";
import type {
    PaymentFollowupAgingBucket,
    PaymentFollowupCustomerRow,
    PaymentFollowupReport,
} from "@/types/odoo";

const escapeHtml = (value: unknown) =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const fmt = (value: number) =>
    value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });


type AgingColumn = { key: PaymentFollowupAgingBucket; label: string };

/**
 * Opens the browser's print dialog on a clean, print-sized Payment Followup report
 * (choose "Save as PDF"). Done through the browser rather than a PDF library so
 * Arabic customer names render correctly.
 */
export function printPaymentFollowupPdf(input: {
    report: PaymentFollowupReport;
    customers: PaymentFollowupCustomerRow[];
    agingColumns: AgingColumn[];
    title: string;
}) {
    const { report, customers, agingColumns, title } = input;
    const currency = report.currencyCode;
    const basis = report.dateBasis === "due" ? "Due date" : "Invoice date";
    const system = report.agingSystem === "month" ? "Months" : "Days";

    const totals = report.totals;
    const summary = [
        ["Invoices due", totals.totalInvoiceDue],
        ["Unapplied payments", totals.totalUnapplied],
        ["PDC pending", totals.totalPdcPending],
        ["PDC deposited", totals.totalPdcDeposited],
        ["Payable due", totals.totalPayableDue],
        ["Net due", totals.netDue],
    ] as const;

    // Unfiltered totals describe the whole report; when the list is filtered, the matrix footer is recomputed.
    const shownTotals = agingColumns.map((column) =>
        customers.reduce((sum, customer) => sum + (customer.agingBuckets[column.key] ?? 0), 0)
    );
    const shownGrand = customers.reduce(
        (sum, customer) => sum + agingColumns.reduce((inner, column) => inner + (customer.agingBuckets[column.key] ?? 0), 0),
        0
    );

    const matrixRows = customers
        .map((customer) => {
            const total = agingColumns.reduce((sum, column) => sum + (customer.agingBuckets[column.key] ?? 0), 0);
            return `<tr>
                <td class="name">${escapeHtml(customer.customerName)}</td>
                ${agingColumns.map((column) => `<td class="num">${customer.agingBuckets[column.key] ? fmt(customer.agingBuckets[column.key]) : "–"}</td>`).join("")}
                <td class="num strong">${fmt(total)}</td>
            </tr>`;
        })
        .join("");

    const detailBlocks = customers
        .filter((customer) => customer.invoices.length > 0)
        .map((customer) => {
            const rows = customer.invoices
                .map(
                    (invoice) => `<tr>
                        <td>${escapeHtml(invoice.invoiceNumber)}</td>
                        <td>${documentTypeLabel(invoice.moveType)}</td>
                        <td>${escapeHtml(invoice.invoiceDate || "-")}</td>
                        <td>${escapeHtml(invoice.dueDate || "-")}</td>
                        <td>${escapeHtml(invoice.paymentTermsName || "-")}</td>
                        <td class="num ${invoice.daysOverdue > 0 ? "late" : ""}">${invoice.daysOverdue > 0 ? invoice.daysOverdue : "–"}</td>
                        <td class="num strong ${signedResidual(invoice) < 0 ? "credit" : ""}">${fmt(signedResidual(invoice))} ${escapeHtml(invoice.currencyCode)}</td>
                    </tr>`
                )
                .join("");
            const contact = [customer.phone, customer.email].filter(Boolean).map(escapeHtml).join(" · ");
            return `<section class="customer">
                <h3>${escapeHtml(customer.customerName)}</h3>
                <p class="muted">${[escapeHtml(customer.salespersonName), contact].filter(Boolean).join(" · ")}</p>
                <table>
                    <thead><tr><th>Document</th><th>Type</th><th>Invoice date</th><th>Due date</th><th>Terms</th><th class="num">Days overdue</th><th class="num">Residual</th></tr></thead>
                    <tbody>${rows}</tbody>
                    <tfoot><tr>
                        <td colspan="6">Invoices due ${fmt(customer.totalInvoiceDue)} · Unapplied ${fmt(customer.totalUnapplied)} · PDC pending ${fmt(customer.totalPdcPending)}</td>
                        <td class="num strong">Net ${fmt(customer.netDue)} ${escapeHtml(customer.currencyCode)}</td>
                    </tr></tfoot>
                </table>
            </section>`;
        })
        .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", "Helvetica Neue", Arial, sans-serif; color: #1c1c1e; font-size: 11px; margin: 0; }
    h1 { font-size: 20px; margin: 0; }
    h2 { font-size: 13px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
    h3 { font-size: 13px; margin: 0; }
    .muted { color: #6b6b70; margin: 2px 0 6px; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #e51a27; padding-bottom: 8px; }
    .cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-top: 10px; }
    .card { border: 1px solid #d9d9de; border-radius: 6px; padding: 6px 8px; }
    .card b { display: block; font-size: 13px; margin-top: 2px; }
    .card.net { border-color: #e51a27; background: #fff4f4; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 4px 6px; border-bottom: 1px solid #e6e6ea; text-align: left; vertical-align: top; }
    th { background: #f3f3f6; font-size: 10px; text-transform: uppercase; color: #555; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    td.name { font-weight: 600; }
    .strong { font-weight: 700; }
    .late { color: #c0392b; font-weight: 600; }
    .credit { color: #1b7f4b; }
    tfoot td, .matrix tfoot td { font-weight: 700; background: #f3f3f6; border-top: 2px solid #c9c9d0; }
    .customer { margin-top: 14px; break-inside: avoid-page; }
    .details { break-before: page; }
    tr { break-inside: avoid; }
    thead { display: table-header-group; }
</style></head><body>
    <div class="head">
        <div>
            <h1>${escapeHtml(title)}</h1>
            <p class="muted" style="margin:4px 0 0">As of ${escapeHtml(report.asOfDate)} · by ${basis.toLowerCase()} · aging in ${system.toLowerCase()} · amounts in ${escapeHtml(currency)}</p>
        </div>
        <p class="muted" style="margin:0">${customers.length} customer${customers.length === 1 ? "" : "s"}</p>
    </div>

    <div class="cards">
        ${summary
            .map(
                ([label, value]) =>
                    `<div class="card ${label === "Net due" ? "net" : ""}">${label}<b>${escapeHtml(currency)} ${fmt(value)}</b></div>`
            )
            .join("")}
    </div>

    <h2>Aged receivable</h2>
    <table class="matrix">
        <thead><tr><th>Customer</th>${agingColumns.map((column) => `<th class="num">${escapeHtml(column.label)}</th>`).join("")}<th class="num">Total</th></tr></thead>
        <tbody>${matrixRows}</tbody>
        <tfoot><tr><td>Total</td>${shownTotals.map((value) => `<td class="num">${fmt(value)}</td>`).join("")}<td class="num">${fmt(shownGrand)}</td></tr></tfoot>
    </table>

    ${detailBlocks ? `<div class="details"><h2>Open items by customer (invoices, credit notes, payments &amp; bills)</h2>${detailBlocks}</div>` : ""}
</body></html>`;

    // A hidden iframe keeps the app page untouched while the report prints.
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);

    const cleanup = () => window.setTimeout(() => frame.remove(), 1000);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
        frame.remove();
        throw new Error("Could not open the print view.");
    }

    doc.open();
    doc.write(html);
    doc.close();

    win.addEventListener("afterprint", cleanup);
    // Give the document a tick to lay out (fonts, tables) before the dialog opens.
    window.setTimeout(() => {
        win.focus();
        win.print();
        // Some browsers never fire afterprint; don't leave the frame behind.
        window.setTimeout(cleanup, 60_000);
    }, 250);
}

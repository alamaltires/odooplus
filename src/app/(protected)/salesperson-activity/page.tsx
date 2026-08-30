"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BarChart3, Download } from "lucide-react";
import {
    getSalespeople,
    getSalespersonActivityReport,
} from "@/lib/client-odoo";
import { useAuth } from "@/lib/auth-context";
import {
    OdooCustomerSummary,
    OdooInactiveCustomer,
    OdooSalesperson,
    OdooSalespersonActivityReport,
    OdooServicedCustomer,
    OdooVisitedCustomer,
} from "@/types/odoo";

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function oneMonthAgoISO() {
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    return now.toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
    if (!value) {
        return "-";
    }

    return value.replace("T", " ");
}

function formatNumber(value: number) {
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

function formatCurrency(value: number) {
    return `AED ${formatNumber(value)}`;
}

function sanitizeFileName(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "report";
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-(--line) bg-white/60 p-6 text-sm text-(--ink-soft)">
            {message}
        </div>
    );
}

function CustomerCell({ row }: { row: OdooCustomerSummary }) {
    return (
        <div>
            <p className="font-medium text-(--ink)">{row.customerName}</p>
            <p className="text-xs text-(--ink-soft)">{row.salespersonName}</p>
        </div>
    );
}

function ContactCell({ row }: { row: OdooCustomerSummary }) {
    return (
        <div className="text-sm text-(--ink-soft)">
            <p>{row.email || "-"}</p>
            <p>{row.phone || "-"}</p>
            <p>{row.city || "-"}</p>
        </div>
    );
}

function CompactContactCell({ row }: { row: OdooCustomerSummary }) {
    return (
        <div className="max-w-44 text-xs leading-5 text-(--ink-soft)">
            <p className="truncate">{row.email || "-"}</p>
            <p>{row.phone || "-"}</p>
            <p className="truncate">{row.city || "-"}</p>
        </div>
    );
}

function MetricPill({ value }: { value: string }) {
    return (
        <span className="inline-flex min-w-16 whitespace-nowrap items-center justify-center rounded-full bg-(--chip) px-3 py-1 text-sm font-medium text-(--ink)">
            {value}
        </span>
    );
}

function matchesCustomerSearch(row: OdooCustomerSummary, query: string) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }

    return [
        row.customerName,
        row.salespersonName,
        row.email,
        row.phone,
        row.city,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

function TableSearchInput({
    value,
    onChange,
    placeholder,
}: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
}) {
    return (
        <input
            type="search"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5 text-sm md:max-w-sm"
        />
    );
}

function CustomerReportButton({ customerId }: { customerId: number }) {
    return (
        <Link
            href={`/customers/${customerId}`}
            className="inline-flex whitespace-nowrap items-center justify-center rounded-full border border-(--line) px-3 py-1.5 text-xs font-medium text-(--ink) hover:bg-(--chip)"
        >
            Customer Report
        </Link>
    );
}

function TableCard({
    title,
    description,
    exportDisabled,
    exportLoading,
    onExport,
    children,
}: {
    title: string;
    description: string;
    exportDisabled: boolean;
    exportLoading: boolean;
    onExport: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="font-display text-2xl">{title}</h2>
                    <p className="text-sm text-(--ink-soft)">{description}</p>
                </div>
                <button
                    type="button"
                    onClick={onExport}
                    disabled={exportDisabled || exportLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink) disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    {exportLoading ? "Exporting..." : "Export Excel"}
                </button>
            </div>
            {children}
        </div>
    );
}

function ScrollableTable({ children }: { children: React.ReactNode }) {
    return (
        <div className="overflow-x-auto rounded-2xl border border-(--line)">
            <div className="max-h-89 overflow-y-auto">
                {children}
            </div>
        </div>
    );
}

function ServicedCustomersTable({ rows }: { rows: OdooServicedCustomer[] }) {
    if (rows.length === 0) {
        return <EmptyState message="No serviced customers were found for this salesperson in the selected period." />;
    }

    return (
        <ScrollableTable>
            <table className="min-w-full divide-y divide-(--line) text-sm">
                <thead className="sticky top-0 z-10 bg-(--chip)">
                    <tr>
                        <th className="px-4 py-3 text-left font-medium">Customer</th>
                        <th className="w-44 px-4 py-3 text-left font-medium">Contact</th>
                        <th className="px-4 py-3 text-right font-medium">Orders</th>
                        <th className="px-4 py-3 text-right font-medium">Total Sales</th>
                        <th className="px-4 py-3 text-left font-medium">Last Sale</th>
                        <th className="px-4 py-3 text-right font-medium">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-(--line) bg-white">
                    {rows.map((row) => (
                        <tr key={row.customerId}>
                            <td className="px-4 py-3 align-top"><CustomerCell row={row} /></td>
                            <td className="w-44 px-4 py-3 align-top"><CompactContactCell row={row} /></td>
                            <td className="px-4 py-3 text-right align-top">
                                <MetricPill value={formatNumber(row.orderCount)} />
                            </td>
                            <td className="px-4 py-3 text-right align-top">
                                <MetricPill value={formatCurrency(row.totalSales)} />
                            </td>
                            <td className="px-4 py-3 align-top">{formatDateTime(row.lastSaleDate)}</td>
                            <td className="px-4 py-3 text-right align-top"><CustomerReportButton customerId={row.customerId} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollableTable>
    );
}

function VisitedCustomersTable({ rows }: { rows: OdooVisitedCustomer[] }) {
    if (rows.length === 0) {
        return <EmptyState message="No CRM visits were found for this salesperson in the selected period." />;
    }

    return (
        <ScrollableTable>
            <table className="min-w-full divide-y divide-(--line) text-sm">
                <thead className="sticky top-0 z-10 bg-(--chip)">
                    <tr>
                        <th className="px-4 py-3 text-left font-medium">Customer</th>
                        <th className="px-4 py-3 text-left font-medium">Contact</th>
                        <th className="px-4 py-3 text-right font-medium">Visits</th>
                        <th className="px-4 py-3 text-left font-medium">Last Visit</th>
                        <th className="px-4 py-3 text-left font-medium">CRM Reference</th>
                        <th className="px-4 py-3 text-right font-medium">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-(--line) bg-white">
                    {rows.map((row) => (
                        <tr key={row.customerId}>
                            <td className="px-4 py-3 align-top"><CustomerCell row={row} /></td>
                            <td className="px-4 py-3 align-top"><ContactCell row={row} /></td>
                            <td className="px-4 py-3 text-right align-top">
                                <MetricPill value={formatNumber(row.visitCount)} />
                            </td>
                            <td className="px-4 py-3 align-top">{formatDateTime(row.lastVisitDate)}</td>
                            <td className="px-4 py-3 align-top">{row.crmReference || "-"}</td>
                            <td className="px-4 py-3 text-right align-top"><CustomerReportButton customerId={row.customerId} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollableTable>
    );
}

function InactiveCustomersTable({ rows }: { rows: OdooInactiveCustomer[] }) {
    if (rows.length === 0) {
        return <EmptyState message="Every assigned customer had either a sale or a CRM visit in the selected period." />;
    }

    return (
        <ScrollableTable>
            <table className="min-w-full divide-y divide-(--line) text-sm">
                <thead className="sticky top-0 z-10 bg-(--chip)">
                    <tr>
                        <th className="px-4 py-3 text-left font-medium">Customer</th>
                        <th className="px-4 py-3 text-left font-medium">Contact</th>
                        <th className="px-4 py-3 text-left font-medium">Last Visit</th>
                        <th className="px-4 py-3 text-right font-medium">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-(--line) bg-white">
                    {rows.map((row) => (
                        <tr key={row.customerId}>
                            <td className="px-4 py-3 align-top"><CustomerCell row={row} /></td>
                            <td className="px-4 py-3 align-top"><ContactCell row={row} /></td>
                            <td className="px-4 py-3 align-top">{formatDateTime(row.lastVisitDate)}</td>
                            <td className="px-4 py-3 text-right align-top"><CustomerReportButton customerId={row.customerId} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollableTable>
    );
}

const SESSION_KEY = "salesperson-activity-state";

type SavedActivityState = {
    selectedSalespersonId: string;
    startDate: string;
    endDate: string;
    report: OdooSalespersonActivityReport;
};

export default function SalespersonActivityPage() {
    const { user } = useAuth();
    const hasLoadedSalespeopleRef = useRef(false);
    const hasRestoredStateRef = useRef(false);

    const [salespeople, setSalespeople] = useState<OdooSalesperson[]>([]);
    const [salespeopleLoading, setSalespeopleLoading] = useState(true);
    const [salespeopleError, setSalespeopleError] = useState<string | null>(null);
    const [selectedSalespersonId, setSelectedSalespersonId] = useState("");

    const [startDate, setStartDate] = useState(oneMonthAgoISO);
    const [endDate, setEndDate] = useState(todayISO);

    useEffect(() => {
        try {
            const saved = sessionStorage.getItem(SESSION_KEY);
            if (saved) {
                const state = JSON.parse(saved) as SavedActivityState;
                hasRestoredStateRef.current = true;
                setSelectedSalespersonId(state.selectedSalespersonId);
                setStartDate(state.startDate);
                setEndDate(state.endDate);
                setReport(state.report);
            }
        } catch {
            // ignore corrupt storage
        }
    }, []);

    const [report, setReport] = useState<OdooSalespersonActivityReport | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState<string | null>(null);
    const [exportingTable, setExportingTable] = useState<"serviced" | "visited" | "inactive" | null>(null);
    const [servicedSearch, setServicedSearch] = useState("");
    const [visitedSearch, setVisitedSearch] = useState("");
    const [inactiveSearch, setInactiveSearch] = useState("");

    useEffect(() => {
        async function loadSalespeople() {
            if (!user) {
                hasLoadedSalespeopleRef.current = false;
                setSalespeopleLoading(false);
                return;
            }

            if (hasLoadedSalespeopleRef.current) {
                setSalespeopleLoading(false);
                return;
            }

            hasLoadedSalespeopleRef.current = true;

            try {
                const data = await getSalespeople();
                setSalespeople(data.salespeople);
                if (data.salespeople.length > 0 && !hasRestoredStateRef.current) {
                    setSelectedSalespersonId(String(data.salespeople[0].id));
                }
            } catch (error) {
                setSalespeopleError(
                    error instanceof Error ? error.message : "Failed to load salespeople."
                );
            } finally {
                setSalespeopleLoading(false);
            }
        }

        void loadSalespeople();
    }, [user]);

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        if (!selectedSalespersonId) {
            return;
        }

        setReportLoading(true);
        setReportError(null);
        setReport(null);
        setServicedSearch("");
        setVisitedSearch("");
        setInactiveSearch("");

        try {
            const data = await getSalespersonActivityReport({
                salespersonId: Number(selectedSalespersonId),
                startDate,
                endDate,
            });
            setReport(data);
            try {
                const stateToSave: SavedActivityState = { selectedSalespersonId, startDate, endDate, report: data };
                sessionStorage.setItem(SESSION_KEY, JSON.stringify(stateToSave));
            } catch {
                // ignore storage errors
            }
        } catch (error) {
            setReportError(
                error instanceof Error
                    ? error.message
                    : "Failed to generate salesperson activity report."
            );
        } finally {
            setReportLoading(false);
        }
    }

    const filteredServicedCustomers = useMemo(() => {
        if (!report) {
            return [] as OdooServicedCustomer[];
        }

        return report.servicedCustomers.filter((row) => matchesCustomerSearch(row, servicedSearch));
    }, [report, servicedSearch]);

    const filteredVisitedCustomers = useMemo(() => {
        if (!report) {
            return [] as OdooVisitedCustomer[];
        }

        return report.visitedCustomers.filter((row) => matchesCustomerSearch(row, visitedSearch));
    }, [report, visitedSearch]);

    const filteredInactiveCustomers = useMemo(() => {
        if (!report) {
            return [] as OdooInactiveCustomer[];
        }

        return report.inactiveAssignedCustomers.filter((row) => matchesCustomerSearch(row, inactiveSearch));
    }, [report, inactiveSearch]);

    const servicedSalesTotal = useMemo(
        () => filteredServicedCustomers.reduce((sum, row) => sum + row.totalSales, 0),
        [filteredServicedCustomers]
    );

    const visitedCountTotal = useMemo(
        () => filteredVisitedCustomers.reduce((sum, row) => sum + row.visitCount, 0),
        [filteredVisitedCustomers]
    );

    async function exportTable(
        table: "serviced" | "visited" | "inactive",
        rows: OdooServicedCustomer[] | OdooVisitedCustomer[] | OdooInactiveCustomer[]
    ) {
        if (!report || rows.length === 0) {
            return;
        }

        setExportingTable(table);
        setReportError(null);

        try {
            const XLSX = await import("xlsx");
            const tableNameByKey = {
                serviced: "serviced-customers",
                visited: "visited-customers",
                inactive: "inactive-customers",
            } as const;

            const exportRows =
                table === "serviced"
                    ? (rows as OdooServicedCustomer[]).map((row) => ({
                        "Customer Name": row.customerName,
                        Salesperson: row.salespersonName,
                        Email: row.email,
                        Phone: row.phone,
                        Address: row.street,
                        City: row.city,
                        Orders: row.orderCount,
                        "Total Sales": row.totalSales,
                        "Last Sale": row.lastSaleDate,
                    }))
                    : table === "visited"
                        ? (rows as OdooVisitedCustomer[]).map((row) => ({
                            "Customer Name": row.customerName,
                            Salesperson: row.salespersonName,
                            Email: row.email,
                            Phone: row.phone,
                            Address: row.street,
                            City: row.city,
                            Visits: row.visitCount,
                            "Last Visit": row.lastVisitDate,
                            "CRM Reference": row.crmReference,
                        }))
                        : (rows as OdooInactiveCustomer[]).map((row) => ({
                            "Customer Name": row.customerName,
                            Salesperson: row.salespersonName,
                            Email: row.email,
                            Phone: row.phone,
                            Address: row.street,
                            City: row.city,
                            "Last Visit": row.lastVisitDate,
                        }));

            const worksheet = XLSX.utils.json_to_sheet(exportRows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
            XLSX.writeFile(
                workbook,
                `${sanitizeFileName(report.salesperson.name)}-${tableNameByKey[table]}-${report.startDate}-to-${report.endDate}.xlsx`
            );
        } catch (error) {
            setReportError(
                error instanceof Error ? error.message : "Failed to export Excel file."
            );
        } finally {
            setExportingTable(null);
        }
    }

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">Salesperson Activity Report</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Compare serviced customers, CRM visits, and assigned inactive customers for a selected salesperson.
                    </p>
                </div>
                <BarChart3 className="h-8 w-8 text-(--brand)" aria-hidden="true" />
            </div>

            <form
                onSubmit={handleSubmit}
                className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5"
            >
                <div className="grid gap-4 md:grid-cols-4">
                    <label className="block md:col-span-2">
                        <span className="mb-2 block text-sm font-medium">Salesperson</span>
                        <select
                            value={selectedSalespersonId}
                            onChange={(event) => setSelectedSalespersonId(event.target.value)}
                            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                            disabled={salespeopleLoading || Boolean(salespeopleError)}
                            required
                        >
                            {salespeople.length === 0 ? (
                                <option value="">
                                    {salespeopleLoading ? "Loading salespeople..." : "No salespeople found"}
                                </option>
                            ) : null}
                            {salespeople.map((salesperson) => (
                                <option key={salesperson.id} value={salesperson.id}>
                                    {salesperson.name}
                                    {salesperson.email ? ` (${salesperson.email})` : ""}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">Start Date</span>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(event) => setStartDate(event.target.value)}
                            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                            required
                        />
                    </label>

                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">End Date</span>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(event) => setEndDate(event.target.value)}
                            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                            required
                        />
                    </label>
                </div>

                <div className="mt-4 flex items-center gap-3">
                    <button
                        type="submit"
                        disabled={reportLoading || !selectedSalespersonId || salespeopleLoading}
                        className="rounded-xl bg-(--brand) px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {reportLoading ? "Generating..." : "Generate Report"}
                    </button>

                    {salespeopleError ? (
                        <p className="text-sm text-red-600">{salespeopleError}</p>
                    ) : null}
                    {reportError ? <p className="text-sm text-red-600">{reportError}</p> : null}
                </div>
            </form>

            {report ? (
                <div className="mt-6 space-y-6">
                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <p className="text-sm text-(--ink-soft)">Selected salesperson</p>
                        <p className="mt-1 font-display text-2xl">{report.salesperson.name}</p>
                        <p className="mt-2 text-sm text-(--ink-soft)">
                            Period: {report.startDate} to {report.endDate}
                        </p>
                    </div>

                    <TableCard
                        title="Serviced Customers"
                        description="Customers that had confirmed sales during the selected date range."
                        exportDisabled={filteredServicedCustomers.length === 0}
                        exportLoading={exportingTable === "serviced"}
                        onExport={() => void exportTable("serviced", filteredServicedCustomers)}
                    >
                        <div className="space-y-3">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <TableSearchInput
                                    value={servicedSearch}
                                    onChange={setServicedSearch}
                                    placeholder="Search serviced customers"
                                />
                                <div className="flex flex-wrap items-center gap-3 text-sm text-(--ink-soft)">
                                    <span>{filteredServicedCustomers.length} customers</span>
                                    <MetricPill value={formatCurrency(servicedSalesTotal)} />
                                </div>
                            </div>
                            <ServicedCustomersTable rows={filteredServicedCustomers} />
                        </div>
                    </TableCard>

                    <TableCard
                        title="Visited Customers From CRM"
                        description="Customers linked to CRM activity for the selected salesperson during the selected date range."
                        exportDisabled={filteredVisitedCustomers.length === 0}
                        exportLoading={exportingTable === "visited"}
                        onExport={() => void exportTable("visited", filteredVisitedCustomers)}
                    >
                        <div className="space-y-3">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <TableSearchInput
                                    value={visitedSearch}
                                    onChange={setVisitedSearch}
                                    placeholder="Search visited customers"
                                />
                                <div className="flex flex-wrap items-center gap-3 text-sm text-(--ink-soft)">
                                    <span>{filteredVisitedCustomers.length} customers</span>
                                    <MetricPill value={formatNumber(visitedCountTotal)} />
                                </div>
                            </div>
                            <VisitedCustomersTable rows={filteredVisitedCustomers} />
                        </div>
                    </TableCard>

                    <TableCard
                        title="Assigned But Inactive Customers"
                        description="Customers assigned to the salesperson that had neither a sale nor a CRM visit during the selected date range."
                        exportDisabled={filteredInactiveCustomers.length === 0}
                        exportLoading={exportingTable === "inactive"}
                        onExport={() => void exportTable("inactive", filteredInactiveCustomers)}
                    >
                        <div className="space-y-3">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <TableSearchInput
                                    value={inactiveSearch}
                                    onChange={setInactiveSearch}
                                    placeholder="Search inactive customers"
                                />
                                <div className="flex flex-wrap items-center gap-3 text-sm text-(--ink-soft)">
                                    <span>{filteredInactiveCustomers.length} customers</span>
                                    <MetricPill value={formatNumber(filteredInactiveCustomers.length)} />
                                </div>
                            </div>
                            <InactiveCustomersTable rows={filteredInactiveCustomers} />
                        </div>
                    </TableCard>
                </div>
            ) : null}
        </section>
    );
}
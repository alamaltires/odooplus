"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Gauge, ListTree, Mail, Plus, Target, Trash2 } from "lucide-react";
import {
    getSalesTarget,
    markSalesTargetBrandMarketingEmailSent,
    saveSalesTarget,
} from "@/lib/firestore-settings";
import {
    getProductBrands,
    getSalespeople,
    sendSalesTargetEmail,
    sendSalesTargetBrandMarketingEmail,
    getSalespersonMonthlyInvoices,
} from "@/lib/client-odoo";
import { useAuth } from "@/lib/auth-context";
import {
    OdooSalesperson,
    OdooSalespersonMonthlyInvoices,
    SalesTargetBrand,
    SalesTargetRecord,
} from "@/types/odoo";

const months = [
    { value: 1, label: "January" },
    { value: 2, label: "February" },
    { value: 3, label: "March" },
    { value: 4, label: "April" },
    { value: 5, label: "May" },
    { value: 6, label: "June" },
    { value: 7, label: "July" },
    { value: 8, label: "August" },
    { value: 9, label: "September" },
    { value: 10, label: "October" },
    { value: 11, label: "November" },
    { value: 12, label: "December" },
] as const;

function formatNumber(value: number) {
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

function formatCurrency(value: number, currencyCode = "AED") {
    return `${currencyCode} ${formatNumber(value)}`;
}

function currentMonth() {
    return new Date().getMonth() + 1;
}

function currentYear() {
    return new Date().getFullYear();
}

const GENERAL_BRAND_VALUE = "general";
// Bump the "v4" suffix whenever the persisted report shape changes, so a
// stale cached report from an older build (missing newer fields, e.g.
// brandTotals) is discarded instead of silently restored with defaults.
const REPORT_STATE_STORAGE_KEY = "sales-targets:report-state:v4";

type PersistedReportState = {
    selectedSalespersonId: string;
    selectedMonth: string;
    selectedYear: string;
    includeCreditNotes: string;
    creditNotesApplied: string;
    report: OdooSalespersonMonthlyInvoices;
    target: SalesTargetRecord | null;
};

type Brand = {
    id: number;
    name: string;
};

type TargetEntryInput = {
    brandValue: string;
    targetAmount: string;
};

/**
 * Reports can be restored from sessionStorage (see REPORT_STATE_STORAGE_KEY),
 * including ones cached by an older build that didn't have the currency
 * fields below. Backfill them so rendering never has to assume they exist.
 */
function normalizeReport(report: OdooSalespersonMonthlyInvoices): OdooSalespersonMonthlyInvoices {
    return {
        ...report,
        primaryCurrencyCode: report.primaryCurrencyCode || "AED",
        currencyTotals: Array.isArray(report.currencyTotals) ? report.currencyTotals : [],
        creditNoteCurrencyTotals: Array.isArray(report.creditNoteCurrencyTotals)
            ? report.creditNoteCurrencyTotals
            : [],
        brandTotals: Array.isArray(report.brandTotals) ? report.brandTotals : [],
        creditNoteBrandTotals: Array.isArray(report.creditNoteBrandTotals) ? report.creditNoteBrandTotals : [],
    };
}

function emptyTargetEntry(): TargetEntryInput {
    return {
        brandValue: GENERAL_BRAND_VALUE,
        targetAmount: "",
    };
}

function ProgressBar({
    total,
    target,
    currencyCode,
}: {
    total: number;
    target: number;
    currencyCode: string;
}) {
    const progress = target > 0 ? Math.min((total / target) * 100, 100) : 0;
    const exceeded = Math.max(0, total - target);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-sm text-(--ink-soft)">Target Progress</p>
                    <p className="mt-1 font-display text-3xl">{formatCurrency(total, currencyCode)}</p>
                </div>
                <div className="text-right">
                    <p className="text-sm text-(--ink-soft)">Target</p>
                    <p className="mt-1 text-lg font-medium">{formatCurrency(target, currencyCode)}</p>
                    {exceeded > 0 ? (
                        <p className="mt-1 text-sm font-medium text-(--accent)">+{formatCurrency(exceeded, currencyCode)} exceeded</p>
                    ) : null}
                </div>
            </div>

            <div className="h-4 overflow-hidden rounded-full bg-(--chip)">
                <div
                    className="h-full rounded-full transition-[width] duration-700 ease-out"
                    style={{
                        width: `${progress}%`,
                        background: "linear-gradient(90deg, var(--accent), var(--brand))",
                    }}
                />
            </div>

            <div className="flex items-center justify-between text-sm text-(--ink-soft)">
                <span>{progress.toFixed(1)}% achieved</span>
                <span>{formatCurrency(Math.max(0, target - total), currencyCode)} remaining</span>
            </div>
        </div>
    );
}

export default function SalesTargetsPage() {
    const { user } = useAuth();
    const hasLoadedSalespeopleRef = useRef(false);
    const hasRestoredReportStateRef = useRef(false);

    const [salespeople, setSalespeople] = useState<OdooSalesperson[]>([]);
    const [salespeopleLoading, setSalespeopleLoading] = useState(true);
    const [salespeopleError, setSalespeopleError] = useState<string | null>(null);

    const [brands, setBrands] = useState<Brand[]>([]);
    const [brandsLoading, setBrandsLoading] = useState(false);
    const [brandsError, setBrandsError] = useState<string | null>(null);

    const [selectedSalespersonId, setSelectedSalespersonId] = useState("");
    const [selectedMonth, setSelectedMonth] = useState(String(currentMonth()));
    const [selectedYear, setSelectedYear] = useState(String(currentYear()));
    const [includeCreditNotes, setIncludeCreditNotes] = useState(false);
    const [creditNotesApplied, setCreditNotesApplied] = useState(false);

    const [report, setReport] = useState<OdooSalespersonMonthlyInvoices | null>(null);
    const [target, setTarget] = useState<SalesTargetRecord | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [setTargetOpen, setSetTargetOpen] = useState(false);
    const [targetEntries, setTargetEntries] = useState<TargetEntryInput[]>([emptyTargetEntry()]);
    const [savingTarget, setSavingTarget] = useState(false);
    const [emailModalOpen, setEmailModalOpen] = useState(false);
    const [recipientEmail, setRecipientEmail] = useState("");
    const [sendingEmail, setSendingEmail] = useState(false);
    const [sendingBrandEmailId, setSendingBrandEmailId] = useState<number | null>(null);
    const [generalBreakdownOpen, setGeneralBreakdownOpen] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const yearOptions = useMemo(() => {
        const now = currentYear();
        return Array.from({ length: 7 }, (_, index) => String(now - 3 + index));
    }, []);

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
                if (data.salespeople.length > 0) {
                    setSelectedSalespersonId((previous) => previous || String(data.salespeople[0].id));
                }
            } catch (loadError) {
                setSalespeopleError(
                    loadError instanceof Error ? loadError.message : "Failed to load salespeople."
                );
            } finally {
                setSalespeopleLoading(false);
            }
        }

        void loadSalespeople();
    }, [user]);

    useEffect(() => {
        if (!user) {
            hasRestoredReportStateRef.current = false;
            setBrands([]);
            setBrandsLoading(false);
            setBrandsError(null);

            if (typeof window !== "undefined") {
                window.sessionStorage.removeItem(REPORT_STATE_STORAGE_KEY);
            }
        }
    }, [user]);

    useEffect(() => {
        if (!user || hasRestoredReportStateRef.current || typeof window === "undefined") {
            return;
        }

        hasRestoredReportStateRef.current = true;

        try {
            const rawValue = window.sessionStorage.getItem(REPORT_STATE_STORAGE_KEY);
            if (!rawValue) {
                return;
            }

            const parsed = JSON.parse(rawValue) as Partial<PersistedReportState>;
            if (!parsed.report || !parsed.selectedSalespersonId || !parsed.selectedMonth || !parsed.selectedYear) {
                return;
            }

            setSelectedSalespersonId(String(parsed.selectedSalespersonId));
            setSelectedMonth(String(parsed.selectedMonth));
            setSelectedYear(String(parsed.selectedYear));
            setIncludeCreditNotes(parsed.includeCreditNotes === "true");
            setCreditNotesApplied(parsed.creditNotesApplied === "true");
            setReport(normalizeReport(parsed.report as OdooSalespersonMonthlyInvoices));
            setTarget((parsed.target as SalesTargetRecord | null) ?? null);
        } catch {
            window.sessionStorage.removeItem(REPORT_STATE_STORAGE_KEY);
        }
    }, [user]);

    useEffect(() => {
        if (!user || !report || typeof window === "undefined") {
            return;
        }

        const payload: PersistedReportState = {
            selectedSalespersonId,
            selectedMonth,
            selectedYear,
            includeCreditNotes: String(includeCreditNotes),
            creditNotesApplied: String(creditNotesApplied),
            report,
            target,
        };

        window.sessionStorage.setItem(REPORT_STATE_STORAGE_KEY, JSON.stringify(payload));
    }, [report, selectedMonth, selectedSalespersonId, selectedYear, includeCreditNotes, creditNotesApplied, target, user]);

    async function ensureBrandsLoaded() {
        if (!user || brands.length > 0 || brandsLoading) {
            return;
        }

        setBrandsLoading(true);
        setBrandsError(null);

        try {
            const data = await getProductBrands();
            setBrands(data.brands);
        } catch (loadError) {
            setBrandsError(
                loadError instanceof Error
                    ? loadError.message
                    : "Failed to load product brands."
            );
        } finally {
            setBrandsLoading(false);
        }
    }

    const savedTargets = useMemo(() => {
        if (!target) {
            return [] as SalesTargetBrand[];
        }

        if (target.targets.length > 0) {
            return target.targets;
        }

        if (Number.isFinite(target.targetAmount) && Number(target.targetAmount) > 0) {
            return [
                {
                    brandId: null,
                    brandName: "General",
                    targetAmount: Number(target.targetAmount),
                    isGeneral: true,
                },
            ];
        }

        return [];
    }, [target]);

    const totalTargetAmount = useMemo(
        () => savedTargets.reduce((sum, item) => sum + Number(item.targetAmount || 0), 0),
        [savedTargets]
    );

    const effectiveSales = useMemo(
        () => (report ? Number((report.totalInvoiced - (report.creditNoteTotal ?? 0)).toFixed(2)) : 0),
        [report]
    );

    const currencyCode = report?.primaryCurrencyCode || "AED";

    const unconvertedCurrencyTotals = useMemo(() => {
        if (!report) {
            return [];
        }

        return (report.currencyTotals ?? []).filter((total) => !total.includedInTotal);
    }, [report]);

    const marketingEmailsSentAt = useMemo(() => target?.marketingEmailsSentAt ?? {}, [target]);

    const brandNameById = useMemo(() => {
        const lookup = new Map<number, string>();
        for (const brand of brands) {
            lookup.set(brand.id, brand.name);
        }
        return lookup;
    }, [brands]);

    const targetedBrandIds = useMemo(() => {
        const covered = new Set<number>();
        for (const item of savedTargets) {
            if (!item.isGeneral && typeof item.brandId === "number") {
                covered.add(item.brandId);
            }
        }
        return covered;
    }, [savedTargets]);

    const targetProgressRows = useMemo(() => {
        if (!report) {
            return [];
        }

        const creditNoteBrandTotals = creditNotesApplied ? (report.creditNoteBrandTotals ?? []) : [];

        const achievedByTargetBrandId = new Map<number, number>();
        for (const item of savedTargets) {
            if (item.isGeneral || typeof item.brandId !== "number") {
                continue;
            }

            const achieved = report.brandTotals
                .filter((brandTotal) => brandTotal.brandId === item.brandId)
                .reduce((sum, brandTotal) => sum + Number(brandTotal.totalInvoiced || 0), 0);

            const creditNoteDeduction = creditNoteBrandTotals
                .filter((cnBrandTotal) => cnBrandTotal.brandId === item.brandId)
                .reduce((sum, cnBrandTotal) => sum + Number(cnBrandTotal.totalInvoiced || 0), 0);

            achievedByTargetBrandId.set(item.brandId, Number(Math.max(0, achieved - creditNoteDeduction).toFixed(2)));
        }

        const targetedAchieved = report.brandTotals.reduce((sum, brandTotal) => {
            if (targetedBrandIds.has(brandTotal.brandId)) {
                return sum + Number(brandTotal.totalInvoiced || 0);
            }

            return sum;
        }, 0);

        const targetedCreditNoteDeduction = creditNoteBrandTotals.reduce((sum, cnBrandTotal) => {
            if (targetedBrandIds.has(cnBrandTotal.brandId)) {
                return sum + Number(cnBrandTotal.totalInvoiced || 0);
            }

            return sum;
        }, 0);

        const baseTotal = creditNotesApplied ? effectiveSales : report.totalInvoiced;

        return savedTargets.map((item) => {
            const achieved = item.isGeneral
                ? Math.max(0, baseTotal - Math.max(0, targetedAchieved - targetedCreditNoteDeduction))
                : achievedByTargetBrandId.get(Number(item.brandId)) ?? 0;
            const progress = item.targetAmount > 0
                ? Math.min((achieved / item.targetAmount) * 100, 100)
                : 0;

            return {
                ...item,
                achieved: Number(achieved.toFixed(2)),
                progress,
            };
        });
    }, [creditNotesApplied, effectiveSales, report, savedTargets, targetedBrandIds]);

    const generalBreakdown = useMemo(() => {
        if (!report) {
            return null;
        }

        const generalRow = targetProgressRows.find((item) => item.isGeneral);
        if (!generalRow) {
            return null;
        }

        const creditNoteByBrandId = new Map<number, number>();
        if (creditNotesApplied) {
            for (const cnBrandTotal of report.creditNoteBrandTotals ?? []) {
                creditNoteByBrandId.set(
                    cnBrandTotal.brandId,
                    (creditNoteByBrandId.get(cnBrandTotal.brandId) ?? 0) +
                        Number(cnBrandTotal.totalInvoiced || 0)
                );
            }
        }

        const netByBrandId = new Map<number, number>();
        for (const brandTotal of report.brandTotals) {
            if (targetedBrandIds.has(brandTotal.brandId)) {
                continue;
            }

            netByBrandId.set(
                brandTotal.brandId,
                (netByBrandId.get(brandTotal.brandId) ?? 0) + Number(brandTotal.totalInvoiced || 0)
            );
        }

        let categorizedTotal = 0;
        const rows: Array<{ brandId: number | null; brandName: string; amount: number }> = [];

        for (const [brandId, grossAmount] of netByBrandId) {
            const amount = Number((grossAmount - (creditNoteByBrandId.get(brandId) ?? 0)).toFixed(2));
            if (amount === 0) {
                continue;
            }

            categorizedTotal += amount;
            rows.push({
                brandId,
                brandName: brandNameById.get(brandId) ?? `Brand #${brandId}`,
                amount,
            });
        }

        rows.sort((a, b) => b.amount - a.amount);

        const residual = Number((generalRow.achieved - categorizedTotal).toFixed(2));
        if (Math.abs(residual) >= 0.01) {
            rows.push({ brandId: null, brandName: "No Brand", amount: residual });
        }

        return { rows, total: generalRow.achieved };
    }, [brandNameById, creditNotesApplied, report, targetProgressRows, targetedBrandIds]);

    async function loadSavedTarget(salespersonId: number, year: number, month: number) {
        if (!user) {
            return null;
        }

        return getSalesTarget(salespersonId, year, month);
    }

    async function handleGenerate(event: FormEvent) {
        event.preventDefault();
        if (!selectedSalespersonId) {
            return;
        }

        setReportLoading(true);
        setError(null);
        setMessage(null);
        setSetTargetOpen(false);
        setTargetEntries([emptyTargetEntry()]);
        setGeneralBreakdownOpen(false);

        try {
            const salespersonId = Number(selectedSalespersonId);
            const year = Number(selectedYear);
            const month = Number(selectedMonth);

            await ensureBrandsLoaded();

            const [reportData, savedTarget] = await Promise.all([
                getSalespersonMonthlyInvoices({ salespersonId, year, month, includeCreditNotes }),
                loadSavedTarget(salespersonId, year, month),
            ]);

            setReport(normalizeReport(reportData));
            setTarget(savedTarget);
            setCreditNotesApplied(includeCreditNotes);
        } catch (loadError) {
            setError(
                loadError instanceof Error
                    ? loadError.message
                    : "Failed to generate sales target report."
            );
        } finally {
            setReportLoading(false);
        }
    }

    async function handleSaveTarget() {
        if (!user || !report) {
            return;
        }

        if (targetEntries.length === 0) {
            setError("Add at least one sales target.");
            return;
        }

        const selectedValues = new Set<string>();
        const normalizedTargets: SalesTargetBrand[] = [];

        for (const entry of targetEntries) {
            if (!entry.brandValue) {
                setError("Please select a product brand for each target.");
                return;
            }

            if (selectedValues.has(entry.brandValue)) {
                setError("Each product brand can only be selected once.");
                return;
            }

            selectedValues.add(entry.brandValue);

            const targetAmount = Number(entry.targetAmount);
            if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
                setError("Please enter a valid target amount for each brand.");
                return;
            }

            if (entry.brandValue === GENERAL_BRAND_VALUE) {
                normalizedTargets.push({
                    brandId: null,
                    brandName: "General",
                    targetAmount,
                    isGeneral: true,
                });
                continue;
            }

            const brandId = Number(entry.brandValue);
            const brand = brands.find((item) => item.id === brandId);
            if (!brand) {
                setError("One or more selected brands are invalid.");
                return;
            }

            normalizedTargets.push({
                brandId: brand.id,
                brandName: brand.name,
                targetAmount,
                isGeneral: false,
            });
        }

        setSavingTarget(true);
        setError(null);
        setMessage(null);

        try {
            await saveSalesTarget({
                salespersonId: report.salesperson.id,
                salespersonName: report.salesperson.name,
                year: report.year,
                month: report.month,
                targets: normalizedTargets,
            });

            const savedTarget = await loadSavedTarget(report.salesperson.id, report.year, report.month);
            setTarget(savedTarget);
            setSetTargetOpen(false);
            setTargetEntries([emptyTargetEntry()]);
            setMessage("Sales target saved successfully.");
        } catch (saveError) {
            setError(
                saveError instanceof Error ? saveError.message : "Failed to save sales target."
            );
        } finally {
            setSavingTarget(false);
        }
    }

    async function openTargetEditor() {
        await ensureBrandsLoaded();

        const existingEntries = savedTargets.map((item) => ({
            brandValue: item.isGeneral ? GENERAL_BRAND_VALUE : String(item.brandId),
            targetAmount: String(item.targetAmount),
        }));

        setTargetEntries(existingEntries.length > 0 ? existingEntries : [emptyTargetEntry()]);
        setSetTargetOpen(true);
        setError(null);
        setMessage(null);
    }

    async function toggleGeneralBreakdown() {
        if (generalBreakdownOpen) {
            setGeneralBreakdownOpen(false);
            return;
        }

        // Report state can be restored from sessionStorage without brands being fetched,
        // and the breakdown needs them to resolve brand names.
        await ensureBrandsLoaded();
        setGeneralBreakdownOpen(true);
    }

    function addTargetRow() {
        setTargetEntries((previous) => [...previous, emptyTargetEntry()]);
    }

    function updateTargetRow(index: number, value: Partial<TargetEntryInput>) {
        setTargetEntries((previous) =>
            previous.map((entry, entryIndex) =>
                entryIndex === index ? { ...entry, ...value } : entry
            )
        );
    }

    function removeTargetRow(index: number) {
        setTargetEntries((previous) => {
            if (previous.length <= 1) {
                return previous;
            }

            return previous.filter((_, entryIndex) => entryIndex !== index);
        });
    }

    function openEmailModal() {
        setEmailModalOpen(true);
        setError(null);
        setMessage(null);
    }

    async function handleSendEmail() {
        if (!report || savedTargets.length === 0) {
            setError("Generate a report with saved targets before sending email.");
            return;
        }

        const normalizedEmail = recipientEmail.trim();
        if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
            setError("Please enter a valid receiver email address.");
            return;
        }

        setSendingEmail(true);
        setError(null);
        setMessage(null);

        try {
            await sendSalesTargetEmail({
                toEmail: normalizedEmail,
                salespersonName: report.salesperson.name,
                monthLabel: months.find((month) => month.value === report.month)?.label ?? String(report.month),
                year: report.year,
                totalInvoiced: creditNotesApplied ? effectiveSales : report.totalInvoiced,
                totalTargetAmount,
                rows: targetProgressRows.map((item) => ({
                    brandName: item.brandName,
                    targetAmount: item.targetAmount,
                    achieved: item.achieved,
                    progress: item.progress,
                    remaining: Math.max(0, item.targetAmount - item.achieved),
                })),
            });

            setEmailModalOpen(false);
            setRecipientEmail("");
            setMessage("Sales target email sent successfully.");
        } catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : "Failed to send sales target email.");
        } finally {
            setSendingEmail(false);
        }
    }

    async function handleSendBrandMarketingRequest(item: {
        brandId: number | null;
        brandName: string;
        targetAmount: number;
        achieved: number;
    }) {
        if (!report || typeof item.brandId !== "number") {
            return;
        }

        if (marketingEmailsSentAt[String(item.brandId)]) {
            setMessage(`Marketing support request was already sent for ${item.brandName} this month.`);
            return;
        }

        const monthLabel = months.find((month) => month.value === report.month)?.label ?? String(report.month);

        setSendingBrandEmailId(item.brandId);
        setError(null);
        setMessage(null);

        try {
            await sendSalesTargetBrandMarketingEmail({
                salespersonName: report.salesperson.name,
                monthLabel,
                year: report.year,
                brandName: item.brandName,
                targetAmount: item.targetAmount,
                achieved: item.achieved,
                remaining: Math.max(0, item.targetAmount - item.achieved),
            });

            if (user) {
                await markSalesTargetBrandMarketingEmailSent({
                    salespersonId: report.salesperson.id,
                    year: report.year,
                    month: report.month,
                    brandId: item.brandId,
                });
            }

            setTarget((previous) => {
                if (!previous || typeof item.brandId !== "number") {
                    return previous;
                }

                return {
                    ...previous,
                    marketingEmailsSentAt: {
                        ...(previous.marketingEmailsSentAt ?? {}),
                        [String(item.brandId)]: new Date().toISOString(),
                    },
                };
            });

            setMessage(`Marketing support request sent for ${item.brandName}.`);
        } catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : "Failed to send marketing support request.");
        } finally {
            setSendingBrandEmailId(null);
        }
    }

    return (
        <section>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl">Salesperson Sales Target</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Track posted invoice totals by salesperson, month, and year, then compare them against saved targets.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href="/sales-targets/summary"
                        className="inline-flex items-center rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink)"
                    >
                        Targets Summary
                    </Link>
                    <Target className="h-8 w-8 text-(--brand)" aria-hidden="true" />
                </div>
            </div>

            <form onSubmit={handleGenerate} className="mt-6 rounded-2xl border border-(--line) bg-(--card) p-5">
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
                                <option value="">{salespeopleLoading ? "Loading salespeople..." : "No salespeople found"}</option>
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
                        <span className="mb-2 block text-sm font-medium">Month</span>
                        <select
                            value={selectedMonth}
                            onChange={(event) => setSelectedMonth(event.target.value)}
                            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                        >
                            {months.map((month) => (
                                <option key={month.value} value={month.value}>
                                    {month.label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="block">
                        <span className="mb-2 block text-sm font-medium">Year</span>
                        <select
                            value={selectedYear}
                            onChange={(event) => setSelectedYear(event.target.value)}
                            className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                        >
                            {yearOptions.map((year) => (
                                <option key={year} value={year}>
                                    {year}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        disabled={reportLoading || !selectedSalespersonId || salespeopleLoading}
                        className="rounded-xl bg-(--brand) px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {reportLoading ? "Generating..." : "Generate"}
                    </button>
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={includeCreditNotes}
                            onChange={(event) => setIncludeCreditNotes(event.target.checked)}
                            className="h-4 w-4 rounded border-(--line) text-(--brand) focus:ring-(--brand)"
                        />
                        <span className="text-sm font-medium">Include Credit Notes</span>
                    </label>
                    {salespeopleError ? <p className="text-sm text-red-600">{salespeopleError}</p> : null}
                    {error ? <p className="text-sm text-red-600">{error}</p> : null}
                    {message ? <p className="text-sm text-(--accent)">{message}</p> : null}
                </div>
            </form>

            {report ? (
                <div className="mt-6 space-y-6">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Salesperson</p>
                            <p className="mt-3 font-display text-3xl">{report.salesperson.name}</p>
                            <p className="mt-2 text-sm text-(--ink-soft)">
                                {months.find((month) => month.value === report.month)?.label} {report.year}
                            </p>
                        </article>

                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <p className="text-sm text-(--ink-soft)">Posted Invoice Total ({currencyCode})</p>
                            <p className="mt-3 font-display text-3xl">{formatCurrency(report.totalInvoiced, currencyCode)}</p>
                            <p className="mt-2 text-sm text-(--ink-soft)">
                                {report.invoiceCount} invoices posted in the selected month, converted to {currencyCode} at the configured rate.
                            </p>
                        </article>

                        {creditNotesApplied ? (
                            <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                                <p className="text-sm text-(--ink-soft)">Credit Notes</p>
                                <p className="mt-3 font-display text-3xl text-red-500">-{formatCurrency(report.creditNoteTotal ?? 0, currencyCode)}</p>
                                <p className="mt-2 text-sm text-(--ink-soft)">Credit notes (refunds) issued in the selected month.</p>
                            </article>
                        ) : null}

                        {creditNotesApplied ? (
                            <article className="rounded-2xl border-2 border-(--brand) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                                <p className="text-sm text-(--ink-soft)">Effective Sales</p>
                                <p className="mt-3 font-display text-3xl">{formatCurrency(effectiveSales, currencyCode)}</p>
                                <p className="mt-2 text-sm text-(--ink-soft)">Total invoiced minus credit notes.</p>
                            </article>
                        ) : null}

                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-sm text-(--ink-soft)">Target Status</p>
                                    <p className="mt-3 font-display text-3xl">{savedTargets.length > 0 ? formatCurrency(totalTargetAmount, currencyCode) : "Not Set"}</p>
                                    <p className="mt-2 text-sm text-(--ink-soft)">
                                        {savedTargets.length > 0
                                            ? `${savedTargets.length} brand target${savedTargets.length > 1 ? "s" : ""} saved for this period.`
                                            : "No target saved for the selected period."}
                                    </p>
                                </div>
                                <Gauge className="h-6 w-6 text-(--brand)" aria-hidden="true" />
                            </div>
                        </article>
                    </div>

                    {report.currencyTotals.length > 0 ? (
                        <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                            <h2 className="font-display text-2xl">Sales By Currency</h2>
                            <p className="mt-1 text-sm text-(--ink-soft)">
                                Every currency found in this salesperson&apos;s posted invoices this period — raw amounts, not
                                converted. The totals above convert every currency to {currencyCode} using the exchange rate
                                already configured under Accounting &gt; Currencies.
                            </p>
                            <div className="mt-4 overflow-x-auto rounded-xl border border-(--line)">
                                <table className="min-w-full divide-y divide-(--line) text-sm">
                                    <thead className="bg-(--chip) text-(--ink-soft)">
                                        <tr>
                                            <th className="px-4 py-2.5 text-left font-medium">Currency</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Total Sales</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Invoices</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-(--line) bg-white">
                                        {report.currencyTotals.map((total) => (
                                            <tr key={total.currencyId}>
                                                <td className="px-4 py-2.5 font-medium">
                                                    {total.currencyCode}
                                                    {total.currencyCode === currencyCode ? (
                                                        <span className="ml-2 rounded-full bg-(--chip) px-2 py-0.5 text-xs font-normal text-(--ink-soft)">
                                                            Target Currency
                                                        </span>
                                                    ) : null}
                                                </td>
                                                <td className="px-4 py-2.5 text-right">{formatCurrency(total.total, total.currencyCode)}</td>
                                                <td className="px-4 py-2.5 text-right text-(--ink-soft)">{total.invoiceCount}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {unconvertedCurrencyTotals.length > 0 ? (
                                <p className="mt-3 text-sm text-red-600">
                                    No exchange rate is configured for{" "}
                                    {unconvertedCurrencyTotals.map((total) => total.currencyCode).join(", ")} at your
                                    home company — these amounts are excluded from the totals above. Set a rate under
                                    Accounting &gt; Currencies to include them.
                                </p>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <h2 className="font-display text-2xl">Set Monthly Targets</h2>
                                <p className="text-sm text-(--ink-soft)">
                                    Add one or more product brand targets. The General target applies to all brands except the specifically configured ones.
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                {!setTargetOpen ? (
                                    <button
                                        type="button"
                                        onClick={() => void openTargetEditor()}
                                        className="rounded-xl bg-(--brand) px-4 py-2.5 font-medium text-white"
                                    >
                                        {savedTargets.length > 0 ? "Edit Targets" : "Set Targets"}
                                    </button>
                                ) : null}
                                {savedTargets.length > 0 ? (
                                    <button
                                        type="button"
                                        onClick={openEmailModal}
                                        className="rounded-xl border border-(--line) bg-white px-4 py-2.5 font-medium text-(--ink)"
                                    >
                                        Email Targets
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {savedTargets.length > 0 ? (
                            <div className="mt-4 rounded-xl border border-(--line) bg-white p-4">
                                <p className="text-sm font-medium text-(--ink)">Saved brand targets</p>
                                <div className="mt-3 space-y-3">
                                    {targetProgressRows.map((item, index) => (
                                        <div
                                            key={`${item.isGeneral ? "general" : item.brandId}-${index}`}
                                            className="space-y-2 rounded-lg bg-(--chip) px-3 py-3 text-sm"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-medium">{item.brandName}</span>
                                                <span>
                                                    {formatCurrency(item.achieved, currencyCode)} / {formatCurrency(item.targetAmount, currencyCode)}
                                                </span>
                                            </div>
                                            <div className="h-2 overflow-hidden rounded-full bg-white/80">
                                                <div
                                                    className="h-full rounded-full transition-[width] duration-700 ease-out"
                                                    style={{
                                                        width: `${item.progress}%`,
                                                        background: "linear-gradient(90deg, var(--accent), var(--brand))",
                                                    }}
                                                />
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-(--ink-soft)">
                                                <span>{item.progress.toFixed(1)}% achieved</span>
                                                <span>
                                                    {formatCurrency(Math.max(0, item.targetAmount - item.achieved), currencyCode)} remaining
                                                </span>
                                            </div>
                                            {!item.isGeneral && typeof item.brandId === "number" ? (
                                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleSendBrandMarketingRequest(item)}
                                                        disabled={
                                                            sendingBrandEmailId === item.brandId ||
                                                            Boolean(marketingEmailsSentAt[String(item.brandId)])
                                                        }
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-(--line) bg-white px-3 py-1.5 text-xs font-medium text-(--ink) hover:bg-(--chip) disabled:cursor-not-allowed disabled:opacity-70"
                                                    >
                                                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                                                        {sendingBrandEmailId === item.brandId
                                                            ? "Sending..."
                                                            : marketingEmailsSentAt[String(item.brandId)]
                                                                ? "Email Sent"
                                                                : "Email Marketing"}
                                                    </button>
                                                    <Link
                                                        href={`/sales-target-details?salespersonId=${report.salesperson.id}&year=${report.year}&month=${report.month}&brandId=${item.brandId}`}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-(--line) bg-white px-3 py-1.5 text-xs font-medium text-(--ink) hover:bg-(--chip)"
                                                    >
                                                        Details
                                                    </Link>
                                                </div>
                                            ) : null}
                                            {item.isGeneral ? (
                                                <div className="pt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => void toggleGeneralBreakdown()}
                                                        disabled={brandsLoading}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-(--line) bg-white px-3 py-1.5 text-xs font-medium text-(--ink) hover:bg-(--chip) disabled:cursor-not-allowed disabled:opacity-70"
                                                    >
                                                        <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
                                                        {brandsLoading
                                                            ? "Loading..."
                                                            : generalBreakdownOpen
                                                                ? "Hide Breakdown"
                                                                : "Breakdown"}
                                                    </button>

                                                    {generalBreakdownOpen && generalBreakdown ? (
                                                        <div className="mt-3 rounded-lg border border-(--line) bg-white p-3">
                                                            <p className="text-xs font-medium text-(--ink)">
                                                                Sales by brand
                                                            </p>
                                                            <p className="mt-0.5 text-xs text-(--ink-soft)">
                                                                Brands counted toward the General target, excluding those with their own target.
                                                            </p>

                                                            {generalBreakdown.rows.length === 0 ? (
                                                                <p className="mt-3 text-xs text-(--ink-soft)">
                                                                    No brand sales found for the General target this period.
                                                                </p>
                                                            ) : (
                                                                <div className="mt-3 max-h-72 overflow-auto">
                                                                    <table className="min-w-full divide-y divide-(--line) text-xs">
                                                                        <thead className="sticky top-0 bg-(--chip)">
                                                                            <tr>
                                                                                <th className="px-3 py-2 text-left font-medium">Brand</th>
                                                                                <th className="px-3 py-2 text-right font-medium">Sales</th>
                                                                                <th className="px-3 py-2 text-right font-medium">Share</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-(--line)">
                                                                            {generalBreakdown.rows.map((row) => (
                                                                                <tr key={row.brandId ?? "no-brand"}>
                                                                                    <td className="px-3 py-2">{row.brandName}</td>
                                                                                    <td className="px-3 py-2 text-right">
                                                                                        {formatCurrency(row.amount, currencyCode)}
                                                                                    </td>
                                                                                    <td className="px-3 py-2 text-right text-(--ink-soft)">
                                                                                        {generalBreakdown.total > 0
                                                                                            ? `${((row.amount / generalBreakdown.total) * 100).toFixed(1)}%`
                                                                                            : "-"}
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                        <tfoot>
                                                                            <tr className="border-t border-(--line) font-medium">
                                                                                <td className="px-3 py-2">Total</td>
                                                                                <td className="px-3 py-2 text-right">
                                                                                    {formatCurrency(generalBreakdown.total, currencyCode)}
                                                                                </td>
                                                                                <td className="px-3 py-2" />
                                                                            </tr>
                                                                        </tfoot>
                                                                    </table>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {setTargetOpen ? (
                            <div className="mt-4 space-y-4">
                                {brandsError ? <p className="text-sm text-red-600">{brandsError}</p> : null}

                                {targetEntries.map((entry, index) => {
                                    const selectedValues = new Set(
                                        targetEntries
                                            .map((item, itemIndex) => (itemIndex === index ? "" : item.brandValue))
                                            .filter(Boolean)
                                    );

                                    return (
                                        <div key={`target-entry-${index}`} className="grid gap-3 rounded-xl border border-(--line) bg-white p-4 md:grid-cols-[1.2fr_1fr_auto] md:items-end">
                                            <label className="block">
                                                <span className="mb-2 block text-sm font-medium">Product Brand</span>
                                                <select
                                                    value={entry.brandValue}
                                                    onChange={(event) =>
                                                        updateTargetRow(index, { brandValue: event.target.value })
                                                    }
                                                    className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                                                    disabled={brandsLoading || Boolean(brandsError)}
                                                    required
                                                >
                                                    <option
                                                        value={GENERAL_BRAND_VALUE}
                                                        disabled={selectedValues.has(GENERAL_BRAND_VALUE)}
                                                    >
                                                        General
                                                    </option>
                                                    {brands.map((brand) => (
                                                        <option
                                                            key={brand.id}
                                                            value={brand.id}
                                                            disabled={selectedValues.has(String(brand.id))}
                                                        >
                                                            {brand.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>

                                            <label className="block">
                                                <span className="mb-2 block text-sm font-medium">Sales Target</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={entry.targetAmount}
                                                    onChange={(event) =>
                                                        updateTargetRow(index, { targetAmount: event.target.value })
                                                    }
                                                    placeholder="Enter target amount"
                                                    className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                                                />
                                            </label>

                                            <button
                                                type="button"
                                                onClick={() => removeTargetRow(index)}
                                                disabled={targetEntries.length === 1}
                                                className="inline-flex h-11 items-center justify-center rounded-xl border border-(--line) px-3 text-sm font-medium text-(--ink) disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                                                Remove
                                            </button>
                                        </div>
                                    );
                                })}

                                <div className="flex flex-wrap items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={addTargetRow}
                                        className="inline-flex items-center rounded-xl border border-(--line) bg-white px-4 py-2.5 font-medium text-(--ink)"
                                    >
                                        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                                        Add More Target
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleSaveTarget()}
                                        disabled={savingTarget}
                                        className="rounded-xl bg-(--brand) px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                        {savingTarget ? "Saving..." : "Save Targets"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSetTargetOpen(false)}
                                        disabled={savingTarget}
                                        className="rounded-xl border border-(--line) bg-white px-4 py-2.5 font-medium text-(--ink)"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    {savedTargets.length > 0 ? (
                        <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                            <h2 className="font-display text-2xl">Performance Against Target</h2>
                            <p className="mt-1 text-sm text-(--ink-soft)">
                                Animated progress based on posted invoice totals for the selected salesperson and month.
                            </p>
                            <div className="mt-5">
                                <ProgressBar
                                    total={creditNotesApplied ? effectiveSales : report.totalInvoiced}
                                    target={totalTargetAmount}
                                    currencyCode={currencyCode}
                                />
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {emailModalOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-lg rounded-2xl border border-(--line) bg-white p-5 shadow-[0_20px_40px_rgba(8,23,41,0.25)]">
                        <h2 className="font-display text-2xl">Send Sales Target Email</h2>
                        <p className="mt-1 text-sm text-(--ink-soft)">
                            This sends Set Monthly Targets and Performance Against Target as a responsive HTML email.
                        </p>

                        <label className="mt-4 block">
                            <span className="mb-2 block text-sm font-medium">Receiver Email</span>
                            <input
                                type="email"
                                value={recipientEmail}
                                onChange={(event) => setRecipientEmail(event.target.value)}
                                placeholder="name@company.com"
                                className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                            />
                        </label>

                        <div className="mt-5 flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                onClick={() => void handleSendEmail()}
                                disabled={sendingEmail}
                                className="rounded-xl bg-(--brand) px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                {sendingEmail ? "Sending..." : "Send Email"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setEmailModalOpen(false)}
                                disabled={sendingEmail}
                                className="rounded-xl border border-(--line) bg-white px-4 py-2.5 font-medium text-(--ink)"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}

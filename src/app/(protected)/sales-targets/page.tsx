"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Gauge, ListTree, Mail, Plus, Target, Trash2 } from "lucide-react";
import {
    getSalesTarget,
    markSalesTargetCategoryMarketingEmailSent,
    saveSalesTarget,
} from "@/lib/firestore-settings";
import {
    getProductCategories,
    getSalespeople,
    sendSalesTargetEmail,
    sendSalesTargetCategoryMarketingEmail,
    getSalespersonMonthlyInvoices,
} from "@/lib/client-odoo";
import { useAuth } from "@/lib/auth-context";
import {
    OdooSalesperson,
    OdooSalespersonMonthlyInvoices,
    SalesTargetCategory,
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

function formatCurrency(value: number) {
    return `AED ${formatNumber(value)}`;
}

function currentMonth() {
    return new Date().getMonth() + 1;
}

function currentYear() {
    return new Date().getFullYear();
}

const GENERAL_CATEGORY_VALUE = "general";
const REPORT_STATE_STORAGE_KEY = "sales-targets:report-state";

type PersistedReportState = {
    selectedSalespersonId: string;
    selectedMonth: string;
    selectedYear: string;
    includeCreditNotes: string;
    creditNotesApplied: string;
    report: OdooSalespersonMonthlyInvoices;
    target: SalesTargetRecord | null;
};

type ProductCategory = {
    id: number;
    name: string;
    model: "product.public.category" | "product.category";
    parentPath?: string;
};

type TargetEntryInput = {
    categoryValue: string;
    targetAmount: string;
};

function emptyTargetEntry(): TargetEntryInput {
    return {
        categoryValue: GENERAL_CATEGORY_VALUE,
        targetAmount: "",
    };
}

function ProgressBar({ total, target }: { total: number; target: number }) {
    const progress = target > 0 ? Math.min((total / target) * 100, 100) : 0;
    const exceeded = Math.max(0, total - target);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="text-sm text-(--ink-soft)">Target Progress</p>
                    <p className="mt-1 font-display text-3xl">{formatCurrency(total)}</p>
                </div>
                <div className="text-right">
                    <p className="text-sm text-(--ink-soft)">Target</p>
                    <p className="mt-1 text-lg font-medium">{formatCurrency(target)}</p>
                    {exceeded > 0 ? (
                        <p className="mt-1 text-sm font-medium text-(--accent)">+{formatCurrency(exceeded)} exceeded</p>
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
                <span>{formatCurrency(Math.max(0, target - total))} remaining</span>
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

    const [categories, setCategories] = useState<ProductCategory[]>([]);
    const [categoriesLoading, setCategoriesLoading] = useState(false);
    const [categoriesError, setCategoriesError] = useState<string | null>(null);

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
    const [sendingCategoryEmailId, setSendingCategoryEmailId] = useState<number | null>(null);
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
            setCategories([]);
            setCategoriesLoading(false);
            setCategoriesError(null);

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
            setReport(parsed.report as OdooSalespersonMonthlyInvoices);
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

    async function ensureCategoriesLoaded() {
        if (!user || categories.length > 0 || categoriesLoading) {
            return;
        }

        setCategoriesLoading(true);
        setCategoriesError(null);

        try {
            const data = await getProductCategories();
            setCategories(data.categories.filter((category) => category.model === "product.category"));
        } catch (loadError) {
            setCategoriesError(
                loadError instanceof Error
                    ? loadError.message
                    : "Failed to load product categories."
            );
        } finally {
            setCategoriesLoading(false);
        }
    }

    const savedTargets = useMemo(() => {
        if (!target) {
            return [] as SalesTargetCategory[];
        }

        if (target.targets.length > 0) {
            return target.targets;
        }

        if (Number.isFinite(target.targetAmount) && Number(target.targetAmount) > 0) {
            return [
                {
                    categoryId: null,
                    categoryName: "General",
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

    const marketingEmailsSentAt = useMemo(() => target?.marketingEmailsSentAt ?? {}, [target]);

    const categoryNameById = useMemo(() => {
        const lookup = new Map<number, string>();
        for (const category of categories) {
            lookup.set(category.id, category.name);
        }
        return lookup;
    }, [categories]);

    const coveredLeafCategoryIds = useMemo(() => {
        const covered = new Set<number>();
        if (!report) {
            return covered;
        }

        for (const item of savedTargets) {
            if (item.isGeneral || typeof item.categoryId !== "number") {
                continue;
            }

            for (const categoryTotal of report.categoryTotals) {
                const isCovered =
                    categoryTotal.categoryId === item.categoryId ||
                    categoryTotal.ancestorCategoryIds.includes(Number(item.categoryId));

                if (isCovered) {
                    covered.add(categoryTotal.categoryId);
                }
            }
        }

        return covered;
    }, [report, savedTargets]);

    const targetProgressRows = useMemo(() => {
        if (!report) {
            return [];
        }

        const creditNoteCategoryTotals = creditNotesApplied ? (report.creditNoteCategoryTotals ?? []) : [];

        const achievedByTargetCategoryId = new Map<number, number>();
        for (const item of savedTargets) {
            if (item.isGeneral || typeof item.categoryId !== "number") {
                continue;
            }

            let achieved = 0;
            for (const categoryTotal of report.categoryTotals) {
                const leafCategoryId = categoryTotal.categoryId;
                const matchesTarget =
                    leafCategoryId === item.categoryId ||
                    categoryTotal.ancestorCategoryIds.includes(Number(item.categoryId));

                if (matchesTarget) {
                    achieved += Number(categoryTotal.totalInvoiced || 0);
                }
            }

            let creditNoteDeduction = 0;
            for (const cnCategoryTotal of creditNoteCategoryTotals) {
                const leafCategoryId = cnCategoryTotal.categoryId;
                const matchesTarget =
                    leafCategoryId === item.categoryId ||
                    cnCategoryTotal.ancestorCategoryIds.includes(Number(item.categoryId));

                if (matchesTarget) {
                    creditNoteDeduction += Number(cnCategoryTotal.totalInvoiced || 0);
                }
            }

            achievedByTargetCategoryId.set(item.categoryId, Number(Math.max(0, achieved - creditNoteDeduction).toFixed(2)));
        }

        const targetedAchieved = report.categoryTotals.reduce((sum, categoryTotal) => {
            if (coveredLeafCategoryIds.has(categoryTotal.categoryId)) {
                return sum + Number(categoryTotal.totalInvoiced || 0);
            }

            return sum;
        }, 0);

        const targetedCreditNoteDeduction = creditNoteCategoryTotals.reduce((sum, cnCategoryTotal) => {
            if (coveredLeafCategoryIds.has(cnCategoryTotal.categoryId)) {
                return sum + Number(cnCategoryTotal.totalInvoiced || 0);
            }

            return sum;
        }, 0);

        const baseTotal = creditNotesApplied ? effectiveSales : report.totalInvoiced;

        return savedTargets.map((item) => {
            const achieved = item.isGeneral
                ? Math.max(0, baseTotal - Math.max(0, targetedAchieved - targetedCreditNoteDeduction))
                : achievedByTargetCategoryId.get(Number(item.categoryId)) ?? 0;
            const progress = item.targetAmount > 0
                ? Math.min((achieved / item.targetAmount) * 100, 100)
                : 0;

            return {
                ...item,
                achieved: Number(achieved.toFixed(2)),
                progress,
            };
        });
    }, [coveredLeafCategoryIds, creditNotesApplied, effectiveSales, report, savedTargets]);

    const generalBreakdown = useMemo(() => {
        if (!report) {
            return null;
        }

        const generalRow = targetProgressRows.find((item) => item.isGeneral);
        if (!generalRow) {
            return null;
        }

        const creditNoteByCategoryId = new Map<number, number>();
        if (creditNotesApplied) {
            for (const cnCategoryTotal of report.creditNoteCategoryTotals ?? []) {
                creditNoteByCategoryId.set(
                    cnCategoryTotal.categoryId,
                    (creditNoteByCategoryId.get(cnCategoryTotal.categoryId) ?? 0) +
                        Number(cnCategoryTotal.totalInvoiced || 0)
                );
            }
        }

        const netByCategoryId = new Map<number, number>();
        for (const categoryTotal of report.categoryTotals) {
            if (coveredLeafCategoryIds.has(categoryTotal.categoryId)) {
                continue;
            }

            netByCategoryId.set(
                categoryTotal.categoryId,
                (netByCategoryId.get(categoryTotal.categoryId) ?? 0) + Number(categoryTotal.totalInvoiced || 0)
            );
        }

        let categorizedTotal = 0;
        const rows: Array<{ categoryId: number | null; categoryName: string; amount: number }> = [];

        for (const [categoryId, grossAmount] of netByCategoryId) {
            const amount = Number((grossAmount - (creditNoteByCategoryId.get(categoryId) ?? 0)).toFixed(2));
            if (amount === 0) {
                continue;
            }

            categorizedTotal += amount;
            rows.push({
                categoryId,
                categoryName: categoryNameById.get(categoryId) ?? `Category #${categoryId}`,
                amount,
            });
        }

        rows.sort((a, b) => b.amount - a.amount);

        const residual = Number((generalRow.achieved - categorizedTotal).toFixed(2));
        if (Math.abs(residual) >= 0.01) {
            rows.push({ categoryId: null, categoryName: "Uncategorized", amount: residual });
        }

        return { rows, total: generalRow.achieved };
    }, [categoryNameById, coveredLeafCategoryIds, creditNotesApplied, report, targetProgressRows]);

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

            await ensureCategoriesLoaded();

            const [reportData, savedTarget] = await Promise.all([
                getSalespersonMonthlyInvoices({ salespersonId, year, month, includeCreditNotes }),
                loadSavedTarget(salespersonId, year, month),
            ]);

            setReport(reportData);
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
        const normalizedTargets: SalesTargetCategory[] = [];

        for (const entry of targetEntries) {
            if (!entry.categoryValue) {
                setError("Please select a product category for each target.");
                return;
            }

            if (selectedValues.has(entry.categoryValue)) {
                setError("Each product category can only be selected once.");
                return;
            }

            selectedValues.add(entry.categoryValue);

            const targetAmount = Number(entry.targetAmount);
            if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
                setError("Please enter a valid target amount for each category.");
                return;
            }

            if (entry.categoryValue === GENERAL_CATEGORY_VALUE) {
                normalizedTargets.push({
                    categoryId: null,
                    categoryName: "General",
                    targetAmount,
                    isGeneral: true,
                });
                continue;
            }

            const categoryId = Number(entry.categoryValue);
            const category = categories.find((item) => item.id === categoryId);
            if (!category) {
                setError("One or more selected categories are invalid.");
                return;
            }

            normalizedTargets.push({
                categoryId: category.id,
                categoryName: category.name,
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
        await ensureCategoriesLoaded();

        const existingEntries = savedTargets.map((item) => ({
            categoryValue: item.isGeneral ? GENERAL_CATEGORY_VALUE : String(item.categoryId),
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

        // Report state can be restored from sessionStorage without categories being fetched,
        // and the breakdown needs them to resolve category names.
        await ensureCategoriesLoaded();
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
                    categoryName: item.categoryName,
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

    async function handleSendCategoryMarketingRequest(item: {
        categoryId: number | null;
        categoryName: string;
        targetAmount: number;
        achieved: number;
    }) {
        if (!report || typeof item.categoryId !== "number") {
            return;
        }

        if (marketingEmailsSentAt[String(item.categoryId)]) {
            setMessage(`Marketing support request was already sent for ${item.categoryName} this month.`);
            return;
        }

        const monthLabel = months.find((month) => month.value === report.month)?.label ?? String(report.month);

        setSendingCategoryEmailId(item.categoryId);
        setError(null);
        setMessage(null);

        try {
            await sendSalesTargetCategoryMarketingEmail({
                salespersonName: report.salesperson.name,
                monthLabel,
                year: report.year,
                categoryName: item.categoryName,
                targetAmount: item.targetAmount,
                achieved: item.achieved,
                remaining: Math.max(0, item.targetAmount - item.achieved),
            });

            if (user) {
                await markSalesTargetCategoryMarketingEmailSent({
                    salespersonId: report.salesperson.id,
                    year: report.year,
                    month: report.month,
                    categoryId: item.categoryId,
                });
            }

            setTarget((previous) => {
                if (!previous || typeof item.categoryId !== "number") {
                    return previous;
                }

                return {
                    ...previous,
                    marketingEmailsSentAt: {
                        ...(previous.marketingEmailsSentAt ?? {}),
                        [String(item.categoryId)]: new Date().toISOString(),
                    },
                };
            });

            setMessage(`Marketing support request sent for ${item.categoryName}.`);
        } catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : "Failed to send marketing support request.");
        } finally {
            setSendingCategoryEmailId(null);
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
                            <p className="text-sm text-(--ink-soft)">Posted Invoice Total</p>
                            <p className="mt-3 font-display text-3xl">{formatCurrency(report.totalInvoiced)}</p>
                            <p className="mt-2 text-sm text-(--ink-soft)">{report.invoiceCount} invoices posted in the selected month.</p>
                        </article>

                        {creditNotesApplied ? (
                            <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                                <p className="text-sm text-(--ink-soft)">Credit Notes</p>
                                <p className="mt-3 font-display text-3xl text-red-500">-{formatCurrency(report.creditNoteTotal ?? 0)}</p>
                                <p className="mt-2 text-sm text-(--ink-soft)">Credit notes (refunds) issued in the selected month.</p>
                            </article>
                        ) : null}

                        {creditNotesApplied ? (
                            <article className="rounded-2xl border-2 border-(--brand) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                                <p className="text-sm text-(--ink-soft)">Effective Sales</p>
                                <p className="mt-3 font-display text-3xl">{formatCurrency(effectiveSales)}</p>
                                <p className="mt-2 text-sm text-(--ink-soft)">Total invoiced minus credit notes.</p>
                            </article>
                        ) : null}

                        <article className="rounded-2xl border border-(--line) bg-(--card) p-5 shadow-[0_8px_20px_rgba(8,23,41,0.05)]">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-sm text-(--ink-soft)">Target Status</p>
                                    <p className="mt-3 font-display text-3xl">{savedTargets.length > 0 ? formatCurrency(totalTargetAmount) : "Not Set"}</p>
                                    <p className="mt-2 text-sm text-(--ink-soft)">
                                        {savedTargets.length > 0
                                            ? `${savedTargets.length} category target${savedTargets.length > 1 ? "s" : ""} saved for this period.`
                                            : "No target saved for the selected period."}
                                    </p>
                                </div>
                                <Gauge className="h-6 w-6 text-(--brand)" aria-hidden="true" />
                            </div>
                        </article>
                    </div>

                    <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <h2 className="font-display text-2xl">Set Monthly Targets</h2>
                                <p className="text-sm text-(--ink-soft)">
                                    Add one or more product category targets. The General target applies to all categories except the specifically configured ones.
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
                                <p className="text-sm font-medium text-(--ink)">Saved category targets</p>
                                <div className="mt-3 space-y-3">
                                    {targetProgressRows.map((item, index) => (
                                        <div
                                            key={`${item.isGeneral ? "general" : item.categoryId}-${index}`}
                                            className="space-y-2 rounded-lg bg-(--chip) px-3 py-3 text-sm"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-medium">{item.categoryName}</span>
                                                <span>
                                                    {formatCurrency(item.achieved)} / {formatCurrency(item.targetAmount)}
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
                                                    {formatCurrency(Math.max(0, item.targetAmount - item.achieved))} remaining
                                                </span>
                                            </div>
                                            {!item.isGeneral && typeof item.categoryId === "number" ? (
                                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleSendCategoryMarketingRequest(item)}
                                                        disabled={
                                                            sendingCategoryEmailId === item.categoryId ||
                                                            Boolean(marketingEmailsSentAt[String(item.categoryId)])
                                                        }
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-(--line) bg-white px-3 py-1.5 text-xs font-medium text-(--ink) hover:bg-(--chip) disabled:cursor-not-allowed disabled:opacity-70"
                                                    >
                                                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                                                        {sendingCategoryEmailId === item.categoryId
                                                            ? "Sending..."
                                                            : marketingEmailsSentAt[String(item.categoryId)]
                                                                ? "Email Sent"
                                                                : "Email Marketing"}
                                                    </button>
                                                    <Link
                                                        href={`/sales-target-details?salespersonId=${report.salesperson.id}&year=${report.year}&month=${report.month}&categoryId=${item.categoryId}`}
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
                                                        disabled={categoriesLoading}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-(--line) bg-white px-3 py-1.5 text-xs font-medium text-(--ink) hover:bg-(--chip) disabled:cursor-not-allowed disabled:opacity-70"
                                                    >
                                                        <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
                                                        {categoriesLoading
                                                            ? "Loading..."
                                                            : generalBreakdownOpen
                                                                ? "Hide Breakdown"
                                                                : "Breakdown"}
                                                    </button>

                                                    {generalBreakdownOpen && generalBreakdown ? (
                                                        <div className="mt-3 rounded-lg border border-(--line) bg-white p-3">
                                                            <p className="text-xs font-medium text-(--ink)">
                                                                Sales by category
                                                            </p>
                                                            <p className="mt-0.5 text-xs text-(--ink-soft)">
                                                                Categories counted toward the General target, excluding those with their own target.
                                                            </p>

                                                            {generalBreakdown.rows.length === 0 ? (
                                                                <p className="mt-3 text-xs text-(--ink-soft)">
                                                                    No category sales found for the General target this period.
                                                                </p>
                                                            ) : (
                                                                <div className="mt-3 max-h-72 overflow-auto">
                                                                    <table className="min-w-full divide-y divide-(--line) text-xs">
                                                                        <thead className="sticky top-0 bg-(--chip)">
                                                                            <tr>
                                                                                <th className="px-3 py-2 text-left font-medium">Category</th>
                                                                                <th className="px-3 py-2 text-right font-medium">Sales</th>
                                                                                <th className="px-3 py-2 text-right font-medium">Share</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-(--line)">
                                                                            {generalBreakdown.rows.map((row) => (
                                                                                <tr key={row.categoryId ?? "uncategorized"}>
                                                                                    <td className="px-3 py-2">{row.categoryName}</td>
                                                                                    <td className="px-3 py-2 text-right">
                                                                                        {formatCurrency(row.amount)}
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
                                                                                    {formatCurrency(generalBreakdown.total)}
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
                                {categoriesError ? <p className="text-sm text-red-600">{categoriesError}</p> : null}

                                {targetEntries.map((entry, index) => {
                                    const selectedValues = new Set(
                                        targetEntries
                                            .map((item, itemIndex) => (itemIndex === index ? "" : item.categoryValue))
                                            .filter(Boolean)
                                    );

                                    return (
                                        <div key={`target-entry-${index}`} className="grid gap-3 rounded-xl border border-(--line) bg-white p-4 md:grid-cols-[1.2fr_1fr_auto] md:items-end">
                                            <label className="block">
                                                <span className="mb-2 block text-sm font-medium">Product Category</span>
                                                <select
                                                    value={entry.categoryValue}
                                                    onChange={(event) =>
                                                        updateTargetRow(index, { categoryValue: event.target.value })
                                                    }
                                                    className="w-full rounded-xl border border-(--line) bg-white px-4 py-2.5"
                                                    disabled={categoriesLoading || Boolean(categoriesError)}
                                                    required
                                                >
                                                    <option
                                                        value={GENERAL_CATEGORY_VALUE}
                                                        disabled={selectedValues.has(GENERAL_CATEGORY_VALUE)}
                                                    >
                                                        General
                                                    </option>
                                                    {categories.map((category) => (
                                                        <option
                                                            key={category.id}
                                                            value={category.id}
                                                            disabled={selectedValues.has(String(category.id))}
                                                        >
                                                            {category.name}
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
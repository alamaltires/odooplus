"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { getCustomers, getProducts, getSalespeople } from "@/lib/client-odoo";
import { useAuth } from "@/lib/auth-context";
import { BackorderDetails, OdooCustomerOption, OdooProductOption, OdooSalesperson } from "@/types/odoo";

type ManualLine = {
    id: string;
    productId: string;
    orderedQty: string;
    availableQty: string;
    shortageQty: string;
    unitPrice: string;
};

function createEmptyLine(): ManualLine {
    return {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        productId: "",
        orderedQty: "",
        availableQty: "",
        shortageQty: "",
        unitPrice: "",
    };
}

function normalizeNumber(value: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

type ListBoxOption = {
    id: number;
    name: string;
    subtitle?: string;
};

function SearchableListBox({
    label,
    selectedId,
    selectedLabel,
    options,
    placeholder,
    disabled,
    loading,
    emptyMessage,
    onOpen,
    onQueryChange,
    hasMore,
    onLoadMore,
    onSelect,
}: {
    label: string;
    selectedId: string;
    selectedLabel?: string;
    options: ListBoxOption[];
    placeholder: string;
    disabled?: boolean;
    loading?: boolean;
    emptyMessage?: string;
    onOpen?: () => void;
    onQueryChange?: (value: string) => void;
    hasMore?: boolean;
    onLoadMore?: () => void;
    onSelect: (value: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);
    const selectedOption = options.find((option) => String(option.id) === selectedId);
    const inputValue = selectedId && !menuOpen && !query ? selectedOption?.name ?? selectedLabel ?? "" : query;

    const filteredOptions = onQueryChange
        ? options
        : options.filter((option) => option.name.toLowerCase().includes(query.trim().toLowerCase()));

    return (
        <label className="relative block text-sm">
            <span className="mb-2 block font-medium">{label}</span>
            <div className="relative">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)"
                    aria-hidden="true"
                />
                <input
                    value={inputValue}
                    onChange={(event) => {
                        const nextQuery = event.target.value;
                        setQuery(nextQuery);
                        onSelect("");
                        setMenuOpen(true);
                        onQueryChange?.(nextQuery);
                    }}
                    onFocus={() => {
                        setMenuOpen(true);
                        onOpen?.();
                    }}
                    onBlur={() => {
                        window.setTimeout(() => {
                            setMenuOpen(false);
                            if (!selectedId) {
                                setQuery("");
                            }
                        }, 120);
                    }}
                    placeholder={placeholder}
                    disabled={disabled}
                    required
                    className="w-full rounded-xl border border-(--line) bg-white py-2 pl-10 pr-3"
                />
            </div>

            {menuOpen ? (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-(--line) bg-white shadow-lg">
                    <ul className="max-h-64 overflow-auto p-1">
                        {filteredOptions.map((option) => (
                            <li key={option.id}>
                                <button
                                    type="button"
                                    onMouseDown={() => {
                                        onSelect(String(option.id));
                                        setQuery(option.name);
                                        setMenuOpen(false);
                                    }}
                                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-(--chip)"
                                >
                                    <span className="block text-(--ink)">{option.name}</span>
                                    {option.subtitle ? (
                                        <span className="block text-xs text-(--ink-soft)">{option.subtitle}</span>
                                    ) : null}
                                </button>
                            </li>
                        ))}
                        {loading ? (
                            <li className="px-3 py-2 text-xs text-(--ink-soft)">Loading...</li>
                        ) : null}
                        {!loading && filteredOptions.length === 0 ? (
                            <li className="px-3 py-2 text-xs text-(--ink-soft)">{emptyMessage ?? "No results found."}</li>
                        ) : null}
                    </ul>
                    {hasMore && onLoadMore ? (
                        <div className="border-t border-(--line) p-1">
                            <button
                                type="button"
                                onMouseDown={onLoadMore}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm text-(--brand) hover:bg-(--chip)"
                            >
                                Load more
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </label>
    );
}

export default function ManualBackorderPage() {
    const PRODUCT_PAGE_SIZE = 10;
    const { user } = useAuth();
    const [orderNumber, setOrderNumber] = useState("");
    const [customers, setCustomers] = useState<OdooCustomerOption[]>([]);
    const [salespeople, setSalespeople] = useState<OdooSalesperson[]>([]);
    const [products, setProducts] = useState<OdooProductOption[]>([]);
    const [productNameById, setProductNameById] = useState<Record<number, string>>({});
    const [customerId, setCustomerId] = useState("");
    const [salespersonId, setSalespersonId] = useState("");
    const [orderDate, setOrderDate] = useState("");
    const [lines, setLines] = useState<ManualLine[]>([createEmptyLine()]);
    const [loadingCustomers, setLoadingCustomers] = useState(false);
    const [loadingSalespeople, setLoadingSalespeople] = useState(false);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [productQuery, setProductQuery] = useState("");
    const [productOffset, setProductOffset] = useState(0);
    const [hasMoreProducts, setHasMoreProducts] = useState(false);
    const [productListActivated, setProductListActivated] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [savedId, setSavedId] = useState<string | null>(null);
    const [pendingDetails, setPendingDetails] = useState<BackorderDetails | null>(null);
    const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);

    const customersLoadedRef = useRef(false);
    const salespeopleLoadedRef = useRef(false);

    const ensureCustomersLoaded = useCallback(async () => {
        if (customersLoadedRef.current || loadingCustomers) {
            return;
        }

        setLoadingCustomers(true);
        setError(null);

        try {
            const response = await getCustomers();
            setCustomers(response.customers);
            customersLoadedRef.current = true;
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load customers from Odoo.");
        } finally {
            setLoadingCustomers(false);
        }
    }, [loadingCustomers]);

    const ensureSalespeopleLoaded = useCallback(async () => {
        if (salespeopleLoadedRef.current || loadingSalespeople) {
            return;
        }

        setLoadingSalespeople(true);
        setError(null);

        try {
            const response = await getSalespeople();
            setSalespeople(response.salespeople);
            salespeopleLoadedRef.current = true;
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load salespeople from Odoo.");
        } finally {
            setLoadingSalespeople(false);
        }
    }, [loadingSalespeople]);

    const loadProducts = useCallback(
        async ({ query, offset, append }: { query: string; offset: number; append: boolean }) => {
            setLoadingProducts(true);
            setError(null);

            try {
                const response = await getProducts({
                    query,
                    limit: PRODUCT_PAGE_SIZE,
                    offset,
                });

                setProducts((current) => {
                    if (!append) {
                        return response.products;
                    }

                    const existingIds = new Set(current.map((item) => item.id));
                    const nextItems = response.products.filter((item) => !existingIds.has(item.id));
                    return [...current, ...nextItems];
                });

                setProductNameById((current) => {
                    const next = { ...current };
                    for (const product of response.products) {
                        next[product.id] = product.name;
                    }
                    return next;
                });

                setHasMoreProducts(response.hasMore);
                setProductOffset(offset + response.products.length);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "Failed to load products from Odoo.");
            } finally {
                setLoadingProducts(false);
            }
        },
        []
    );

    useEffect(() => {
        if (!productListActivated) {
            return;
        }

        const debounceId = window.setTimeout(() => {
            void loadProducts({ query: productQuery, offset: 0, append: false });
        }, 250);

        return () => {
            window.clearTimeout(debounceId);
        };
    }, [loadProducts, productListActivated, productQuery]);

    const loadMoreProducts = useCallback(() => {
        if (loadingProducts || !hasMoreProducts) {
            return;
        }

        void loadProducts({ query: productQuery, offset: productOffset, append: true });
    }, [hasMoreProducts, loadProducts, loadingProducts, productOffset, productQuery]);

    function updateLine(id: string, field: keyof ManualLine, value: string) {
        setLines((current) =>
            current.map((line) => (line.id === id ? { ...line, [field]: value } : line))
        );
    }

    function addLine() {
        setLines((current) => [...current, createEmptyLine()]);
    }

    function removeLine(id: string) {
        setLines((current) => {
            if (current.length === 1) {
                return current;
            }

            return current.filter((line) => line.id !== id);
        });
    }

    async function performSave(details: BackorderDetails, force = false) {
        if (!user) {
            setError("User not authenticated.");
            setSuccess(null);
            return;
        }

        setSaving(true);
        setError(null);
        setSuccess(null);
        setSavedId(null);

        try {
            const idToken = await user.getIdToken();
            const response = await fetch("/api/backorders", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ details, force }),
            });

            const result = (await response.json()) as {
                saved?: { id: string };
                error?: string;
                existingId?: string;
                orderNumber?: string;
            };

            if (response.status === 409 && result.existingId) {
                setPendingDetails(details);
                setShowDuplicateConfirm(true);
                setSaving(false);
                return;
            }

            if (!response.ok || result.error || !result.saved) {
                throw new Error(result.error ?? "Failed to save manual backorder.");
            }

            setSavedId(result.saved.id);
            setSuccess("Manual backorder saved.");
        } catch (saveError) {
            setError(
                saveError instanceof Error
                    ? saveError.message
                    : "Failed to save manual backorder."
            );
        } finally {
            setSaving(false);
        }
    }

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();

        const selectedCustomer = customers.find((customer) => customer.id === Number(customerId));
        const selectedSalesperson = salespeople.find(
            (salesperson) => salesperson.id === Number(salespersonId)
        );

        const validLines = lines.filter((line) => {
            const productId = Number(line.productId);
            return Number.isFinite(productId) && productId > 0 && Boolean(productNameById[productId]);
        });

        if (!selectedCustomer) {
            setError("Select a customer from Odoo.");
            setSuccess(null);
            return;
        }

        if (!selectedSalesperson) {
            setError("Select a salesperson from Odoo.");
            setSuccess(null);
            return;
        }

        if (validLines.length === 0) {
            setError("Add at least one product line.");
            setSuccess(null);
            return;
        }

        const generatedOrderId = Date.now();
        const details: BackorderDetails = {
            order: {
                id: generatedOrderId,
                name: orderNumber.trim(),
                customer_name: selectedCustomer.name,
                salesperson_name: selectedSalesperson.name,
                order_date: orderDate,
                payment_terms: "-",
                state: "manual",
            },
            lines: validLines.map((line, index) => {
                const productId = Number(line.productId);
                const productName = productNameById[productId] ?? "";

                return {
                    id: index + 1,
                    name: productName,
                    product_id: productId > 0 ? [productId, productName] : undefined,
                    ordered_qty: normalizeNumber(line.orderedQty),
                    available_qty: normalizeNumber(line.availableQty),
                    shortage_qty: normalizeNumber(line.shortageQty),
                    price_unit: normalizeNumber(line.unitPrice),
                };
            }),
        };

        await performSave(details, false);
    }

    return (
        <section className="max-w-6xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="font-display text-3xl">Add Manual Backorder</h1>
                    <p className="mt-1 text-sm text-(--ink-soft)">
                        Enter the same backorder fields normally loaded from Odoo and save them manually.
                    </p>
                </div>
                <Link
                    href="/orders/pending"
                    className="inline-flex items-center justify-center rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink)"
                >
                    Back to Pending Orders
                </Link>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-6">
                <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                    <h2 className="font-display text-xl">Sales Order Information</h2>
                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <label className="block text-sm">
                            <span className="mb-2 block font-medium">Order Number</span>
                            <input
                                value={orderNumber}
                                onChange={(event) => setOrderNumber(event.target.value)}
                                required
                                className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                                placeholder="Example: MAN-1001"
                            />
                        </label>
                        <SearchableListBox
                            label="Customer Name"
                            selectedId={customerId}
                            onSelect={setCustomerId}
                            onOpen={() => {
                                void ensureCustomersLoaded();
                            }}
                            disabled={loadingCustomers && customers.length === 0}
                            loading={loadingCustomers}
                            emptyMessage="No customers found."
                            placeholder="Search customers"
                            options={customers.map((customer) => ({
                                id: customer.id,
                                name: customer.name,
                                subtitle: customer.salespersonName ? `Salesperson: ${customer.salespersonName}` : undefined,
                            }))}
                        />
                        <SearchableListBox
                            label="Salesperson"
                            selectedId={salespersonId}
                            onSelect={setSalespersonId}
                            onOpen={() => {
                                void ensureSalespeopleLoaded();
                            }}
                            disabled={loadingSalespeople && salespeople.length === 0}
                            loading={loadingSalespeople}
                            emptyMessage="No salespeople found."
                            placeholder="Search salespeople"
                            options={salespeople.map((salesperson) => ({
                                id: salesperson.id,
                                name: salesperson.name,
                            }))}
                        />
                        <label className="block text-sm">
                            <span className="mb-2 block font-medium">Order Date</span>
                            <input
                                type="date"
                                value={orderDate}
                                onChange={(event) => setOrderDate(event.target.value)}
                                required
                                className="w-full rounded-xl border border-(--line) bg-white px-3 py-2"
                            />
                        </label>
                        <label className="block text-sm">
                            <span className="mb-2 block font-medium">State</span>
                            <div className="rounded-xl border border-(--line) bg-(--chip) px-3 py-2 font-medium text-(--ink)">
                                manual
                            </div>
                        </label>
                    </div>
                </div>

                <div className="rounded-2xl border border-(--line) bg-(--card) p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="font-display text-xl">Out of Stock Products</h2>
                            <p className="mt-1 text-sm text-(--ink-soft)">
                                Add each product and its shortage values manually.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={addLine}
                            className="inline-flex items-center justify-center rounded-xl border border-(--line) bg-white px-4 py-2 text-sm font-medium text-(--ink)"
                        >
                            Add Product Line
                        </button>
                    </div>

                    <div className="mt-4 space-y-4">
                        {lines.map((line, index) => (
                            <div key={line.id} className="rounded-2xl border border-(--line) bg-white p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm font-semibold text-(--ink)">Product Line {index + 1}</p>
                                    <button
                                        type="button"
                                        onClick={() => removeLine(line.id)}
                                        disabled={lines.length === 1}
                                        className="text-sm font-medium text-(--brand) disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Remove
                                    </button>
                                </div>

                                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                                    <div className="xl:col-span-2">
                                        <SearchableListBox
                                            label="Product Name"
                                            selectedId={line.productId}
                                            selectedLabel={
                                                Number.isFinite(Number(line.productId))
                                                    ? productNameById[Number(line.productId)]
                                                    : undefined
                                            }
                                            onSelect={(value) => updateLine(line.id, "productId", value)}
                                            onOpen={() => {
                                                if (!productListActivated) {
                                                    setProductListActivated(true);
                                                }
                                            }}
                                            onQueryChange={(value) => {
                                                setProductListActivated(true);
                                                setProductQuery(value);
                                            }}
                                            loading={loadingProducts}
                                            hasMore={hasMoreProducts}
                                            onLoadMore={loadMoreProducts}
                                            emptyMessage="No products found."
                                            placeholder="Search products"
                                            options={products.map((product) => ({
                                                id: product.id,
                                                name: product.name,
                                            }))}
                                        />
                                    </div>
                                    <label className="block text-sm">
                                        <span className="mb-2 block font-medium">Ordered Qty</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={line.orderedQty}
                                            onChange={(event) => updateLine(line.id, "orderedQty", event.target.value)}
                                            className="w-full rounded-xl border border-(--line) bg-(--card) px-3 py-2"
                                        />
                                    </label>
                                    <label className="block text-sm">
                                        <span className="mb-2 block font-medium">Available Qty</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={line.availableQty}
                                            onChange={(event) => updateLine(line.id, "availableQty", event.target.value)}
                                            className="w-full rounded-xl border border-(--line) bg-(--card) px-3 py-2"
                                        />
                                    </label>
                                    <label className="block text-sm">
                                        <span className="mb-2 block font-medium">Shortage</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={line.shortageQty}
                                            onChange={(event) => updateLine(line.id, "shortageQty", event.target.value)}
                                            className="w-full rounded-xl border border-(--line) bg-(--card) px-3 py-2"
                                        />
                                    </label>
                                    <label className="block text-sm">
                                        <span className="mb-2 block font-medium">Price (AED)</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={line.unitPrice}
                                            onChange={(event) => updateLine(line.id, "unitPrice", event.target.value)}
                                            className="w-full rounded-xl border border-(--line) bg-(--card) px-3 py-2"
                                        />
                                    </label>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex items-center justify-center rounded-xl bg-(--brand) px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {saving ? "Saving..." : "Save Manual Backorder"}
                    </button>
                    {savedId ? (
                        <Link
                            href={`/orders/pending/manual/${savedId}`}
                            className="inline-flex items-center justify-center rounded-xl border border-(--line) bg-white px-5 py-2.5 text-sm font-medium text-(--ink)"
                        >
                            Open Saved Backorder
                        </Link>
                    ) : null}
                </div>

                <p className="text-sm text-(--ink-soft)">
                    Odoo options load on demand when you open each listbox. Products load 10 at a time and support live search.
                </p>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                {success ? <p className="text-sm text-(--accent)">{success}</p> : null}
            </form>

            {showDuplicateConfirm ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="rounded-2xl border border-(--line) bg-(--card) p-6 shadow-lg sm:max-w-md">
                        <h3 className="font-display text-lg">Order Number Already Exists</h3>
                        <p className="mt-2 text-sm text-(--ink-soft)">
                            An order with the number "{orderNumber}" already exists. Do you want to override it with the current data?
                        </p>
                        <div className="mt-6 flex gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowDuplicateConfirm(false);
                                    setPendingDetails(null);
                                }}
                                className="flex-1 rounded-xl border border-(--line) bg-white px-4 py-2.5 text-sm font-medium text-(--ink) hover:bg-(--chip)"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (pendingDetails) {
                                        setShowDuplicateConfirm(false);
                                        void performSave(pendingDetails, true);
                                    }
                                }}
                                disabled={saving}
                                className="flex-1 rounded-xl bg-(--brand) px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70 hover:opacity-90"
                            >
                                Override
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
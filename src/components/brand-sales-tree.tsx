"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { OdooCustomerSalesBrand } from "@/types/odoo";

function formatNumber(value: number) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * What a customer bought, as an expandable tree: each brand opens to the
 * categories sold under it, and each category opens to its products.
 */
export function BrandSalesTree({ brands, currencyLabel = "AED" }: { brands: OdooCustomerSalesBrand[]; currencyLabel?: string }) {
    const [open, setOpen] = useState<Set<string>>(new Set());
    const grandTotal = brands.reduce((sum, brand) => sum + brand.totalSales, 0);

    function toggle(key: string) {
        setOpen((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    function expandAll(expand: boolean) {
        setOpen(
            expand
                ? new Set(brands.flatMap((brand) => [brand.brandName, ...brand.categories.map((category) => `${brand.brandName}::${category.categoryName}`)]))
                : new Set()
        );
    }

    if (brands.length === 0) {
        return <p className="text-sm text-(--ink-soft)">No sales found for this customer.</p>;
    }

    return (
        <div>
            <div className="mb-2 flex justify-end gap-3 text-xs text-(--ink-soft)">
                <button type="button" onClick={() => expandAll(true)} className="hover:text-(--ink)">
                    Expand all
                </button>
                <button type="button" onClick={() => expandAll(false)} className="hover:text-(--ink)">
                    Collapse all
                </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-(--line)">
                <div className="grid grid-cols-[1fr_5.5rem_8rem] gap-2 bg-(--chip) px-3 py-2 text-xs font-medium text-(--ink-soft)">
                    <span>Brand › Category › Product</span>
                    <span className="text-right">Qty sold</span>
                    <span className="text-right">Sales ({currencyLabel})</span>
                </div>

                {brands.map((brand) => {
                    const brandOpen = open.has(brand.brandName);
                    const share = grandTotal > 0 ? (brand.totalSales / grandTotal) * 100 : 0;
                    return (
                        <div key={brand.brandName} className="border-t border-(--line)">
                            <button
                                type="button"
                                onClick={() => toggle(brand.brandName)}
                                className="grid w-full grid-cols-[1fr_5.5rem_8rem] items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-(--chip)/60"
                                aria-expanded={brandOpen}
                            >
                                <span className="flex min-w-0 items-center gap-2 font-semibold">
                                    <ChevronRight className={`h-4 w-4 shrink-0 text-(--ink-soft) transition ${brandOpen ? "rotate-90" : ""}`} />
                                    <span className="truncate">{brand.brandName}</span>
                                    <span className="shrink-0 rounded-full bg-(--chip) px-2 py-0.5 text-[11px] font-normal text-(--ink-soft)">
                                        {formatNumber(share)}%
                                    </span>
                                </span>
                                <span className="text-right">{formatNumber(brand.quantitySold)}</span>
                                <span className="text-right font-semibold">{formatNumber(brand.totalSales)}</span>
                            </button>

                            {brandOpen
                                ? brand.categories.map((category) => {
                                    const key = `${brand.brandName}::${category.categoryName}`;
                                    const categoryOpen = open.has(key);
                                    return (
                                        <div key={key} className="border-t border-(--line) bg-(--bg)/40">
                                            <button
                                                type="button"
                                                onClick={() => toggle(key)}
                                                className="grid w-full grid-cols-[1fr_5.5rem_8rem] items-center gap-2 py-2 pl-9 pr-3 text-left text-sm hover:bg-(--chip)/60"
                                                aria-expanded={categoryOpen}
                                            >
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <ChevronRight className={`h-4 w-4 shrink-0 text-(--ink-soft) transition ${categoryOpen ? "rotate-90" : ""}`} />
                                                    <span className="truncate">{category.categoryName}</span>
                                                    <span className="shrink-0 text-[11px] text-(--ink-soft)">
                                                        {category.products.length} product{category.products.length === 1 ? "" : "s"}
                                                    </span>
                                                </span>
                                                <span className="text-right">{formatNumber(category.quantitySold)}</span>
                                                <span className="text-right">{formatNumber(category.totalSales)}</span>
                                            </button>

                                            {categoryOpen
                                                ? category.products.map((product) => (
                                                    <div
                                                        key={product.productName}
                                                        className="grid grid-cols-[1fr_5.5rem_8rem] items-center gap-2 border-t border-(--line)/60 bg-white py-1.5 pl-16 pr-3 text-sm text-(--ink-soft)"
                                                    >
                                                        <span className="truncate" title={product.productName}>{product.productName}</span>
                                                        <span className="text-right">{formatNumber(product.quantitySold)}</span>
                                                        <span className="text-right">{formatNumber(product.totalSales)}</span>
                                                    </div>
                                                ))
                                                : null}
                                        </div>
                                    );
                                })
                                : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

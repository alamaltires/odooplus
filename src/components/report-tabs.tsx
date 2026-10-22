"use client";

/** Tabs for switching between the reports of several selected people; renders nothing for a single report. */
export function ReportTabs({ labels, active, onChange }: { labels: string[]; active: number; onChange: (index: number) => void }) {
    if (labels.length < 2) return null;
    return (
        <div className="mt-6 flex flex-wrap gap-2" role="tablist">
            {labels.map((label, index) => (
                <button
                    key={`${label}-${index}`}
                    type="button"
                    role="tab"
                    aria-selected={index === active}
                    onClick={() => onChange(index)}
                    className={`max-w-full truncate rounded-full border px-4 py-1.5 text-sm transition ${
                        index === active ? "border-(--brand) bg-(--brand) font-medium text-white" : "border-(--line) bg-(--card) hover:bg-(--chip)"
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

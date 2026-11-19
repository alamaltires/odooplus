/** The Customer Followup Report covers at most one month: the end date may be at most "same day next month". */

function parts(iso: string): [number, number, number] {
    const [year, month, day] = iso.split("-").map(Number);
    return [year, month, day];
}

/** `iso` plus one calendar month, clamped to the month's last day (31 Jan -> 28/29 Feb). */
export function addOneMonth(iso: string): string {
    const [year, month, day] = parts(iso);
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const target = new Date(Date.UTC(year, month, Math.min(day, lastDay)));
    return target.toISOString().slice(0, 10);
}

/** Latest allowed end date for a given start date. */
export function maxFollowupEnd(startDate: string): string {
    return addOneMonth(startDate);
}

/** Returns an error message, or null when the range is valid. */
export function validateFollowupRange(startDate: string, endDate: string): string | null {
    if (!startDate || !endDate) return "Choose a start date and an end date.";
    if (startDate > endDate) return "The start date must be before the end date.";
    if (endDate > maxFollowupEnd(startDate)) return "The period can be at most 1 month. Pick an end date within one month of the start date.";
    return null;
}

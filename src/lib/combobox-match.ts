/**
 * Search-as-you-type comboboxes (purchase order, product, brand, category,
 * etc. across the report pages) only commit a selection when the user
 * clicks a dropdown row. Typing/pasting the exact name and moving on (e.g.
 * straight to "Generate Report") left the field silently unselected — the
 * typed text stayed on screen but the filter it represented was dropped.
 *
 * This resolves that: given the raw typed text and the candidates currently
 * available (already-fetched search results, or a fully loaded local list),
 * pick the one whose name matches the typed text exactly (case/whitespace
 * insensitive) — never a partial/fuzzy match, since a silently-wrong filter
 * is worse than an ignored one.
 */
export function resolveExactNameMatch<T extends { name: string }>(
    query: string,
    candidates: T[]
): T | null {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    const matches = candidates.filter((item) => item.name.trim().toLowerCase() === normalized);
    return matches.length === 1 ? matches[0] : null;
}

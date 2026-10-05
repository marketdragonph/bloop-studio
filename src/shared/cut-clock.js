// The ONE timing function for the Cut: the preview and the export both use it, so they never disagree.
// Ported from bloop's plan (spaces-mini-timeline/01-timeline.md: "one timing function"). Pure, no DOM.
//
// An item's `join` is how it is joined to the item BEFORE it ("Beat 3, dissolve in"); the first item's
// join is ignored. A dissolve overlaps the two clips, so it makes the cut shorter by its length.

export const DISSOLVE_DEFAULT_MS = 500;
export const DISSOLVE_MIN_MS = 250;
export const DISSOLVE_MAX_MS = 1000;

const lengthOf = (item) => Math.max(0, Math.round((item.out_ms ?? 0) - (item.in_ms ?? 0)));

/**
 * A dissolve's real length between two clips: 250..1000 ms, and never more than half the shorter one.
 * @returns {number} ms (may be under 250 only when half the shorter clip is under 250)
 */
export function dissolveMs(requested, previousMs, currentMs) {
    const asked = Number.isFinite(requested) ? requested : DISSOLVE_DEFAULT_MS;
    const ranged = Math.min(DISSOLVE_MAX_MS, Math.max(DISSOLVE_MIN_MS, Math.round(asked)));
    return Math.max(0, Math.min(ranged, Math.floor(Math.min(previousMs, currentMs) / 2)));
}

/**
 * @param {{ in_ms: number, out_ms: number, join?: { type: 'cut'|'dissolve', ms?: number } }[]} items in cut order
 * @returns {{ total_ms: number, items: { start_ms: number, end_ms: number, length_ms: number, join: { type: 'cut'|'dissolve', ms: number } }[] }}
 *   start_ms/end_ms are on the cut timeline; join.ms is the clamped overlap with the previous item (0 for a cut)
 */
export function cutClock(items = []) {
    let cursor = 0;
    let previousLength = 0;
    const timed = items.map((item, index) => {
        const length = lengthOf(item);
        const dissolve = index > 0 && item.join?.type === 'dissolve';
        const overlap = dissolve ? dissolveMs(item.join.ms, previousLength, length) : 0;
        const start = cursor - overlap;
        cursor = start + length;
        previousLength = length;
        return { start_ms: start, end_ms: cursor, length_ms: length, join: { type: dissolve ? 'dissolve' : 'cut', ms: overlap } };
    });
    return { total_ms: cursor, items: timed };
}

/** Which item plays at a time on the cut timeline (the incoming one during a dissolve), or -1 past the end. */
export function itemAt(clock, ms) {
    for (let i = clock.items.length - 1; i >= 0; i--) {
        if (ms >= clock.items[i].start_ms && ms < clock.items[i].end_ms) return i;
    }
    return -1;
}

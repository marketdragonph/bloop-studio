// Steady sound (owner decision 2026-10-05, docs/plans/katana.md §8 item 8). The speech measure hears "sound that is
// not silence": rain, an engine, a room tone or a generated soundtrack that runs under the whole clip reads as one
// long "line". A detected span covering at least 85 % of a clip is kept apart as `steady` when the clip is measured.
// On a clip whose beat has NO · script card it is background sound, not a spoken line: it does not block trims, does
// not trigger LINE_CUT_OFF and does not duck the music. A clip WITH a script card hears it as a line, as before.
// Pure: the analysis stage splits, the cut readers (heardCache) put it back for scripted clips.

export const STEADY_SHARE = 0.85;

/**
 * At measure time: the spans that are lines, and the one(s) that are steady sound.
 * @param {[number, number][]} speech spans in ms
 * @param {number} lengthMs the measured length
 * @returns {{ speech: [number, number][], steady: [number, number][] }}
 */
export function splitSteady(speech, lengthMs) {
    const spans = Array.isArray(speech) ? speech : [];
    if (!(lengthMs > 0)) return { speech: spans, steady: [] };
    const isSteady = ([a, z]) => z - a >= STEADY_SHARE * lengthMs;
    return { speech: spans.filter((s) => !isSteady(s)), steady: spans.filter(isSteady) };
}

/** A clip's analysis as the cut rules hear it: with a script card, its steady sound is a line again. */
export function heardAs(analysis, scripted) {
    if (!analysis || !scripted || !analysis.steady?.length) return analysis;
    const speech = [...(analysis.speech ?? []), ...analysis.steady].sort((x, y) => x[0] - y[0]);
    return { ...analysis, speech, steady: [] };
}

/**
 * The analysis cache as the cut rules hear it (findings, ducks, trims, captions, the Director's numbers).
 * @param {Map<string, object>} cache media_path → analysis
 * @param {{ media_path: string, beat_tag?: string }[]} items the cut's clips
 * @param {{ has: (tag: string) => boolean }} scripted lower-case beat tags that have a · script card
 */
export function heardCache(cache, items, scripted) {
    const paths = new Set((items ?? []).filter((i) => scripted?.has(String(i.beat_tag ?? '').trim().toLowerCase())).map((i) => i.media_path));
    return new Map([...cache].map(([path, a]) => [path, heardAs(a, paths.has(path))]));
}

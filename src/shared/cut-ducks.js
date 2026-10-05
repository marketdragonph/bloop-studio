// Measured sound placed on the cut (katana.md settled conflict 9): the duck windows under spoken lines and the
// music's beat ticks, in EXPORT time. Only the duck SETTINGS are stored (sound.music.duck); the windows come from
// the measured speech spans here, so a re-trim moves the ducks with the lines. GET /spaces/:id/cut and the export
// both call these, so the dock draws and plays the numbers the file gets. Pure, no DOM, no Node APIs.
import { cutClock } from './cut-clock.js';
import { voiceDuckWindows } from './cut-sound.js';

const MERGE_MS = 200; // lines closer than this share one duck (no pumping between words)

/** Overlapping or near windows become one. */
export function mergeWindows(windows, gap = MERGE_MS) {
    const out = [];
    for (const w of [...windows].filter((x) => x.to_ms > x.from_ms).sort((a, b) => a.from_ms - b.from_ms)) {
        const last = out.at(-1);
        if (last && w.from_ms - last.to_ms <= gap) last.to_ms = Math.max(last.to_ms, w.to_ms);
        else out.push({ from_ms: w.from_ms, to_ms: w.to_ms });
    }
    return out;
}

/**
 * Where each clip's spoken lines play in export time, J and L cuts included: a J cut (join.audio_ms < 0) plays
 * the clip's sound early, so its lines before the in point are heard under the previous clip; an L cut
 * (> 0) lets the previous clip's lines after its out point run on.
 * @param {object[]} items cut items in order
 * @param {(mediaPath: string) => number[][]|null} speechOf source-time spans [from_ms, to_ms] for a clip
 * @returns {{ item_id: string, from_ms: number, to_ms: number }[]}
 */
export function speechInCut(items, speechOf) {
    const clock = cutClock(items);
    const out = [];
    items.forEach((item, i) => {
        if (!item.sound) return;
        const spans = speechOf(item.media_path) ?? [];
        const at = clock.items[i];
        const early = Math.max(0, -(item.join?.audio_ms ?? 0)); // J: this clip's sound starts before its picture
        const late = Math.max(0, items[i + 1]?.join?.audio_ms ?? 0); // L: this sound runs on under the next
        const from = item.in_ms - early;
        const to = item.out_ms + late;
        for (const [a, b] of spans) {
            const s = Math.max(a, from);
            const e = Math.min(b, to);
            if (e > s) out.push({ item_id: item.id, from_ms: at.start_ms + (s - item.in_ms), to_ms: at.start_ms + (e - item.in_ms) });
        }
    });
    return out;
}

/**
 * The music's duck windows: under the voice bed and under every measured spoken line, only when
 * sound.music.duck is set; cut off at the end of the cut.
 */
export function cutDucks({ items = [], sound = null }, speechOf, { voiceMs = 0 } = {}) {
    if (!sound?.music?.duck) return [];
    const total = cutClock(items).total_ms;
    const lines = speechInCut(items, speechOf).map((s) => ({ from_ms: Math.max(0, s.from_ms), to_ms: Math.min(total, s.to_ms) }));
    return mergeWindows([...voiceDuckWindows(sound, voiceMs, total), ...lines]);
}

/**
 * The bed's beats on the cut: the bed starts at export 0 and plays once (never loops), so a beat is on the cut
 * while it is before the end of the cut and the end of the bed.
 * @returns {{ beats_ms: number[], downbeats_ms: number[] }}
 */
export function beatsInCut(analysis, totalMs) {
    const end = Math.min(totalMs, analysis?.duration_ms ?? totalMs);
    const keep = (list) => (Array.isArray(list) ? list.filter((ms) => Number.isFinite(ms) && ms >= 0 && ms <= end) : []);
    return { beats_ms: keep(analysis?.beats), downbeats_ms: keep(analysis?.downbeats) };
}

// The music's duck envelope (01-core.md §5, "ducks are an envelope, not steps"). The preview samples
// duckGain(); the export turns the same windows into one `volume='…':eval=frame` expression with duckExpr().
// Both use the same formula, so they agree at every sample. Pure, no DOM, no Node APIs.
//
// A window {from_ms, to_ms} pulls the music down by `depth_db`: the ramp down ends at from_ms (attack 120 ms),
// it holds, and the ramp up starts at to_ms (release 400 ms). Overlapping windows take the deeper value.
// P3 ducks under the voice bed's span; P4 adds the measured speech spans.
import { DUCK } from './cut-rules.js';

const env = (w, t, attack, release) => {
    const up = Math.min(1, Math.max(0, (t - (w.from_ms - attack)) / attack));
    const down = Math.min(1, Math.max(0, ((w.to_ms + release) - t) / release));
    return up * down;
};

/** Windows under the voice: where it plays in export time, cut off at the end of the cut. */
export function voiceDuckWindows(sound, voiceMs, totalMs) {
    const voice = sound?.voice;
    if (!sound?.music?.duck || !voice || !(voiceMs > 0)) return [];
    const from = Math.max(0, Number(voice.start_ms) || 0);
    const to = Math.min(totalMs, from + voiceMs);
    return to > from ? [{ from_ms: from, to_ms: to }] : [];
}

/** Linear gain 0..1 at `ms` (export time). */
export function duckGain(windows, depthDb = DUCK.default, ms = 0, { attack = DUCK.attack_ms, release = DUCK.release_ms } = {}) {
    if (!windows?.length) return 1;
    const floor = 10 ** (depthDb / 20);
    const deepest = Math.max(...windows.map((w) => env(w, ms, attack, release)));
    return 1 - (1 - floor) * deepest;
}

const n = (v) => Number(v.toFixed(4)).toString();

/** The same envelope as an ffmpeg expression of `t` (seconds), for `volume='…':eval=frame`. '1' with no windows. */
export function duckExpr(windows, depthDb = DUCK.default, { attack = DUCK.attack_ms, release = DUCK.release_ms } = {}) {
    if (!windows?.length) return '1';
    const a = attack / 1000;
    const r = release / 1000;
    const one = (w) => {
        const start = w.from_ms / 1000 - a;
        const end = w.to_ms / 1000 + r;
        const since = start < 0 ? `t+${n(-start)}` : `t-${n(start)}`;
        return `clip((${since})/${n(a)},0,1)*clip((${n(end)}-t)/${n(r)},0,1)`;
    };
    const deepest = windows.map(one).reduce((acc, e) => (acc ? `max(${acc},${e})` : e), '');
    return `1-${n(1 - 10 ** (depthDb / 20))}*${deepest}`;
}

/** Cut on the beat (03-director.md §3, 05 §3.4): an out point this close to an estimated downbeat lands on it. */
export const BEAT_SNAP_MS = 80;

/**
 * The beat `ms` snaps to, or null when none is within `windowMs`. ONE function for the dock's Snap to beats and
 * the Director's validator, so a drag and an op land on the same frame. Beats are export ms, sorted or not.
 */
export function snapToBeat(ms, beatsMs, windowMs = BEAT_SNAP_MS) {
    if (!Number.isFinite(ms) || !Array.isArray(beatsMs)) return null;
    let best = null;
    for (const beat of beatsMs) {
        if (!Number.isFinite(beat)) continue;
        const off = Math.abs(beat - ms);
        if (off <= windowMs && (best === null || off < Math.abs(best - ms))) best = beat;
    }
    return best;
}

// What AnalyzeMedia asks ffmpeg, and how its stderr is read back (03-director.md §5). Pure: no spawn, no fs.
// Every call writes nothing (the null muxer) and carries an output -t, so the capped runner accepts it.
// Times come back in milliseconds, clamped to the media's length; spans are [from_ms, to_ms].
import { parseLoudness } from '../cut/export/recipe.js';

export const SILENCE_DB = -45; // silencedetect for silence (03 §5)
export const SPEECH_DB = -38; // band-passed level that counts as a voice
export const MIN_SILENCE_S = 0.3;
export const FREEZE_NOISE = 0.003; // on a 64×36 grey scale-down; a "still" generated frame still shimmers a little
export const MIN_FREEZE_S = 0.4;
export const SCENE_THRESHOLD = 10;
export const SPEECH_MERGE_MS = 250; // two spans closer than this are one line
export const SPEECH_MIN_MS = 300;
export const PCM_RATE = 11025;

const secs = (ms) => (Math.max(1, ms) / 1000).toFixed(3);
const ms = (s) => Math.round(Number(s) * 1000);

/** Loudness and silence in one pass: ebur128 passes the sound on to silencedetect. */
export const soundArgs = (file, lengthMs) => [
    '-i', file, '-map', '0:a:0',
    '-af', `ebur128=peak=true:framelog=verbose,silencedetect=noise=${SILENCE_DB}dB:d=${MIN_SILENCE_S}`,
    '-t', secs(lengthMs), '-f', 'null', 'NUL',
];

/** Speech spans: the voice band only, then silencedetect; what is not silent there is a spoken line (or sound like one). */
export const speechArgs = (file, lengthMs) => [
    '-i', file, '-map', '0:a:0',
    '-af', `highpass=f=300,lowpass=f=3400,silencedetect=noise=${SPEECH_DB}dB:d=${MIN_SILENCE_S}`,
    '-t', secs(lengthMs), '-f', 'null', 'NUL',
];

/** Still frames and scene changes on a 10 fps, 64×36 grey scale-down (cheap on any CPU). */
export const motionArgs = (file, lengthMs) => [
    '-i', file, '-map', '0:v:0',
    '-vf', `fps=10,scale=64:36,format=gray,freezedetect=n=${FREEZE_NOISE}:d=${MIN_FREEZE_S},scdet=threshold=${SCENE_THRESHOLD}`,
    '-t', secs(lengthMs), '-f', 'null', 'NUL',
];

/** The bed decoded once to 11 kHz mono PCM, for onsets and waveform bars. Written inside the job's temp folder. */
export const pcmArgs = (file, lengthMs, out) => ['-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(PCM_RATE), '-f', 's16le', '-t', secs(lengthMs), out];

const clamp = (value, lengthMs) => Math.min(lengthMs, Math.max(0, value));

/** Merges spans that touch or sit closer than `gap` ms; drops spans shorter than `min` ms. */
export function mergeSpans(spans, { gap = 0, min = 0 } = {}) {
    const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [a, b] of sorted) {
        const last = out.at(-1);
        if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
        else out.push([a, b]);
    }
    return out.filter(([a, b]) => b - a >= min);
}

/** The parts of [0, length] the spans do not cover. */
export function invert(spans, lengthMs) {
    const out = [];
    let at = 0;
    for (const [a, b] of mergeSpans(spans)) {
        if (a > at) out.push([at, a]);
        at = Math.max(at, b);
    }
    if (at < lengthMs) out.push([at, lengthMs]);
    return out;
}

/** silencedetect: start/end pairs; a start with no end runs to the end of the media. */
export function parseSilence(stderr, lengthMs) {
    const spans = [];
    let open = null;
    for (const line of String(stderr ?? '').split(/\r?\n/)) {
        const start = line.match(/silence_start:\s*(-?[\d.]+)/);
        const end = line.match(/silence_end:\s*(-?[\d.]+)/);
        if (start) open = clamp(ms(start[1]), lengthMs);
        else if (end && open != null) {
            spans.push([open, clamp(ms(end[1]), lengthMs)]);
            open = null;
        }
    }
    if (open != null) spans.push([open, lengthMs]);
    return mergeSpans(spans, { gap: 20 });
}

/** Spoken lines: the voice band's non-silent spans, close ones merged, blips dropped. */
export function parseSpeech(stderr, lengthMs) {
    return mergeSpans(invert(parseSilence(stderr, lengthMs), lengthMs), { gap: SPEECH_MERGE_MS, min: SPEECH_MIN_MS });
}

/** freezedetect still spans and scdet scene changes (ms). */
export function parseMotion(stderr, lengthMs) {
    const still = [];
    const scenes = [];
    let open = null;
    for (const line of String(stderr ?? '').split(/\r?\n/)) {
        const start = line.match(/freeze_start:\s*(-?[\d.]+)/);
        const end = line.match(/freeze_end:\s*(-?[\d.]+)/);
        const scene = line.match(/lavfi\.scd\.time:\s*(-?[\d.]+)/);
        if (start) open = clamp(ms(start[1]), lengthMs);
        else if (end && open != null) {
            still.push([open, clamp(ms(end[1]), lengthMs)]);
            open = null;
        }
        if (scene) scenes.push(clamp(ms(scene[1]), lengthMs));
    }
    if (open != null) still.push([open, lengthMs]);
    // freezedetect reports a freeze from its first still frame; it can split one freeze in two at EOF.
    return { still: mergeSpans(still, { gap: 150 }), scenes: [...new Set(scenes)].sort((a, b) => a - b) };
}

/** Still at the head (starts at 0) and at the tail (ends at the media's end), within 150 ms. One span can be both. */
export function headTail(still, lengthMs) {
    const head = still.find(([a]) => a <= 150) ?? null;
    const tail = [...still].reverse().find(([, b]) => b >= lengthMs - 150) ?? null;
    return { still_head: head, still_tail: tail };
}

/** ebur128's summary: {i, tp} or null (silent or unreadable). Shared with the export. */
export const parseLoudnessSummary = parseLoudness;

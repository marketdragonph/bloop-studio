// The picture of one export part per shape (05-irresistible.md §5.4–§5.5): fit (the P3 chain, unchanged), the
// person's crop box (crop then scale, always from the source), or soft bars (the whole clip over a blurred, dimmed
// copy of itself: split, a quarter-size scale + crop, gblur, colorchannelmixer, scaled back up, overlay), then
// the 30 fps grid, then each caption PNG overlaid while its line is spoken. LGPL core filters only: never boxblur
// (GPL), eq, drawtext or subtitles. Pure strings; the crop numbers come from src/shared/cut-frame.js, the same maths
// as the preview.
import { FPS } from '../../../shared/export-presets.js';

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const t3 = (s) => s.toFixed(3);
/** How much the soft bars' background is shrunk before the blur (cheap, and softer). */
export const BARS_SHRINK = 4;
export const BARS_SIGMA = 10;
export const BARS_DIM = 0.55;

/** The P3 chain: the whole clip inside the frame, black bars, 30 fps, 4:2:0. */
export const fitChain = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS}:start_time=0,format=yuv420p`;

/**
 * The crop box in the stored pixels the filter sees (non-square pixels: x and width divide by the SAR).
 * @param {{ x: number, y: number, w: number, h: number }} box display pixels (cut-frame cropBox)
 */
export function cropFilter(box, sar = 1) {
    const s = Number.isFinite(sar) && sar > 0 ? sar : 1;
    return `crop=${even(box.w / s)}:${box.h}:${Math.round(box.x / s)}:${box.y}`;
}

/** Soft bars as one labelled chain from `[in]` to `[out]`. */
export function barsChain(w, h, input, output) {
    const bw = even(w / BARS_SHRINK);
    const bh = even(h / BARS_SHRINK);
    return [
        `${input}split=2[bg][fg]`,
        `[bg]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},gblur=sigma=${BARS_SIGMA},colorchannelmixer=rr=${BARS_DIM}:gg=${BARS_DIM}:bb=${BARS_DIM},scale=${w}:${h}[bgd]`,
        `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs]`,
        `[bgd][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=${FPS}:start_time=0${output}`,
    ].join(';');
}

/**
 * The captions that show during one part, in the part's own time (0 = its first frame).
 * @param {{ id: string, from_ms: number, to_ms: number, file: string, width: number, height: number }[]} cues
 * @param {number} startMs the part's first frame in export time @param {number} lengthMs
 */
export function cuesInPart(cues, startMs, lengthMs) {
    const end = startMs + lengthMs;
    return cues.filter((c) => c.file && c.to_ms > startMs && c.from_ms < end).map((c) => ({
        ...c, a: Math.max(0, (c.from_ms - startMs) / 1000), b: Math.min(lengthMs, c.to_ms - startMs) / 1000,
    }));
}

/**
 * The picture graph of one part. Returns `{ vf }` (a plain chain: no crop box, no caption; the exact P3 args) or
 * `{ graph, map: '[v]', images }` where `images` are the caption PNGs to add as inputs after the clip (and the
 * silence, when there is one) at `firstImage`.
 * @param {{ fit: { mode: 'fit'|'crop'|'bars', box?: object }, width: number, height: number, sar?: number,
 *   captions?: { file: string, a: number, b: number, place: { w: number, h: number, x: number, y: number } }[], firstImage: number }} input
 */
export function pictureGraph({ fit, width, height, sar = 1, captions = [], firstImage }) {
    const mode = fit?.mode ?? 'fit';
    if (mode === 'fit' && !captions.length) return { vf: fitChain(width, height), images: [] };
    const chains = [];
    if (mode === 'bars') chains.push(barsChain(width, height, '[0:v]', '[b0]'));
    else if (mode === 'crop') chains.push(`[0:v]${cropFilter(fit.box, sar)},scale=${width}:${height},setsar=1,fps=${FPS}:start_time=0[b0]`);
    else chains.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS}:start_time=0[b0]`);
    captions.forEach((c, i) => {
        chains.push(`[${firstImage + i}:v]scale=${c.place.w}:${c.place.h}[c${i}]`);
        chains.push(`[b${i}][c${i}]overlay=${c.place.x}:${c.place.y}:enable='between(t,${t3(c.a)},${t3(c.b)})'[b${i + 1}]`);
    });
    chains.push(`[b${captions.length}]format=yuv420p[v]`);
    return { graph: chains.join(';'), map: '[v]', images: captions.map((c) => c.file) };
}

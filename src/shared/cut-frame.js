// Shapes and the crop box (05-irresistible.md §5.4): one set of crop maths for the dock's preview and the export,
// so the frame the person framed is the frame the file gets. An item may hold `frame: {'9:16': {x, y, scale, fit}}`
// per shape: x and y place the box (0 = left/top, 0.5 = centre, 1 = right/bottom), scale zooms in (1 = the
// largest box of that shape inside the clip), fit 'bars' puts the whole clip over a blurred, dimmed copy of itself.
// The box starts centred: never a guess, and the Director never moves it. Pure, no Node or DOM APIs.

export const SHAPES = Object.freeze(['16:9', '9:16', '1:1']);
export const SHAPE_RATIO = Object.freeze({ '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 });
export const FITS = Object.freeze(['crop', 'bars']);
/** Arrow keys nudge 2 %; a crop that upscales more than 2× gets the soft-bars offer. */
export const FRAME = Object.freeze({ scaleMin: 1, scaleMax: 3, nudge: 0.02, softBarsOver: 2 });
export const DEFAULT_FRAME = Object.freeze({ x: 0.5, y: 0.5, scale: 1, fit: 'crop' });

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const even = (v) => Math.max(2, Math.floor(v / 2) * 2);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** The item's box for one shape, every field filled. */
export function frameOf(item, shape) {
    const f = item?.frame?.[shape] ?? {};
    return {
        x: num(f.x) ? clamp01(f.x) : DEFAULT_FRAME.x,
        y: num(f.y) ? clamp01(f.y) : DEFAULT_FRAME.y,
        scale: num(f.scale) ? Math.min(FRAME.scaleMax, Math.max(FRAME.scaleMin, f.scale)) : DEFAULT_FRAME.scale,
        fit: FITS.includes(f.fit) ? f.fit : DEFAULT_FRAME.fit,
    };
}

/** Width and height as the picture is shown: rotation (phone clips) and non-square pixels taken into account. */
export function displaySize({ width, height, sar = 1, rotation = 0 }) {
    const w = Math.round(width * (num(sar) && sar > 0 ? sar : 1));
    return Math.abs(rotation) % 180 === 90 ? { width: height, height: w } : { width: w, height };
}

/**
 * The crop box in the clip's picture: pixels (even, for 4:2:0) and fractions (the preview's CSS). `out` is the
 * output frame, for how much the box is blown up.
 * @param {{ width: number, height: number }} source display size of the clip
 * @param {string} shape '16:9' | '9:16' | '1:1'
 * @param {{ x?: number, y?: number, scale?: number }} [frame]
 * @param {{ width: number, height: number }} [out]
 */
export function cropBox(source, shape, frame = DEFAULT_FRAME, out = null) {
    const ratio = SHAPE_RATIO[shape] ?? SHAPE_RATIO['16:9'];
    const f = frameOf({ frame: { [shape]: frame } }, shape);
    const sw = source.width;
    const sh = source.height;
    const baseW = Math.min(sw, sh * ratio);
    const w = Math.min(sw, even(baseW / f.scale));
    const h = Math.min(sh, even(w / ratio));
    const x = Math.round(f.x * (sw - w));
    const y = Math.round(f.y * (sh - h));
    const upscale = out ? Math.round((out.width / w) * 100) / 100 : null;
    return { x, y, w, h, fx: x / sw, fy: y / sh, fw: w / sw, fh: h / sh, upscale };
}

/** True when the clip already has (about) this shape: nothing to crop. */
export const sameShape = (source, shape) => Math.abs(source.width / source.height - (SHAPE_RATIO[shape] ?? 0)) < 0.01;

/**
 * How one clip fills one output shape:
 * - 'fit'  the whole clip, centred with black bars (the cut's own shape, unframed: what P3 exported);
 * - 'crop' the person's box (centred when they never moved it), scaled to the frame;
 * - 'bars' the whole clip over a blurred, dimmed copy of itself (the person's choice, or soft bars for a crop
 *   that would blow the picture up more than 2×).
 * @param {{ item: object, shape: string, planShape: string, source: { width: number, height: number },
 *   out: { width: number, height: number }, softBars?: boolean }} input
 */
export function fitFor({ item, shape, planShape, source, out, softBars = false }) {
    const own = item?.frame?.[shape];
    if (own?.fit === 'bars') return { mode: 'bars' };
    if (sameShape(source, shape)) return { mode: 'fit' };
    if (!own && shape === planShape) return { mode: 'fit' };
    const box = cropBox(source, shape, own ?? DEFAULT_FRAME, out);
    if (!own && softBars && box.upscale > FRAME.softBarsOver) return { mode: 'bars', upscale: box.upscale };
    return { mode: 'crop', box };
}

/**
 * One item's `frame` as the page or the Director sent it. @returns {string|null} a plain reason, or null
 */
export function checkFrame(frame, label = 'This clip') {
    if (frame == null) return null;
    if (typeof frame !== 'object' || Array.isArray(frame)) return `${label}: its crop box is not readable.`;
    for (const [shape, f] of Object.entries(frame)) {
        if (!SHAPES.includes(shape)) return `${label}: a crop box is for 16:9, 9:16 or 1:1.`;
        if (!f || typeof f !== 'object' || Array.isArray(f)) return `${label}: its ${shape} crop box is not readable.`;
        for (const key of Object.keys(f)) if (!['x', 'y', 'scale', 'fit'].includes(key)) return `${label}: a crop box has x, y, scale and fit only.`;
        for (const key of ['x', 'y']) if (f[key] != null && !(num(f[key]) && f[key] >= 0 && f[key] <= 1)) return `${label}: the crop box sits inside the clip (0 to 1).`;
        if (f.scale != null && !(num(f.scale) && f.scale >= FRAME.scaleMin && f.scale <= FRAME.scaleMax)) return `${label}: the crop box zooms in 1× to ${FRAME.scaleMax}×.`;
        if (f.fit != null && !FITS.includes(f.fit)) return `${label}: a clip is cropped or fitted with soft bars.`;
    }
    return null;
}

/** The frame as it is stored: known shapes only, numbers rounded to 0.001. */
export function cleanFrame(frame) {
    if (!frame || typeof frame !== 'object') return undefined;
    const out = {};
    for (const shape of SHAPES) {
        const f = frame[shape];
        if (!f) continue;
        const r = (v) => Math.round(v * 1000) / 1000;
        out[shape] = {
            ...(num(f.x) ? { x: r(f.x) } : {}), ...(num(f.y) ? { y: r(f.y) } : {}),
            ...(num(f.scale) ? { scale: r(f.scale) } : {}), ...(FITS.includes(f.fit) ? { fit: f.fit } : {}),
        };
    }
    return Object.keys(out).length ? out : undefined;
}

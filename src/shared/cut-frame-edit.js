// The crop box in the dock (05-irresistible.md §5.4): the preview's framing and the box's edits, on top of
// cut-frame.js, the ONE set of crop maths the export uses too. Pure, no DOM: the dock (cut-shape.js, cut-reframe.js)
// and the tests read it.
// - The preview shows exactly what the file holds: fitFor() picks fit / crop / bars, and a crop is drawn from
//   cropBox()'s fractions, so the pixels on screen are the pixels the export keeps.
// - Edits: drag (moveFrame), arrow keys 2 % (nudgeFrame), Home re-centres, + and − or a pinch zoom (zoomFrame).
//   One commit per drag or key press; the Director never moves a box.
import { DEFAULT_FRAME, FRAME, cropBox, fitFor, frameOf } from './cut-frame.js';

const round3 = (v) => Math.round(v * 1000) / 1000;
const pct = (v) => `${round3(v * 100)}%`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const ZOOM_STEP = 0.1;

/** The box's numbers only (fit kept as it was). */
const box = (frame) => ({ x: frame.x, y: frame.y, scale: frame.scale });

/**
 * How the preview draws one clip in one shape: `mode` (fit | crop | bars) and, for a crop, the CSS custom properties
 * that size and place the video inside the shaped screen (percentages, so every preview size shows the same pixels).
 * @param {{ item: object, shape: string, planShape: string, source: {width, height}, out: {width, height}, softBars?: boolean }} input
 */
export function previewFrame(input) {
    if (!(input.source?.width > 0 && input.source?.height > 0)) return { mode: 'fit', vars: {} };
    const fit = fitFor(input);
    if (fit.mode !== 'crop') return { mode: fit.mode, vars: {}, upscale: fit.upscale ?? null };
    const b = fit.box;
    return {
        mode: 'crop',
        upscale: b.upscale,
        vars: {
            '--cut-crop-w': pct(1 / b.fw),
            '--cut-crop-h': pct(1 / b.fh),
            '--cut-crop-x': pct(-b.fx / b.fw),
            '--cut-crop-y': pct(-b.fy / b.fh),
        },
    };
}

/** The crop box over the whole clip (the editor), as CSS percentages of the clip. */
export function boxVars(source, shape, frame) {
    const b = cropBox(source, shape, frame);
    return { '--cut-box-x': pct(b.fx), '--cut-box-y': pct(b.fy), '--cut-box-w': pct(b.fw), '--cut-box-h': pct(b.fh) };
}

/**
 * The frame after dragging the box by (dx, dy) in fractions of the clip. The box stops at the edges; on an axis with
 * no room (the clip is that shape already) the value stays.
 */
export function moveFrame(frame, dx, dy, source, shape) {
    const b = cropBox(source, shape, frame);
    const roomX = source.width - b.w;
    const roomY = source.height - b.h;
    return {
        ...frame,
        x: roomX > 0 ? round3(clamp((b.x + dx * source.width) / roomX, 0, 1)) : frame.x,
        y: roomY > 0 ? round3(clamp((b.y + dy * source.height) / roomY, 0, 1)) : frame.y,
    };
}

/** Arrow keys: 2 % of the room per press. */
export const nudgeFrame = (frame, stepX, stepY) => ({
    ...frame,
    x: round3(clamp(frame.x + stepX * FRAME.nudge, 0, 1)),
    y: round3(clamp(frame.y + stepY * FRAME.nudge, 0, 1)),
});

/** Zoom: `factor` multiplies the scale (a pinch), `step` adds 0.1 per press (+ and −). 1× to 3×. */
export const zoomFrame = (frame, { factor = 1, step = 0 } = {}) => ({
    ...frame,
    scale: round3(clamp(frame.scale * factor + step * ZOOM_STEP, FRAME.scaleMin, FRAME.scaleMax)),
});

/** Home: centred at 1×. */
export const centreFrame = (frame) => ({ ...frame, x: DEFAULT_FRAME.x, y: DEFAULT_FRAME.y, scale: DEFAULT_FRAME.scale });

const isDefault = (f) => f.x === DEFAULT_FRAME.x && f.y === DEFAULT_FRAME.y && f.scale === DEFAULT_FRAME.scale && (f.fit ?? 'crop') === DEFAULT_FRAME.fit;

/**
 * The items with one clip's box for a shape set. A centred, unzoomed crop is stored as `{x: .5, y: .5, scale: 1}` so
 * "I looked and centred is right" survives (fitFor treats any stored box as the person's crop); `null` removes it.
 * Pure; the dock commits it as one undo step.
 */
export function withFrame(items, index, shape, frame) {
    return items.map((item, i) => {
        if (i !== index) return item;
        const rest = { ...(item.frame ?? {}) };
        if (frame == null) delete rest[shape];
        else {
            const f = frameOf({ frame: { [shape]: frame } }, shape);
            rest[shape] = f.fit === 'crop' ? box(f) : f;
        }
        const { frame: _old, ...plain } = item;
        return Object.keys(rest).length ? { ...plain, frame: rest } : plain;
    });
}

export const isCentred = (frame) => isDefault({ fit: 'crop', ...frame });

/** "34 % across, 50 % down, 1.4×" for the box's aria-valuetext and the announcement. */
export function frameText(frame) {
    const zoom = frame.scale > 1 ? `, ${Math.round(frame.scale * 10) / 10}×` : '';
    return `${Math.round(frame.x * 100)} % across, ${Math.round(frame.y * 100)} % down${zoom}`;
}

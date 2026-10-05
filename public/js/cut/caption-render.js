// The caption look, drawn in the page (05-irresistible.md §5.5): Inter 700 on a dark plate with a thin orange cut on
// the left, in each shape's safe area, never Orbitron. ONE set of numbers for both:
// - the preview: captionVars() feeds the screen's CSS (container units), so the caption scales with the picture;
// - the export: renderCaptionPng() draws each caption as a PNG at the 1080 px reference, which the export overlays
//   scaled to the output (cut-captions.js placeCaption). Colours come from the design tokens, read at draw time.
import { CAPTION_REF_PX, CAPTION_SAFE, CAPTIONS } from '/shared/cut-captions.js';

/** Sizes at the 1080 px reference (short side of the frame). */
export const CAPTION_LOOK = Object.freeze({
    fontPx: 52, // Inter 700
    lineHeight: 1.25,
    padX: 28,
    padY: 14,
    cutPx: 4, // the orange cut on the left (2 px on a 540 px preview)
    font: 'Inter',
    weight: 700,
});

/** The preview screen's caption variables for a shape (the short side's share of the width, the safe line). */
export function captionVars(shape) {
    const shortOfWidth = shape === '16:9' ? 9 / 16 : 1; // 9:16 and 1:1: the short side is the width
    return {
        '--cut-caption-unit': `calc(${shortOfWidth} * 100cqi / ${CAPTION_REF_PX})`,
        '--cut-caption-bottom': `${(CAPTION_SAFE[shape] ?? CAPTION_SAFE['16:9']) * 100}%`,
        '--cut-caption-font': String(CAPTION_LOOK.fontPx),
        '--cut-caption-pad-x': String(CAPTION_LOOK.padX),
        '--cut-caption-pad-y': String(CAPTION_LOOK.padY),
        '--cut-caption-cut': String(CAPTION_LOOK.cutPx),
    };
}

const token = (name, fallbackName) => {
    const style = globalThis.getComputedStyle?.(document.documentElement);
    return style?.getPropertyValue(name).trim() || style?.getPropertyValue(fallbackName).trim() || '';
};

/** Waits for Inter 700 so the first PNG is not drawn in a fallback face. */
async function fontReady() {
    try { await document.fonts?.load(`${CAPTION_LOOK.weight} ${CAPTION_LOOK.fontPx}px ${CAPTION_LOOK.font}`); } catch { /* the canvas falls back */ }
}

/**
 * One caption as a PNG at the 1080 px reference: `{ id, png (base64, no prefix), width, height }`.
 * Refused (null) when it would pass the export's limits (2000 × 600 px, 200 KB).
 * @param {{ id: string, lines: string[] }} cue
 */
export async function renderCaptionPng(cue) {
    await fontReady();
    const look = CAPTION_LOOK;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${look.weight} ${look.fontPx}px ${look.font}, system-ui, sans-serif`;
    ctx.font = font;
    const lines = (cue.lines ?? []).slice(0, CAPTIONS.linesPerCue);
    const textW = Math.ceil(Math.max(1, ...lines.map((l) => ctx.measureText(l).width)));
    const lineH = Math.round(look.fontPx * look.lineHeight);
    const width = Math.min(CAPTIONS.pngMaxWidth, look.cutPx + look.padX * 2 + textW);
    const height = Math.min(CAPTIONS.pngMaxHeight, look.padY * 2 + lineH * lines.length);
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = token('--media-scrim-deck', '--media-ground');
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = token('--accent', '--on-media');
    ctx.fillRect(0, 0, look.cutPx, height);
    ctx.font = font;
    ctx.fillStyle = token('--on-media', '--text-primary');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const centre = look.cutPx + (width - look.cutPx) / 2;
    lines.forEach((line, i) => ctx.fillText(line, centre, look.padY + lineH * i + lineH / 2, width - look.cutPx - look.padX * 2));
    const png = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    if (Math.floor(png.length * 3 / 4) > CAPTIONS.pngMaxBytes) return null;
    return { id: cue.id, png, width, height };
}

/** Every cue as a PNG, in order; a cue that cannot be drawn is left out (the .srt still has it). */
export async function renderCaptionPngs(cues) {
    const out = [];
    for (const cue of cues.slice(0, CAPTIONS.maxCues)) {
        const png = await renderCaptionPng(cue).catch(() => null);
        if (png) out.push(png);
    }
    return out;
}

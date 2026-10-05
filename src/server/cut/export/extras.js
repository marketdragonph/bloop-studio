// P6 side work of one export row (05-irresistible.md §5.3, §5.5): PrepareCaptions reads the caption PNGs the page
// drew at the press (kept beside the job, one folder per group) and places each in this row's frame; SideFiles
// writes the .srt (every export with spoken lines, burned in or not) and the preview GIF (6 s from the poster,
// the long side 480 px, 12 fps, palettegen + paletteuse, at most 8 MB; one smaller retry, then skipped). A GIF
// or an .srt that fails never fails the export; captions the person asked for that cannot be read stop it
// in plain words, because the file would not be what they pressed for.
import { readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { placeCaption, toSrt } from '../../../shared/cut-captions.js';
import { JobStop } from '../tools-jobs.js';
import { gifArgs } from './recipe.js';

export const GIF = Object.freeze({ seconds: 6, longSide: 480, fps: 12, capBytes: 8 * 1024 * 1024, retry: { longSide: 360, fps: 10 } });
const PNG_MAGIC = '89504e470d0a1a0a';

/** Width and height from a PNG's IHDR chunk; null when the bytes are not a PNG. */
export function pngSize(bytes) {
    if (!bytes || bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== PNG_MAGIC || bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The poster time in export ms: the cut's set poster, else the middle of the first clip. */
export const posterMs = (ctx) => {
    const set = Number(ctx.snapshot.settings?.poster_ms);
    const first = ctx.layout.items[0];
    const at = Number.isFinite(set) && set >= 0 ? set : ((first?.lenF ?? 0) / 2) * (1000 / 30);
    return Math.max(0, Math.min(at, ctx.totalMs - 100));
};

const toolsSay = async (ctx, output) => {
    const state = await ctx.deps.tools?.state?.();
    return state?.outputs?.[output] ?? { ready: true, reason: null };
};

export async function prepareCaptions(ctx, next) {
    const asked = ctx.options?.captions;
    ctx.captions = [];
    if (asked?.mode !== 'burned' || !(ctx.options.cues ?? []).length) return next();
    const ready = await toolsSay(ctx, 'captions');
    if (!ready.ready) {
        ctx.report.captions = { burned: false, text: ready.reason };
        return next();
    }
    const out = { width: ctx.output.width, height: ctx.output.height, shape: ctx.output.aspect };
    for (const cue of ctx.options.cues) {
        ctx.alive();
        const file = join(asked.dir ?? '', `${cue.id}.png`);
        let size = null;
        try {
            size = pngSize(await readFile(file));
        } catch { /* below */ }
        if (!size) throw new JobStop('captions', 'The captions were not saved with the export. Export again to draw them.');
        ctx.captions.push({ ...cue, file, width: size.width, height: size.height, place: placeCaption(out, size) });
    }
    ctx.report.captions = { burned: true, count: ctx.captions.length };
    await next();
}

export async function sideFiles(ctx, next) {
    ctx.side = {};
    const cues = ctx.options?.cues ?? [];
    if (cues.length) {
        const srt = join(ctx.tmp, 'captions.srt');
        await writeFile(srt, toSrt(cues), 'utf8');
        ctx.side.srt = srt;
    }
    if (ctx.options?.gif !== false) await previewGif(ctx);
    await next();
}

async function previewGif(ctx) {
    const ready = await toolsSay(ctx, 'gif');
    if (!ready.ready) {
        ctx.report.gif = { made: false, text: ready.reason };
        return;
    }
    const out = join(ctx.tmp, 'preview.gif');
    const at = Math.max(0, Math.min(posterMs(ctx), ctx.totalMs - GIF.seconds * 1000)) / 1000;
    const seconds = Math.min(GIF.seconds, ctx.totalMs / 1000 - at);
    const portrait = ctx.output.height > ctx.output.width;
    for (const [i, size] of [{ longSide: GIF.longSide, fps: GIF.fps }, GIF.retry].entries()) {
        try {
            await ctx.step(gifArgs({ input: ctx.final, atSec: at, seconds, portrait, out, ...size }), {
                label: 'Making the preview GIF', weight: i === 0 ? ctx.weights.gif ?? 0 : 0, timeoutMs: 60_000, capBytes: GIF.capBytes,
            });
            const { size: bytes } = existsSync(out) ? await stat(out) : { size: 0 };
            // -fs stops at the cap and leaves a cut-off file: a GIF that reached it is made again smaller.
            if (bytes > 0 && bytes < GIF.capBytes - 64 * 1024) {
                ctx.side.gif = out;
                ctx.report.gif = { made: true, bytes, long_side: size.longSide, fps: size.fps, seconds: Math.round(seconds * 10) / 10 };
                return;
            }
        } catch (error) {
            if (error.name === 'AbortError' || ctx.gone) throw error;
            ctx.deps.log?.warn?.(`Cut export ${ctx.exportId}: no GIF: ${error.message}`);
            ctx.report.gif = { made: false, text: 'The preview GIF could not be made. The video is fine.' };
            return;
        }
    }
    ctx.report.gif = { made: false, text: 'The preview GIF did not fit in 8 MB, so it was skipped.' };
}

// NormalizeClips and JoinClips (01-core.md §6, P3 spike fixes). One part at a time: every clip becomes its
// head/body/tail parts (PCM sound, 30 fps, scaled into the frame); each dissolve junction mixes a tail and a
// head of the same frame count; the concat demuxer copies the pieces into one file of exactly the total.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JobStop } from '../tools-jobs.js';
import { concatArgs, concatList, junctionArgs, normalizeArgs, secs } from './recipe.js';

const partFile = (ctx, name) => join(ctx.tmp, `${name}.mov`);
const clipStop = (item, error) => {
    if (error.name === 'AbortError' || error.code === 'ETIMEDOUT' || error.code === 'ENOENT' || error instanceof JobStop) return error;
    return new JobStop('clip', `The export stopped at ${item.label}. That clip could not be read.`, { beat: item.beat_tag ?? null });
};

export async function normalizeClips(ctx, next) {
    const n = ctx.items.length;
    const { width, height } = ctx.output;
    for (const part of ctx.layout.parts) {
        const item = ctx.items[part.item];
        const seconds = part.frames / 30;
        const args = normalizeArgs({
            src: item.src, startSec: item.in_ms / 1000 + part.offsetF / 30, frames: part.frames,
            withSound: item.sound !== false && item.hasAudio, width, height, out: partFile(ctx, part.name),
        });
        try {
            await ctx.step(args, { label: `Preparing clip ${item.index + 1} of ${n}`, weight: ctx.weights.part(part), timeoutMs: Math.max(60_000, 4000 * seconds) });
        } catch (error) {
            throw clipStop(item, error);
        }
    }
    await next();
}

export async function joinClips(ctx, next) {
    const n = ctx.items.length;
    for (const j of ctx.layout.junctions) {
        const item = ctx.items[j.item];
        const args = junctionArgs({ tail: partFile(ctx, j.tail), head: partFile(ctx, j.head), frames: j.frames, out: partFile(ctx, j.name) });
        try {
            await ctx.step(args, { label: `Joining clip ${item.index + 1} of ${n}`, weight: ctx.weights.junction(j), timeoutMs: 60_000 });
        } catch (error) {
            throw clipStop(item, error);
        }
    }
    const list = join(ctx.tmp, 'list.txt');
    await writeFile(list, concatList(ctx.layout.order.map((name) => partFile(ctx, name))));
    ctx.joined = join(ctx.tmp, 'joined.mov');
    const total = Number(secs(ctx.layout.totalFrames));
    await ctx.step(concatArgs({ list, frames: ctx.layout.totalFrames, out: ctx.joined }), {
        label: 'Joining the clips', weight: ctx.weights.concat, timeoutMs: Math.max(60_000, (total / 2) * 1000),
    });
    await next();
}

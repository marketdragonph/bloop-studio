// CheckCut and ProbeSources (01-core.md §6). CheckCut runs the preflight on the revision the person pressed
// Export on (held in ctx; later edits never change a running export) and refuses in plain words with zero
// processes. ProbeSources reads every clip and bed with ffprobe (20 s each), clamps trims to the real length,
// notes which clips have sound, lays the parts out on the 30 fps grid and weighs the steps for the progress bar.
import { JobStop } from '../tools-jobs.js';
import { preflight } from '../preflight.js';
import { durationMs } from '../../generation/measure-take.js';
import { layoutParts, msOf, toFrames } from './recipe.js';

const PROBE_SHARE = 0.03; // of the bar, before the step weights are known

export async function checkCut(ctx, next) {
    const { boardCut, media, tools, exists, statfs } = ctx.deps;
    ctx.progress.report(0, 'Checking the cut');
    const check = await preflight({ spaceId: ctx.spaceId, snapshot: ctx.snapshot, preset: ctx.preset, boardCut, media, tools, exists, statfs });
    if (!check.ok) throw new JobStop(check.code, check.reason, { beat: check.beat });
    ctx.items = check.items;
    ctx.output = check.output;
    ctx.audioEncoder = check.audio_encoder ?? 'aac_mf';
    ctx.report.skipped = check.skipped;
    await next();
}

const couldNotRead = (item) => new JobStop('clip', `The export stopped at ${item.label}. That clip could not be read.`, { beat: item.beat_tag ?? null });

/** The bed file of a sound track: its pinned path, else the card's newest take. */
function bedPath(db, media, track) {
    if (!track) return null;
    const rel = track.media_path
        ?? db.prepare('SELECT media_path FROM takes WHERE node_id = ? ORDER BY id DESC LIMIT 1').get(track.node_id)?.media_path
        ?? db.prepare('SELECT media_path FROM space_nodes WHERE id = ?').get(track.node_id)?.media_path;
    return rel ? media.resolve(rel) : null;
}

export async function probeSources(ctx, next) {
    const { ffmpeg, db, media } = ctx.deps;
    const n = ctx.items.length;
    for (const item of ctx.items) {
        ctx.alive();
        ctx.progress.report((PROBE_SHARE * item.index) / n, `Reading clip ${item.index + 1} of ${n}`);
        let info;
        try {
            info = await ffmpeg.probe(item.src, { signal: ctx.signal });
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            throw couldNotRead(item);
        }
        const streams = info?.streams ?? [];
        const realMs = durationMs(info);
        if (!streams.some((s) => s.codec_type === 'video') || !realMs) throw couldNotRead(item);
        item.hasAudio = streams.some((s) => s.codec_type === 'audio');
        if (item.out_ms > realMs) item.out_ms = realMs;
        if (toFrames(item.out_ms - item.in_ms) < 1) throw new JobStop('clip', `The export stopped at ${item.label}. Its trim is past the end of the clip.`, { beat: item.beat_tag ?? null });
    }
    ctx.beds = {};
    for (const kind of ['music', 'voice']) {
        const track = ctx.snapshot.sound?.[kind];
        const path = bedPath(db, media, track);
        if (!track || !path) continue;
        ctx.alive();
        try {
            const ms = durationMs(await ffmpeg.probe(path, { signal: ctx.signal }));
            if (ms) ctx.beds[kind] = { ...track, path, ms };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            throw new JobStop('sound', `The ${kind} could not be read. Remove it from the cut, or try again.`);
        }
    }
    ctx.layout = layoutParts(ctx.items);
    ctx.totalMs = msOf(ctx.layout.totalFrames);
    weigh(ctx);
    await next();
}

/** Step weights in output seconds × how heavy the step is (encode 1, copy and measure much less). */
function weigh(ctx) {
    const s = (frames) => frames / 30;
    const total = s(ctx.layout.totalFrames);
    const hasBed = Boolean(ctx.beds.music || ctx.beds.voice);
    ctx.weights = {
        part: (p) => s(p.frames),
        junction: (j) => s(j.frames),
        concat: total * 0.02,
        mix: hasBed ? total * 0.05 : 0,
        measure: total * 0.03,
        finish: total * 0.05,
        poster: 0.05,
    };
    const sum = ctx.layout.parts.reduce((a, p) => a + s(p.frames), 0) + ctx.layout.junctions.reduce((a, j) => a + s(j.frames), 0)
        + ctx.weights.concat + ctx.weights.mix + ctx.weights.measure + ctx.weights.finish + ctx.weights.poster;
    ctx.tracker.start(PROBE_SHARE, sum);
}

// AnalyzeMedia's stages (03-director.md §5), each `handle(ctx, next)`: probe → loudness (+ silence) → speech →
// motion → onsets → peaks → store. Every ffmpeg call goes through the capped runner as a child process, writes
// nothing (the null muxer) except the bed's PCM in the job's temp folder, and has a timeout of max(30 s, 2 × length).
// One measure that fails is left out and noted; the video tools missing (ENOENT) stops the whole job.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { durationMs } from '../generation/measure-take.js';
import { makeJobDir, removeDir } from '../cut/tools-jobs.js';
import { headTail, motionArgs, parseLoudnessSummary, parseMotion, parseSilence, parseSpeech, pcmArgs, soundArgs, speechArgs, PCM_RATE } from './parse.js';
import { analyzeBeats, peaksOf, samplesOf } from './onsets.js';

export const ANALYZER_VERSION = 2; // 2: no beats unless at least half land on an onset
export const MAX_MEDIA_MS = 600_000; // beds (and clips) are measured up to 10 minutes

const timeoutFor = (lengthMs) => Math.max(30_000, 2 * lengthMs);
const fatal = (error) => error?.name === 'AbortError' || error?.code === 'ENOENT';

/** Runs one measuring step; a failure that is not fatal is noted and the job moves on. */
async function measure(ctx, what, fn) {
    try {
        await fn();
    } catch (error) {
        if (fatal(error)) throw error;
        ctx.data.errors.push(`${what}: ${String(error.message).slice(0, 200)}`);
    }
}

const run = (ctx, args, extra = {}) => ctx.deps.ffmpeg.run(args, { analysis: !extra.outputDir, timeoutMs: timeoutFor(ctx.lengthMs), signal: ctx.signal, ...extra });

export async function probe(ctx, next) {
    const info = await ctx.deps.ffmpeg.probe(ctx.full, { signal: ctx.signal });
    const streams = info?.streams ?? [];
    const duration = durationMs(info);
    if (!duration) throw Object.assign(new Error('The file has no length.'), { code: 'EMEDIA' });
    ctx.lengthMs = Math.min(duration, MAX_MEDIA_MS);
    ctx.data.duration_ms = duration;
    ctx.data.has_audio = streams.some((s) => s.codec_type === 'audio');
    ctx.data.has_video = streams.some((s) => s.codec_type === 'video' && !/^(mjpeg|png)$/.test(s.codec_name ?? ''));
    await next();
}

export async function loudness(ctx, next) {
    if (ctx.data.has_audio) {
        await measure(ctx, 'loudness', async () => {
            const { stderr } = await run(ctx, soundArgs(ctx.full, ctx.lengthMs));
            ctx.data.loudness = parseLoudnessSummary(stderr);
            ctx.data.silence = parseSilence(stderr, ctx.lengthMs);
        });
    }
    await next();
}

/** Spoken lines in a clip or the voice bed; a music bed's "speech" would be the music, so it is skipped. */
export async function speech(ctx, next) {
    if (ctx.data.has_audio && ctx.role !== 'music') {
        await measure(ctx, 'speech', async () => {
            const { stderr } = await run(ctx, speechArgs(ctx.full, ctx.lengthMs));
            ctx.data.speech = parseSpeech(stderr, ctx.lengthMs);
        });
    }
    await next();
}

export async function motion(ctx, next) {
    if (ctx.data.has_video) {
        await measure(ctx, 'motion', async () => {
            const { stderr } = await run(ctx, motionArgs(ctx.full, ctx.lengthMs));
            const { still, scenes } = parseMotion(stderr, ctx.lengthMs);
            Object.assign(ctx.data, { still, scenes }, headTail(still, ctx.lengthMs));
        });
    }
    await next();
}

/** Beds only: one PCM decode feeds the beat estimate and the waveform bars. */
export async function onsets(ctx, next) {
    if (ctx.data.has_audio && ctx.role !== 'clip') {
        await measure(ctx, 'beats', async () => {
            ctx.tmp = await makeJobDir(ctx.deps.media, 'analysis', ctx.jobId);
            const out = join(ctx.tmp, 'bed.pcm');
            const capBytes = Math.ceil(PCM_RATE * 2 * (ctx.lengthMs / 1000) * 1.1) + 65_536;
            await run(ctx, pcmArgs(ctx.full, ctx.lengthMs, out), { outputDir: ctx.tmp, capBytes });
            ctx.samples = samplesOf(await readFile(out));
            if (ctx.role === 'music') {
                const beats = await analyzeBeats(ctx.samples);
                Object.assign(ctx.data, { bpm: beats.bpm, beats: beats.beats_ms, downbeats: beats.downbeats_ms, onsets: beats.onsets_ms });
            }
        });
    }
    try {
        await next();
    } finally {
        await removeDir(ctx.tmp);
    }
}

export async function peaks(ctx, next) {
    if (ctx.samples?.length) ctx.data.peaks = peaksOf(ctx.samples, ctx.lengthMs);
    ctx.samples = null;
    await next();
}

export async function store(ctx, next) {
    ctx.row = ctx.deps.repo.save(ctx.path, { size: ctx.stat.size, mtimeMs: ctx.stat.mtimeMs, version: ANALYZER_VERSION, status: 'done', data: ctx.data });
    await next();
}

export const ANALYSIS_STAGES = Object.freeze([probe, loudness, speech, motion, onsets, peaks, store]);

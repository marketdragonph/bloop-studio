// MixSound and Loudness (01-core.md §5–§6). MixSound lays the music bed (once, never looped, ducked under the
// voice by the shared envelope, faded out at its end) and the voice under the clip sound, still PCM. Loudness
// measures the mix with ebur128 (null muxer, nothing written), turns it into one linear gain toward the
// preset's target (capped by the true-peak ceiling), and runs the one AAC encode with that gain: aac_mf, or
// native aac only when this PC has no aac_mf. No measurement: no gain, and the report says so.
import { join } from 'node:path';
import { FINAL_CAP_BYTES } from '../../media/capped-ffmpeg.js';
import { duckExpr } from '../../../shared/cut-sound.js';
import { cutDucks } from '../../../shared/cut-ducks.js';
import { DUCK, FADE_OUT, MUSIC_LEVEL, VOICE_LEVEL } from '../../../shared/cut-rules.js';
import { TRUE_PEAK_CEILING } from '../../../shared/export-presets.js';
import { finishArgs, loudnessGain, measureArgs, mixArgs, parseLoudness } from './recipe.js';

const level = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
export const NOT_MEASURED = 'Loudness not set: the mix was not measured.';

export async function mixSound(ctx, next) {
    const { music, voice } = ctx.beds;
    const total = ctx.totalMs;
    const playVoice = voice && level(voice.start_ms, 0) < total ? voice : null;
    if (!music && !playVoice) {
        ctx.mixed = ctx.joined;
        return next();
    }
    let musicInput = null;
    if (music) {
        const playMs = Math.min(music.ms, total);
        const fadeMs = Math.min(playMs, level(music.fade_out_ms, FADE_OUT.default));
        // Under the voice bed and every measured spoken line (P4), the same windows the dock draws.
        const speech = ctx.deps.analysis?.cached(ctx.snapshot.items.map((i) => i.media_path)) ?? new Map();
        const windows = cutDucks(ctx.snapshot, (path) => speech.get(path)?.speech ?? null, { voiceMs: voice?.ms ?? 0 })
            .map((w) => ({ from_ms: w.from_ms, to_ms: Math.min(w.to_ms, total) })).filter((w) => w.to_ms > w.from_ms);
        musicInput = {
            path: music.path, ms: playMs, gainDb: level(music.gain_db, MUSIC_LEVEL.default),
            fadeMs, fadeFromMs: Math.max(0, playMs - fadeMs),
            duckExpr: windows.length ? duckExpr(windows, level(music.duck?.depth_db, DUCK.default)) : null,
        };
        ctx.report.ducks = windows;
    }
    const voiceInput = playVoice && {
        path: playVoice.path, ms: Math.min(playVoice.ms, total - level(playVoice.start_ms, 0)),
        startMs: level(playVoice.start_ms, 0), gainDb: level(playVoice.gain_db, VOICE_LEVEL.default),
    };
    ctx.mixed = join(ctx.tmp, 'mixed.mov');
    await ctx.step(mixArgs({ joined: ctx.joined, music: musicInput, voice: voiceInput, frames: ctx.layout.totalFrames, out: ctx.mixed }), {
        label: 'Mixing the sound', weight: ctx.weights.mix, timeoutMs: Math.max(120_000, total),
    });
    await next();
}

export async function loudness(ctx, next) {
    const frames = ctx.layout.totalFrames;
    let gain = null;
    try {
        const { stderr } = await ctx.step(measureArgs({ input: ctx.mixed, frames }), {
            label: 'Setting the loudness', weight: ctx.weights.measure, timeoutMs: Math.max(30_000, ctx.totalMs), analysis: true,
        });
        // A loudness the Director set on the person's word (level target_lufs, P4) wins over the preset's.
        gain = loudnessGain(parseLoudness(stderr), ctx.snapshot.settings?.target_lufs ?? ctx.output.lufs, TRUE_PEAK_CEILING);
    } catch (error) {
        if (error.name === 'AbortError' || ctx.gone) throw error;
        ctx.deps.log?.warn?.(`Cut export ${ctx.exportId}: loudness not measured: ${error.message}`);
    }
    ctx.report.loudness = gain ?? { gain_db: null, text: NOT_MEASURED };
    ctx.final = join(ctx.tmp, 'final.mp4');
    await ctx.step(finishArgs({ input: ctx.mixed, frames, gainDb: gain?.gain_db ?? 0, audioEncoder: ctx.audioEncoder, out: ctx.final }), {
        label: 'Finishing the file', weight: ctx.weights.finish, timeoutMs: Math.max(120_000, ctx.totalMs), capBytes: FINAL_CAP_BYTES,
    });
    await next();
}

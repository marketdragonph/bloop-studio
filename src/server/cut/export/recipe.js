// The exact ffmpeg commands of the Mini Katana export (01-core.md §6, with the P3 spike's fixes):
// 1. a dissolve's sound is afade out + afade in + amix (acrossfade writes no audio next to xfade);
// 2. every part and junction sits on the 30 fps grid, and `fps=30:start_time=0`;
// 3. parts carry PCM in .mov; AAC is encoded once, in the finish step.
// Pure functions: no spawn here. Every call still goes through CappedFfmpeg (output -t, -fs, timeout).
import { cutClock } from '../../../shared/cut-clock.js';
import { FPS, VIDEO_BITRATE, AUDIO_BITRATE } from '../../../shared/export-presets.js';
import { GIF_ENCODER, PART_AUDIO_CODEC, POSTER_ENCODER, VIDEO_ENCODER } from '../../../shared/export-recipes.js';
import { pictureGraph } from './frame-chain.js';

export const VENC = ['-c:v', VIDEO_ENCODER, '-b:v', `${VIDEO_BITRATE / 1_000_000}M`, '-g', String(FPS * 2)];
const PCM = ['-c:a', PART_AUDIO_CODEC, '-ar', '48000', '-ac', '2'];

export const toFrames = (ms) => Math.round((Math.max(0, ms) * FPS) / 1000);
/** Seconds of `frames` at 30 fps, six decimals (0.7667 s for 23 frames: ffmpeg keeps exactly 23). */
export const secs = (frames) => (frames / FPS).toFixed(6);
export const msOf = (frames) => Math.round((frames * 1000) / FPS);
const pad = (n) => String(n).padStart(2, '0');

/**
 * Splits the cut into parts on the frame grid. Item boundaries come from the one clock, rounded to frames,
 * so the total is the clock's total within half a frame. A dissolve gives the item before it a `tail` and
 * the item after it a `head` of the same length; the junction mixes the two. Σ order lengths = total.
 * @returns {{ parts: object[], junctions: object[], order: string[], totalFrames: number, items: object[] }}
 */
export function layoutParts(items) {
    // A dissolve snaps on its own (0.75 s → 23 frames, as the spike measured); each clip's END snaps from the
    // clock, so rounding never adds up along the cut and the total stays within half a frame.
    const clock = cutClock(items);
    const grid = [];
    clock.items.forEach((c, i) => {
        let d = i > 0 && c.join.type === 'dissolve' ? toFrames(c.join.ms) : 0;
        if (i > 0) d = Math.min(d, grid[i - 1].endF - grid[i - 1].startF - grid[i - 1].din); // the clip before holds its head and this tail
        const startF = i > 0 ? grid[i - 1].endF - d : 0;
        grid.push({ startF, endF: Math.max(startF + d + 1, toFrames(c.end_ms)), din: d });
    });
    const dinOf = (i) => grid[i].din;
    const parts = [];
    const junctions = [];
    const order = [];
    const timed = items.map((item, i) => {
        const lenF = grid[i].endF - grid[i].startF;
        const din = dinOf(i);
        const dout = i + 1 < items.length ? dinOf(i + 1) : 0;
        const tag = pad(i + 1);
        const part = (kind, offsetF, frames) => {
            const p = { name: `${tag}-${kind}`, item: i, kind, offsetF, frames };
            parts.push(p);
            return p;
        };
        if (din > 0) part('head', 0, din);
        const bodyFrames = lenF - din - dout;
        const body = bodyFrames > 0 ? part('body', din, bodyFrames) : null;
        if (dout > 0) part('tail', lenF - dout, dout);
        if (din > 0) {
            const name = `${pad(i)}-${tag}-join`;
            junctions.push({ name, tail: `${pad(i)}-tail`, head: `${tag}-head`, frames: din, item: i });
            order.push(name);
        }
        if (body) order.push(body.name);
        return { index: i, startF: grid[i].startF, lenF, din, dout };
    });
    return { parts, junctions, order, totalFrames: grid.at(-1)?.endF ?? 0, items: timed };
}

/**
 * One part of one clip: fitted, cropped (P6: the person's box for this shape) or set on soft bars, 30 fps, with
 * the caption PNGs that show during it, and PCM sound padded to the exact length. Sound off or no audio stream:
 * silence from anullsrc, capped by its own input -t and the output -t. No box and no caption: the P3 args.
 */
export function normalizeArgs({ src, startSec, frames, withSound, width, height, out, fit = null, sar = 1, captions = [] }) {
    const len = secs(frames);
    const inputs = ['-ss', startSec.toFixed(6), '-i', src];
    if (!withSound) inputs.push('-f', 'lavfi', '-t', len, '-i', 'anullsrc=r=48000:cl=stereo');
    const picture = pictureGraph({ fit, width, height, sar, captions, firstImage: withSound ? 1 : 2 });
    for (const image of picture.images) inputs.push('-i', image); // one still frame each: overlay holds it
    const video = picture.vf ? ['-map', '0:v:0', '-map', withSound ? '0:a:0' : '1:a:0', '-vf', picture.vf]
        : ['-filter_complex', picture.graph, '-map', picture.map, '-map', withSound ? '0:a:0' : '1:a:0'];
    return [
        '-y', ...inputs, ...video,
        '-af', `aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${len}`,
        ...VENC, ...PCM, '-t', len, out,
    ];
}

/** One dissolve junction of `frames`: xfade for the picture, afade out/in + amix for the sound (spike fix 1). */
export function junctionArgs({ tail, head, frames, out }) {
    const d = secs(frames);
    const graph = [
        `[0:v][1:v]xfade=transition=fade:duration=${d}:offset=0,format=yuv420p[v]`,
        `[0:a]afade=t=out:d=${d}[a0]`,
        `[1:a]afade=t=in:d=${d}[a1]`,
        `[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,apad=whole_dur=${d}[a]`,
    ].join(';');
    return ['-y', '-i', tail, '-i', head, '-filter_complex', graph, '-map', '[v]', '-map', '[a]', ...VENC, ...PCM, '-t', d, out];
}

/** The concat demuxer's list: file paths only, single quotes escaped. */
export const concatList = (paths) => `${paths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n')}\n`;

export const concatArgs = ({ list, frames, out }) => ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v', '-map', '0:a', '-c', 'copy', '-t', secs(frames), out];

/**
 * Music and voice under the clip sound. The bed plays once from 0 (never looped), at its level, ducked by the
 * envelope expression, fading out over its last `fadeMs` before the cut or the bed ends. Output keeps PCM.
 */
export function mixArgs({ joined, music, voice, frames, out }) {
    const inputs = ['-i', joined];
    const chains = [];
    const labels = ['[0:a]'];
    let n = 1;
    if (music) {
        inputs.push('-i', music.path);
        const steps = [`atrim=0:${(music.ms / 1000).toFixed(3)}`, 'asetpts=PTS-STARTPTS', `volume=${music.gainDb}dB`];
        if (music.duckExpr && music.duckExpr !== '1') steps.push(`volume='${music.duckExpr}':eval=frame`);
        if (music.fadeMs > 0) steps.push(`afade=t=out:st=${(music.fadeFromMs / 1000).toFixed(3)}:d=${(music.fadeMs / 1000).toFixed(3)}`);
        steps.push('aresample=48000', 'aformat=channel_layouts=stereo');
        chains.push(`[${n}:a]${steps.join(',')}[m]`);
        labels.push('[m]');
        n += 1;
    }
    if (voice) {
        inputs.push('-i', voice.path);
        const steps = [`atrim=0:${(voice.ms / 1000).toFixed(3)}`, 'asetpts=PTS-STARTPTS', `adelay=${Math.round(voice.startMs)}:all=1`, `volume=${voice.gainDb}dB`, 'aresample=48000', 'aformat=channel_layouts=stereo'];
        chains.push(`[${n}:a]${steps.join(',')}[vo]`);
        labels.push('[vo]');
    }
    chains.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0[a]`);
    return ['-y', ...inputs, '-filter_complex', chains.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', ...PCM, '-t', secs(frames), out];
}

/** Measures the mix (integrated loudness, true peak). Writes nothing: the null muxer. */
export const measureArgs = ({ input, frames }) => ['-i', input, '-map', '0:a', '-af', 'ebur128=peak=true', '-t', secs(frames), '-f', 'null', 'NUL'];

/** {i, tp} from ebur128's summary (the last one in stderr), or null when it was silent or unreadable. */
export function parseLoudness(stderr) {
    const text = String(stderr ?? '');
    const at = text.lastIndexOf('Summary:');
    if (at < 0) return null;
    const summary = text.slice(at);
    const i = Number(summary.match(/\bI:\s*(-?[\d.]+)\s*LUFS/)?.[1]);
    const tp = Number(summary.match(/\bPeak:\s*(-?[\d.]+)\s*dBFS/)?.[1]);
    if (!Number.isFinite(i) || i <= -70) return null;
    return { i, tp: Number.isFinite(tp) ? tp : null };
}

/** One linear gain toward the target, capped so the true peak stays under the ceiling. */
export function loudnessGain(measured, targetLufs, ceiling) {
    if (!measured) return null;
    let gain = targetLufs - measured.i;
    let capped = false;
    if (measured.tp != null && measured.tp + gain > ceiling) {
        gain = ceiling - measured.tp;
        capped = true;
    }
    gain = Math.max(-30, Math.min(30, gain));
    return { gain_db: Math.round(gain * 100) / 100, target_lufs: targetLufs, measured_lufs: measured.i, measured_tp: measured.tp, capped, reached_lufs: Math.round((measured.i + gain) * 10) / 10 };
}

/** The one AAC encode: picture copied, the gain applied, faststart for playback while it loads. */
export function finishArgs({ input, frames, gainDb, audioEncoder, out }) {
    const af = gainDb ? ['-af', `volume=${gainDb}dB`] : [];
    return ['-y', '-i', input, '-map', '0:v', '-map', '0:a', '-c:v', 'copy', ...af, '-c:a', audioEncoder, '-b:a', `${AUDIO_BITRATE / 1000}k`, '-ar', '48000', '-ac', '2', '-t', secs(frames), '-movflags', '+faststart', out];
}

/**
 * The preview GIF (05 §5.3): up to 6 s from `atSec`, the long side 480 px (or less on a retry), 12 fps, one
 * palette made for these frames (palettegen + paletteuse). Capped at 8 MB by the runner's -fs.
 */
export function gifArgs({ input, atSec, seconds, longSide = 480, fps = 12, portrait = false, out }) {
    const size = portrait ? `-2:${longSide}` : `${longSide}:-2`;
    const graph = `[0:v]fps=${fps},scale=${size}:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4[g]`;
    return ['-y', '-ss', atSec.toFixed(3), '-t', seconds.toFixed(3), '-i', input, '-filter_complex', graph, '-map', '[g]', '-an', '-c:v', GIF_ENCODER, '-loop', '0', '-t', seconds.toFixed(3), out];
}

/** The poster frame (05 §5.3): one JPEG at `atSec`. */
export const posterArgs = ({ input, atSec, out }) => ['-y', '-ss', atSec.toFixed(3), '-i', input, '-frames:v', '1', '-c:v', POSTER_ENCODER, '-q:v', '3', '-t', '0.04', out];

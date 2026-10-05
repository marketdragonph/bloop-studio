// The only way the app runs ffmpeg/ffprobe. Every call is capped: an output -t, a file-size cap (-fs),
// two threads, a timeout that kills the process, and cancel through an AbortSignal. Ported from bloop's
// CappedFfmpeg rule set (spaces-mini-timeline/01-timeline.md §4); adapted for a desktop: spawn (never blocks
// the event loop), Windows-safe priority instead of `nice`, and ffmpeg found locally instead of on a server.
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setPriority } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXE = process.platform === 'win32' ? '.exe' : '';
const MB = 1024 * 1024;
/**
 * Per-step cap = 2 × (seconds × 8 Mbit/s), never under 16 MB; the final file gets 1.5 GB. The floor (P6 gate): a
 * 0.5 s dissolve junction at 1920 × 1080 is ~1.4 MB (its key frame alone is several hundred KB), and -fs cut it
 * at 1 MB without an error, three frames short.
 */
export const FINAL_CAP_BYTES = 1536 * MB;
export const STEP_CAP_FLOOR = 16 * MB;
export const capForSeconds = (seconds) => Math.ceil(Math.max(STEP_CAP_FLOOR, 2 * seconds * MB));
export const PROBE_TIMEOUT_MS = 20_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const INFO_TIMEOUT_MS = 10_000;
const INFO_STDOUT_CAP = MB;
const STDERR_KEEP = 4000;
const ANALYSIS_STDERR_KEEP = 16_000;

export class FfmpegRefused extends Error {}

const APP_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Where ffmpeg and ffprobe live: a path from Settings, else BLOOP_FFMPEG, else the bundled copy
 * (resources/ffmpeg), else the dev copy `npm run fetch:ffmpeg` left in vendor/ffmpeg (not in the installer's
 * asar), else whatever PATH has. ffprobe sits next to the ffmpeg that was found. Never the engine folder.
 */
export function locateFfmpeg({ settingsPath, env = process.env, resourcesPath = process.resourcesPath, exists = existsSync, appRoot = APP_ROOT } = {}) {
    const beside = (ffmpeg) => ({ ffmpeg, ffprobe: join(dirname(ffmpeg), `ffprobe${EXE}`), source: null });
    if (settingsPath) return { ...beside(settingsPath), source: 'settings' };
    if (env.BLOOP_FFMPEG) return { ...beside(env.BLOOP_FFMPEG), source: 'env' };
    if (resourcesPath) {
        const bundled = join(resourcesPath, 'ffmpeg', `ffmpeg${EXE}`);
        if (exists(bundled)) return { ...beside(bundled), source: 'bundled' };
    }
    if (appRoot) {
        const dev = join(appRoot, 'vendor', 'ffmpeg', `ffmpeg${EXE}`);
        if (exists(dev)) return { ...beside(dev), source: 'vendor' };
    }
    return { ffmpeg: `ffmpeg${EXE}`, ffprobe: `ffprobe${EXE}`, source: 'path' };
}

/** Index of the last `-i` input; everything after it (bar the last arg) is output options. */
const lastInputIndex = (args) => args.lastIndexOf('-i');

/** Seconds of the output -t, or null when there is none. */
export function outputSeconds(args) {
    const from = lastInputIndex(args);
    for (let i = args.length - 2; i > from; i--) {
        if (args[i] === '-t') {
            const seconds = Number(args[i + 1]);
            return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
        }
    }
    return null;
}

const IMAGE = /\.(png|jpe?g)$/i;

/**
 * P6 (05 §5.5): an input `-loop` repeats a picture forever, so it is allowed only as `-loop 1` on an image input
 * with its own `-t` before that input's `-i`. An output `-loop` (the GIF muxer's play count) loops nothing.
 */
function assertImageLoop(args) {
    const last = lastInputIndex(args);
    args.forEach((arg, i) => {
        if (arg !== '-loop' || i > last) return;
        const input = args.indexOf('-i', i);
        const own = args.slice(i, input);
        if (args[i + 1] !== '1' || !IMAGE.test(args[input + 1] ?? '') || !own.includes('-t')) {
            throw new FfmpegRefused('-loop is allowed only as -loop 1 on an image input with its own -t.');
        }
    });
}

/** Throws FfmpegRefused when a call could run long or grow without bound. */
export function assertCapped(args) {
    if (!Array.isArray(args) || args.length < 2 || args.some((a) => typeof a !== 'string')) {
        throw new FfmpegRefused('ffmpeg args must be a list of strings ending with the output file.');
    }
    if (lastInputIndex(args) < 0) throw new FfmpegRefused('ffmpeg call has no -i input.');
    if (outputSeconds(args) === null) throw new FfmpegRefused('ffmpeg call has no output -t; every output must be capped in time.');
    if (args.includes('-stream_loop')) throw new FfmpegRefused('-stream_loop is not allowed.');
    assertImageLoop(args);
    for (const arg of args) {
        if (/\baloop\b/.test(arg)) throw new FfmpegRefused('aloop is not allowed.');
        for (const m of arg.matchAll(/\bapad\b(=[^,;[\]]*)?/g)) {
            if (!/\b(whole_dur|pad_dur)=/.test(m[1] ?? '')) throw new FfmpegRefused('apad needs whole_dur or pad_dur.');
        }
    }
}

/** True when the call writes nothing: `-f null` to NUL (or -), the analysis calls (01-core.md §6). */
export function isNullOutput(args) {
    const from = lastInputIndex(args);
    const out = args.at(-1);
    const f = args.indexOf('-f', from + 1);
    return f > from && args[f + 1] === 'null' && (out === 'NUL' || out === '-' || out === '/dev/null');
}

/** P3: an export step may only write inside its job's temp dir (or to the null muxer). */
export function assertOutputInside(args, dir) {
    if (!dir || isNullOutput(args)) return;
    const root = resolve(dir) + sep;
    if (!resolve(args.at(-1)).startsWith(root)) throw new FfmpegRefused('ffmpeg may only write inside the job\'s temp folder.');
}

export class CappedFfmpeg {
    /**
     * @param {{ getSettingsPath?: () => string|undefined, spawn?: typeof nodeSpawn, env?: object, resourcesPath?: string }} [options]
     *   `spawn` is injectable so tests run a fake ffmpeg script, never a real encoder.
     */
    constructor({ getSettingsPath = () => undefined, spawn = nodeSpawn, env, resourcesPath } = {}) {
        this.getSettingsPath = getSettingsPath;
        this.spawn = spawn;
        this.env = env;
        this.resourcesPath = resourcesPath;
    }

    locate() {
        return locateFfmpeg({ settingsPath: this.getSettingsPath(), env: this.env ?? process.env, resourcesPath: this.resourcesPath ?? process.resourcesPath });
    }

    /**
     * Runs one capped ffmpeg call. `args` are inputs, filters and output options, ending with the output file.
     * @param {string[]} args
     * `outputDir` (P3): the output must sit under it. `analysis`: a null-muxer measuring call (ebur128) whose
     * summary is read from stderr, so it logs at info level; it may not write a file.
     * @param {{ timeoutMs?: number, capBytes?: number, signal?: AbortSignal, onProgress?: (ratio: number) => void,
     *   outputDir?: string, analysis?: boolean }} [options]
     * @returns {Promise<{ stderr: string }>}
     */
    run(args, { timeoutMs = DEFAULT_TIMEOUT_MS, capBytes, signal, onProgress, outputDir, analysis = false } = {}) {
        assertCapped(args);
        assertOutputInside(args, outputDir);
        if (analysis && !isNullOutput(args)) throw new FfmpegRefused('An analysis call writes no file: use -f null NUL.');
        const seconds = outputSeconds(args);
        const cap = String(Math.floor(capBytes ?? capForSeconds(seconds)));
        const output = args.at(-1);
        const full = [
            '-nostdin', '-hide_banner', '-loglevel', analysis ? 'info' : 'error', ...(analysis ? ['-nostats'] : []), '-progress', 'pipe:1',
            ...args.slice(0, -1), '-fs', cap, '-threads', '2', output,
        ];
        const totalUs = seconds * 1_000_000;
        let lastRatio = -1;
        const report = (ratio) => {
            const clamped = Math.min(1, Math.max(0, ratio));
            if (clamped !== lastRatio) onProgress?.((lastRatio = clamped));
        };
        let buffered = '';
        const onStdout = (chunk) => {
            buffered += chunk;
            const lines = buffered.split(/\r?\n/);
            buffered = lines.pop();
            for (const line of lines) {
                const [key, value] = line.split('=');
                if (key === 'out_time_us' && /^\d+$/.test(value)) report(Number(value) / totalUs);
                else if (key === 'progress' && value === 'end') report(1);
            }
        };
        const stderrKeep = analysis ? ANALYSIS_STDERR_KEEP : STDERR_KEEP;
        return this.#exec(this.locate().ffmpeg, full, { timeoutMs, signal, onStdout, what: 'ffmpeg', stderrKeep });
    }

    /**
     * Info calls with no input and no output (`-version`, `-encoders`, `-filters`, `ffprobe -version`): no `-i`
     * allowed, 10 s timeout (20 s for ffprobe), stdout capped at 1 MB.
     * @param {string[]} args
     * @param {{ tool?: 'ffmpeg'|'ffprobe', signal?: AbortSignal }} [options]
     * @returns {Promise<string>} stdout
     */
    async info(args, { tool = 'ffmpeg', signal } = {}) {
        if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new FfmpegRefused('info args must be strings.');
        if (args.includes('-i')) throw new FfmpegRefused('An info call reads no input.');
        const located = this.locate();
        const bin = tool === 'ffprobe' ? located.ffprobe : located.ffmpeg;
        const timeoutMs = tool === 'ffprobe' ? PROBE_TIMEOUT_MS : INFO_TIMEOUT_MS;
        const { stdout } = await this.#exec(bin, ['-hide_banner', ...args.filter((a) => a !== '-hide_banner')], {
            timeoutMs, signal, what: tool, keepStdout: true, maxStdout: INFO_STDOUT_CAP,
        });
        return stdout;
    }

    /** Reads a file's format and streams with ffprobe (JSON), capped at 20 s. */
    async probe(file, { signal } = {}) {
        const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file];
        const { stdout } = await this.#exec(this.locate().ffprobe, args, { timeoutMs: PROBE_TIMEOUT_MS, signal, what: 'ffprobe', keepStdout: true });
        try {
            return JSON.parse(stdout);
        } catch {
            throw new Error('ffprobe did not return JSON.');
        }
    }

    #exec(bin, args, { timeoutMs, signal, onStdout, what, keepStdout = false, maxStdout = Infinity, stderrKeep = STDERR_KEEP }) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(abortError());
            let child;
            try {
                child = this.spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            } catch (error) {
                return reject(error);
            }
            let stdout = '';
            let stderr = '';
            let settled = false;
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                fn(value);
            };
            const kill = () => {
                try {
                    child.kill('SIGKILL');
                } catch { /* already gone */ }
            };
            const timer = setTimeout(() => {
                kill();
                finish(reject, Object.assign(new Error(`${what} took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`), { code: 'ETIMEDOUT' }));
            }, timeoutMs);
            const onAbort = () => {
                kill();
                finish(reject, abortError());
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            try {
                if (child.pid) setPriority(child.pid, 10); // `nice -n 10`: the board stays responsive
            } catch { /* not allowed on this system: run at normal priority */ }

            child.stdout?.setEncoding('utf8');
            child.stdout?.on('data', (chunk) => {
                if (keepStdout) stdout += chunk;
                if (stdout.length > maxStdout) {
                    kill();
                    finish(reject, Object.assign(new Error(`${what} wrote more than expected and was stopped.`), { code: 'ETOOBIG' }));
                    return;
                }
                onStdout?.(chunk);
            });
            child.stderr?.setEncoding('utf8');
            child.stderr?.on('data', (chunk) => {
                stderr = (stderr + chunk).slice(-stderrKeep);
            });
            child.on('error', (error) => finish(reject, error));
            child.on('close', (code) => {
                if (code === 0) return finish(resolve, { stdout, stderr });
                finish(reject, Object.assign(new Error(`${what} failed (exit ${code}): ${stderr.trim() || 'no message'}`), { code: 'EFFMPEG', exitCode: code }));
            });
        });
    }
}

const abortError = () => Object.assign(new Error('Canceled.'), { name: 'AbortError', code: 'ABORT_ERR' });

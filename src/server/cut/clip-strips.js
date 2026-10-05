// ClipStrips: the filmstrip sheet of each clip in a cut (src/shared/cut-strips.js). Made once per file (a take's file
// never changes, so the path is the key) on the media-tools queue at analysis priority: behind every export and
// pack, one at a time, as a capped ffmpeg child at below-normal priority, so the event loop and the GPU never wait.
// The sheet (.jpg) and its layout (.json) sit in the media folder's .bloop-cache/strips. A file that fails is not
// tried again this session. When a board's missing sheets are made, one `cut` event tells its dock to reload.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STRIP, stripLayout } from '../../shared/cut-strips.js';
import { durationMs } from '../generation/measure-take.js';
import { mediaUrl } from './board-cut.js';

const SHEET_CAP_BYTES = 16 * 1024 * 1024;
const SHEET_TIMEOUT_MS = 120_000;

export const stripKey = (path) => createHash('sha1').update(`${STRIP.version}:${path}`).digest('hex').slice(0, 24);

/** The ffmpeg call for one sheet: every frame `every_ms` apart, cropped to a tile, laid out in a grid, one image. */
export function sheetArgs(full, layout, out) {
    const vf = `fps=1000/${layout.every_ms},scale=${STRIP.tileW}:${STRIP.tileH}:force_original_aspect_ratio=increase,crop=${STRIP.tileW}:${STRIP.tileH},tile=${layout.cols}x${layout.rows}`;
    return ['-hide_banner', '-loglevel', 'error', '-i', full, '-an', '-sn', '-vf', vf, '-frames:v', '1', '-q:v', '5',
        '-t', String(Math.ceil(layout.duration_ms / 1000) + 1), '-y', out];
}

export class ClipStrips {
    /**
     * @param {{ ffmpeg: import('../media/capped-ffmpeg.js').CappedFfmpeg, media: { resolve: (p: string) => string|null },
     *   queue: import('../media/tools-queue.js').ToolsQueue, events?: { emit: Function }, log?: Pick<Console, 'warn'> }} deps
     */
    constructor({ ffmpeg, media, queue, events = null, log = console }) {
        Object.assign(this, { ffmpeg, media, queue, events, log });
        this.known = new Map(); // path → the sheet's layout + url
        this.pending = new Map(); // path → promise
        this.failed = new Set();
    }

    /** The sheets already made for these paths: Map(path → {url, every_ms, frames, cols, rows, tile_w, tile_h}). */
    async many(paths) {
        const out = new Map();
        await Promise.all([...new Set(paths)].map(async (path) => {
            const sheet = await this.#read(path);
            if (sheet) out.set(path, sheet);
        }));
        return out;
    }

    /**
     * Queues every missing sheet; when any was made, one `cut` event (by 'analysis') tells that board's dock to reload.
     * @param {number} spaceId  @param {string[]} paths  @param {number} revision the cut's, for the event
     */
    ensureAll(spaceId, paths, revision = 0) {
        const missing = [...new Set(paths)].filter((p) => p && !this.known.has(p) && !this.failed.has(p));
        if (!missing.length) return Promise.resolve(0);
        return Promise.all(missing.map((p) => this.ensure(p))).then((made) => {
            const count = made.filter(Boolean).length;
            if (count) this.events?.emit('cut', { spaceId, revision, by: 'analysis', added: [], changed: [], missing: [], turn: null, offer: null, strips: count });
            return count;
        });
    }

    /** Makes the sheet unless it exists. Resolves with true when this call made it; never rejects. */
    ensure(path) {
        if (this.pending.has(path)) return this.pending.get(path);
        const job = (async () => {
            if (await this.#read(path)) return false;
            await this.queue.add({ key: `strip:${path}`, kind: 'analysis', run: (signal) => this.#make(path, signal) });
            return true;
        })().catch((error) => {
            if (error?.name !== 'AbortError') {
                this.failed.add(path);
                this.log.warn?.(`Filmstrip of ${path} stopped: ${error.message}`);
            }
            return false;
        }).finally(() => this.pending.delete(path));
        this.pending.set(path, job);
        return job;
    }

    #rel(path, ext) {
        return `${STRIP.dir}/${stripKey(path)}${ext}`;
    }

    async #read(path) {
        if (this.known.has(path)) return this.known.get(path);
        const json = this.media.resolve(this.#rel(path, '.json'));
        if (!json) return null;
        try {
            const layout = JSON.parse(await readFile(json, 'utf8'));
            if (layout.version !== STRIP.version) return null;
            const sheet = { ...layout, url: mediaUrl(this.#rel(path, '.jpg')) };
            this.known.set(path, sheet);
            return sheet;
        } catch {
            return null;
        }
    }

    async #make(path, signal) {
        const full = this.media.resolve(path);
        const dir = this.media.resolve(STRIP.dir);
        if (!full || !dir) throw new Error('outside the media folder');
        await mkdir(dir, { recursive: true });
        const info = await this.ffmpeg.probe(full, { signal });
        if (!(info?.streams ?? []).some((s) => s.codec_type === 'video')) throw new Error('no picture');
        const ms = durationMs(info);
        if (!ms) throw new Error('no length');
        const layout = stripLayout(ms);
        const key = stripKey(path);
        const part = join(dir, `${key}.part.jpg`);
        try {
            await this.ffmpeg.run(sheetArgs(full, layout, part), { signal, outputDir: dir, capBytes: SHEET_CAP_BYTES, timeoutMs: SHEET_TIMEOUT_MS });
            await rename(part, join(dir, `${key}.jpg`));
        } finally {
            await rm(part, { force: true });
        }
        await writeFile(join(dir, `${key}.json`), JSON.stringify({ version: STRIP.version, ...layout }));
        this.known.set(path, { version: STRIP.version, ...layout, url: mediaUrl(this.#rel(path, '.jpg')) });
    }
}

// AnalyzeMedia (03-director.md §5): measures a file once and caches it in media_analysis, keyed by path, size,
// mtime and ANALYZER_VERSION. Jobs run on the media-tools queue at analysis priority (behind every export and pack
// the person pressed), one at a time, as child processes: the event loop never blocks and the GPU worker never
// waits. Only media that is in a cut, is a bed, or that inspect_cut asks for is measured (CutAnalysis below):
// a board building 40 shots does not also run 40 analyses nobody asked for.
import { stat as fsStat } from 'node:fs/promises';
import { runPipeline } from '../generation/pipeline.js';
import { ANALYSIS_STAGES, ANALYZER_VERSION } from './stages.js';

const DEBOUNCE_MS = 1000;

/** What a cut asks to be measured: every clip, the music bed and the voice bed. */
export function mediaOfCut(cut) {
    const list = (cut?.items ?? []).filter((i) => i.media_path).map((i) => ({ path: i.media_path, role: 'clip' }));
    if (cut?.sound?.music?.media_path) list.push({ path: cut.sound.music.media_path, role: 'music' });
    if (cut?.sound?.voice?.media_path) list.push({ path: cut.sound.voice.media_path, role: 'voice' });
    const seen = new Set();
    return list.filter((m) => !seen.has(m.path) && seen.add(m.path));
}

export class AnalyzeMedia {
    /**
     * @param {{ ffmpeg: import('../media/capped-ffmpeg.js').CappedFfmpeg, media: { resolve: (p: string) => string|null },
     *   repo: import('../repositories/media-analysis.js').MediaAnalysisRepository, queue: import('../media/tools-queue.js').ToolsQueue,
     *   stat?: typeof fsStat, stages?: Function[], log?: Pick<Console, 'warn'> }} deps
     */
    constructor(deps) {
        this.deps = { stat: fsStat, stages: ANALYSIS_STAGES, log: console, ...deps };
        this.pending = new Map(); // path → promise
        this.jobs = 0;
        this.toolsMissing = false;
    }

    /** The cached measures for these paths (no freshness check, no job): Map(path → data). */
    cached(paths) {
        const out = new Map();
        for (const [path, row] of this.deps.repo.many(paths)) out.set(path, row.data);
        return out;
    }

    /** True while a path is waiting or being measured. */
    measuring(path) {
        return this.pending.has(path);
    }

    /**
     * Measures `path` unless a fresh result is cached. Resolves with the row (status 'done' or 'failed') or null when
     * the file is gone or the tools are missing; never rejects.
     */
    ensure(path, role = 'clip') {
        if (this.pending.has(path)) return this.pending.get(path);
        const job = this.#ensure(path, role).catch((error) => {
            if (error?.name !== 'AbortError') this.deps.log.warn?.(`Analysis of ${path} stopped: ${error.message}`);
            return null;
        }).finally(() => this.pending.delete(path));
        this.pending.set(path, job);
        return job;
    }

    /**
     * Measures every listed file, waiting at most `ms` (inspect_cut waits 3 s), then answers with what it has.
     * @param {{ path: string, role: string }[]} list
     * @returns {Promise<Map<string, object>>} path → data, for the files measured by then
     */
    async waitFor(list, ms = 3000) {
        const jobs = list.map((m) => this.ensure(m.path, m.role));
        let timer;
        await Promise.race([Promise.all(jobs), new Promise((resolve) => { timer = setTimeout(resolve, ms); timer.unref?.(); })]);
        clearTimeout(timer);
        return this.cached(list.map((m) => m.path));
    }

    async #ensure(path, role) {
        const { media, repo, stat } = this.deps;
        const full = media.resolve(path);
        if (!full) return null;
        let info;
        try {
            info = await stat(full);
        } catch {
            return null;
        }
        const key = { size: info.size, mtimeMs: info.mtimeMs, version: ANALYZER_VERSION };
        const fresh = repo.fresh(path, key);
        if (fresh) return fresh;
        const jobId = `${Date.now().toString(36)}-${(this.jobs += 1)}`;
        return this.deps.queue.add({ key: `analysis:${path}`, kind: 'analysis', run: (signal) => this.#run({ path, full, role, stat: info, jobId, signal }) });
    }

    async #run({ path, full, role, stat, jobId, signal }) {
        const ctx = { deps: this.deps, path, full, role, stat, jobId, signal, data: { role, errors: [], speech: [], silence: [], still: [], scenes: [] } };
        try {
            await runPipeline(this.deps.stages, ctx);
            this.toolsMissing = false;
            return ctx.row;
        } catch (error) {
            if (error?.code === 'ENOENT') {
                this.toolsMissing = true;
                return null; // never cached: the person can install the tools
            }
            if (error?.name === 'AbortError') throw error;
            return this.deps.repo.save(path, { size: stat.size, mtimeMs: stat.mtimeMs, version: ANALYZER_VERSION, status: 'failed', error: String(error.message).slice(0, 300) });
        }
    }
}

/**
 * Measures what each saved cut holds, a second after it settles (one listener on the board's `cut` events), and
 * tells the dock: a `cut` event with `analysis: {state: 'measuring', pending}` when files are being measured, and
 * one with the end state when they are done (the dock reloads and draws the beats, ducks and spoken lines).
 */
export class CutAnalysis {
    constructor({ events, cuts, analysis, debounceMs = DEBOUNCE_MS }) {
        Object.assign(this, { events, cuts, analysis, debounceMs });
        this.timers = new Map();
        this.onCut = (update) => {
            if (update?.by !== 'analysis') this.#later(update.spaceId);
        };
    }

    start() {
        this.events.on('cut', this.onCut);
        return this;
    }

    stop() {
        this.events.off('cut', this.onCut);
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
    }

    async #measure(spaceId) {
        const list = mediaOfCut(this.cuts.find(spaceId));
        const jobs = list.map((m) => this.analysis.ensure(m.path, m.role));
        const pending = list.filter((m) => this.analysis.measuring?.(m.path)).length;
        if (!pending) return;
        const tell = (analysis) => this.events.emit('cut', { spaceId, revision: this.cuts.find(spaceId)?.revision ?? 0, by: 'analysis', added: [], changed: [], missing: [], turn: null, offer: null, analysis });
        tell({ state: 'measuring', pending });
        await Promise.all(jobs);
        tell({ state: this.analysis.toolsMissing ? 'missing' : 'done', pending: 0 });
    }

    #later(spaceId) {
        clearTimeout(this.timers.get(spaceId));
        const timer = setTimeout(() => {
            this.timers.delete(spaceId);
            this.#measure(spaceId);
        }, this.debounceMs);
        timer.unref?.();
        this.timers.set(spaceId, timer);
    }
}

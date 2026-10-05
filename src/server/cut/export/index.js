// The Mini Katana export (01-core.md §6): the person's Export press makes one cut_exports row holding the cut
// as pressed, and the media-tools queue runs it through the stages below, one job at a time, off the GPU worker.
// Cancel aborts the running ffmpeg child; a deleted space is noticed on the next progress write and stops the
// job too. The temp folder goes in `finally`, whatever happened. Nothing here starts by itself: the dock and
// the Director never call start().
import { existsSync } from 'node:fs';
import { runPipeline } from '../../generation/pipeline.js';
import { JobProgress, endFor, jobView, makeJobDir, removeDir } from '../tools-jobs.js';
import { preflight } from '../preflight.js';
import { DEFAULT_PRESET, checkPreset } from '../../../shared/export-presets.js';
import { checkCut, probeSources } from './check-probe.js';
import { joinClips, normalizeClips } from './build-picture.js';
import { loudness, mixSound } from './finish-sound.js';
import { storeResult } from './store-result.js';

const WATCH_MS = 1000;

export const EXPORT_STAGES = Object.freeze([checkCut, probeSources, normalizeClips, joinClips, mixSound, loudness, storeResult]);

/** Weighted progress: a fixed share for probing, then each step by its output seconds × weight. */
class StepTracker {
    constructor() {
        Object.assign(this, { base: 0, total: 0, done: 0, current: 0 });
    }

    start(base, total) {
        Object.assign(this, { base, total: Math.max(total, 1e-6), done: 0, current: 0 });
    }

    at(ratio) {
        return this.base + (1 - this.base) * Math.min(1, (this.done + ratio * this.current) / this.total);
    }
}

export class CutExporter {
    /**
     * @param {{ db: object, cuts: object, exportsRepo: import('../../repositories/cut-exports.js').CutExportsRepository,
     *   boardCut: object, spaces: object, media: object, ffmpeg: import('../../media/capped-ffmpeg.js').CappedFfmpeg,
     *   tools: import('../../media/video-tools.js').VideoTools|null, events: object, queue: import('../../media/tools-queue.js').ToolsQueue,
     *   exists?: Function, statfs?: Function, log?: Pick<Console, 'warn'|'error'>, stages?: Function[] }} deps
     */
    constructor(deps) {
        this.deps = { log: console, ...deps };
        this.stages = deps.stages ?? EXPORT_STAGES;
    }

    /** What the sheet shows before the press, on the saved cut. */
    preflight(spaceId, preset = DEFAULT_PRESET, snapshot = snapshotOf(this.deps.cuts.current(spaceId))) {
        const { boardCut, media, tools, exists, statfs } = this.deps;
        return preflight({ spaceId, snapshot, preset, boardCut, media, tools, exists, statfs });
    }

    /**
     * The Export press. Idempotent: an export already queued or running on this space is returned as it is,
     * and so is a done export of this same revision and preset whose file is still there. `revision` (the one
     * the dock just saved) must still be the cut's: an export never runs an older or newer cut than the person
     * saw. The preflight runs here too, so a cut over the limits is refused with no row and no process.
     * @returns {Promise<{ export: object, created: boolean } | { error: string, code: string, status: number, beat?: string }>}
     */
    async start(spaceId, { preset = DEFAULT_PRESET, revision = null, posterMs = null } = {}) {
        const reason = checkPreset(preset);
        if (reason) return { error: reason, code: 'limits', status: 422 };
        const { cuts, exportsRepo, media, exists } = this.deps;
        const cut = cuts.current(spaceId);
        if (revision != null && revision !== cut.revision) {
            return { error: 'The cut changed since it was saved here. Export again to use the latest version.', code: 'revision', status: 409 };
        }
        const running = exportsRepo.active(spaceId, 'export');
        if (running) return { export: this.view(running), created: false };
        const done = exportsRepo.doneFor(spaceId, cut.revision, preset);
        const there = (p) => Boolean(p && (exists ?? existsSync)(media.resolve(p) ?? ''));
        const samePoster = posterMs == null || posterMs === (done?.snapshot?.settings?.poster_ms ?? null);
        if (done && there(done.media_path) && samePoster) return { export: this.view(done), created: false };
        const snapshot = snapshotOf(cut);
        if (Number.isInteger(posterMs) && posterMs >= 0) snapshot.settings = { ...snapshot.settings, poster_ms: posterMs };
        const check = await this.preflight(spaceId, preset, snapshot);
        if (!check.ok) return { error: check.reason, code: check.code, beat: check.beat ?? null, status: 422 };
        const row = exportsRepo.create(spaceId, { kind: 'export', revision: cut.revision, preset, snapshot });
        this.#enqueue(row);
        return { export: this.view(row), created: true };
    }

    status(spaceId, id) {
        const row = this.deps.exportsRepo.findInSpace(spaceId, id);
        return row && row.kind === 'export' ? this.view(row) : null;
    }
    view(row) {
        const view = jobView(row, this.deps.cuts.revision(row.space_id));
        if (view?.media_path) view.full_path = this.deps.media.resolve(view.media_path); // Copy path
        if (view && row.status === 'queued') view.waiting = this.deps.queue.position(`export:${row.id}`) > 1;
        return view;
    }

    /** Cancel: marks the row, then drops it from the queue or aborts its running child. */
    cancel(spaceId, id) {
        const { exportsRepo, queue } = this.deps;
        const row = exportsRepo.findInSpace(spaceId, id);
        if (!row || row.kind !== 'export') return null;
        if (!exportsRepo.requestCancel(id)) return this.view(row); // already ended
        if (queue.cancel(`export:${id}`) !== 'aborted') this.#end(row, endFor(Object.assign(new Error('x'), { name: 'AbortError' }), 'export'));
        return this.view(exportsRepo.find(id));
    }

    #enqueue(row) {
        this.deps.queue.add({ key: `export:${row.id}`, kind: 'export', run: (signal) => this.#run(row, signal) })
            .catch((error) => {
                if (error?.name !== 'AbortError') this.deps.log.error?.(error);
            });
    }

    async #run(row, signal) {
        const { exportsRepo, media, events, log } = this.deps;
        const local = new AbortController();
        const relay = () => local.abort();
        signal.addEventListener('abort', relay, { once: true });
        const progress = new JobProgress({ row, exportsRepo, events });
        const tracker = new StepTracker();
        const ctx = {
            deps: this.deps, spaceId: row.space_id, exportId: row.id, preset: row.preset, snapshot: row.snapshot,
            signal: local.signal, progress, tracker, report: {}, tmp: null, gone: false,
        };
        ctx.alive = () => {
            if (!exportsRepo.find(row.id)) {
                ctx.gone = true;
                local.abort();
            }
            if (local.signal.aborted) throw Object.assign(new Error('Canceled.'), { name: 'AbortError' });
        };
        ctx.step = async (args, { label, weight = 0, timeoutMs, capBytes, analysis = false }) => {
            ctx.alive();
            tracker.current = weight;
            progress.report(tracker.at(0), label);
            // A step can sit quiet (no progress lines); a deleted space still stops it within a second.
            const watch = setInterval(() => {
                if (!exportsRepo.find(row.id)) {
                    ctx.gone = true;
                    local.abort();
                }
            }, WATCH_MS);
            let result;
            try {
                result = await this.deps.ffmpeg.run(args, {
                    timeoutMs, capBytes, analysis, signal: local.signal, outputDir: ctx.tmp,
                    onProgress: (ratio) => {
                        if (!progress.report(tracker.at(ratio), label)) {
                            ctx.gone = true;
                            local.abort();
                        }
                    },
                });
            } finally {
                clearInterval(watch);
            }
            tracker.done += weight;
            tracker.current = 0;
            return result;
        };
        try {
            if (!exportsRepo.update(row.id, { status: 'running', started_at: new Date().toISOString() })) return null;
            progress.report(0);
            ctx.tmp = await makeJobDir(media, 'export', row.id);
            await runPipeline(this.stages, ctx);
            progress.close();
            if (ctx.result) {
                const done = exportsRepo.find(row.id);
                events.cutExport?.({ spaceId: row.space_id, exportId: row.id, kind: 'export', status: 'done', progress: 1, step: 'Done',
                    media_path: done.media_path, bytes: done.bytes, nodeId: done.node_id, node: ctx.result.node, report: done.report });
            }
            return ctx.result ?? null;
        } catch (error) {
            progress.close();
            const end = endFor(error, 'export', { gone: ctx.gone || !exportsRepo.find(row.id) });
            if (end.error_code === 'failed') log.error?.(`Cut export ${row.id} failed:`, error);
            this.#end(row, end, ctx.report);
            return null;
        } finally {
            signal.removeEventListener('abort', relay);
            await removeDir(ctx.tmp);
        }
    }

    #end(row, end, report = undefined) {
        const { exportsRepo, events } = this.deps;
        const ended = exportsRepo.finish(row.id, { ...end, ...(report ? { report } : {}) });
        if (!ended && end.error_code !== 'gone') return;
        events.cutExport?.({ spaceId: row.space_id, exportId: row.id, kind: row.kind, status: end.status, progress: 0, step: null,
            error: end.error, error_code: end.error_code, error_beat: end.error_beat ?? null });
    }
}

/** The cut as pressed: what a running export reads, whatever the dock saves next. */
export const snapshotOf = (cut) => ({ revision: cut.revision, items: cut.items, sound: cut.sound, settings: cut.settings });

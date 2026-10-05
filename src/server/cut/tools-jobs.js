// What the Export and Pack jobs share: the job temp folder (<media>/.cut-tmp/<kind>-<id>/, same volume as the
// result so the final move is a rename), the start-up recovery (rows left running fail, the temp root is swept),
// a plain-words stop, the throttled progress reporter (4 frames a second on SSE, the row kept in step) and the
// status view the routes return.
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const TMP_DIR = '.cut-tmp';
const FRAME_MS = 250; // cut_export progress: at most 4 frames a second

export const CLOSED_MESSAGE = {
    export: 'The app closed during the export. Nothing was saved.',
    pack: 'The app closed while packing. Nothing was saved.',
};
export const TIMED_OUT = 'The export took too long and was stopped. Nothing was saved.';
export const CANCELLED = { export: 'Export cancelled. Nothing was saved.', pack: 'Pack cancelled. Nothing was saved.' };
export const STALE = 'This export is from an older version of the cut.';

/** A plain-words end: `code` drives the sheet's keys (limits → Close; clip → Remove it and export again). */
export class JobStop extends Error {
    constructor(code, message, { beat = null } = {}) {
        super(message);
        this.code = code;
        this.beat = beat;
    }
}

export const tmpRoot = (media) => {
    const root = media.resolve(TMP_DIR);
    if (!root) throw new Error('The media folder is not set.');
    return root;
};

export async function makeJobDir(media, kind, id) {
    const dir = join(tmpRoot(media), `${kind}-${id}`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    return dir;
}

export const removeDir = (dir) => (dir ? rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {}) : Promise.resolve());

/**
 * On app start (tries 1): every export or pack left queued or running fails with a plain message, and the
 * whole temp root is swept. Nothing else runs yet, so nothing is in use.
 */
export async function recoverToolsJobs({ exportsRepo, media, log = console }) {
    const ended = exportsRepo.failInterrupted((row) => CLOSED_MESSAGE[row.kind] ?? CLOSED_MESSAGE.export);
    try {
        await rm(tmpRoot(media), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
        log.warn?.(`Cut temp sweep: ${error.message}`);
    }
    return ended;
}

/**
 * Sends `cut_export` frames and keeps the row in step, throttled to one frame per 250 ms whatever changed (a
 * new step inside the window goes out at the window's end, with the latest numbers). `report()` returns false
 * once the row is gone (the space was deleted): the job then aborts its child and sweeps. `close()` before the
 * job's end frame, so no late "running" frame follows it.
 */
export class JobProgress {
    constructor({ row, exportsRepo, events, clock = Date.now }) {
        Object.assign(this, { row, exportsRepo, events, clock });
        this.last = -Infinity;
        this.step = null;
        this.progress = 0;
        this.gone = false;
        this.closed = false;
        this.timer = null;
    }

    report(progress, step = this.step) {
        if (this.gone) return false;
        this.progress = Math.min(1, Math.max(this.progress, Number(progress) || 0)); // never runs backwards
        this.step = step;
        const wait = FRAME_MS - (this.clock() - this.last);
        if (wait > 0) {
            this.#later(wait);
            return true;
        }
        return this.#flush();
    }

    close() {
        this.closed = true;
        clearTimeout(this.timer);
        this.timer = null;
    }

    #later(wait) {
        if (this.timer || this.closed) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.#flush();
        }, wait);
        this.timer.unref?.();
    }

    #flush() {
        if (this.closed) return !this.gone;
        clearTimeout(this.timer);
        this.timer = null;
        this.last = this.clock();
        if (!this.exportsRepo.update(this.row.id, { progress: Math.round(this.progress * 1000) / 1000, step: this.step })) {
            this.gone = true;
            return false;
        }
        this.emit({ status: 'running' });
        return true;
    }

    emit(extra) {
        this.events.cutExport?.({
            spaceId: this.row.space_id, exportId: this.row.id, kind: this.row.kind,
            progress: Math.round(this.progress * 1000) / 1000, step: this.step, ...extra,
        });
    }
}

/** The row as the routes and the sheet see it; `stale` when the cut moved on since a done export. */
export function jobView(row, currentRevision = null) {
    if (!row) return null;
    const stale = row.kind === 'export' && row.status === 'done' && currentRevision != null && row.cut_revision < currentRevision;
    return {
        id: row.id, space_id: row.space_id, kind: row.kind, preset: row.preset ?? null, cut_revision: row.cut_revision,
        status: row.status, progress: row.progress, step: row.step, error: row.error, error_code: row.error_code ?? null,
        error_beat: row.error_beat, media_path: row.media_path, bytes: row.bytes, node_id: row.node_id,
        cancel_requested: Boolean(row.cancel_requested_at), created_at: row.created_at, finished_at: row.finished_at,
        report: row.report ?? {}, stale, stale_text: stale ? STALE : null,
        variant: row.variant ?? null, group_id: row.group_id ?? null, // P6: the row's shape, and the press it belongs to
    };
}

/** How a thrown error ends a job: {status, error, error_code, error_beat}. */
export function endFor(error, kind, { gone = false } = {}) {
    if (gone) return { status: 'cancelled', error: 'The space was deleted.', error_code: 'gone' };
    if (error?.name === 'AbortError') return { status: 'cancelled', error: CANCELLED[kind], error_code: 'cancelled' };
    if (error instanceof JobStop) return { status: 'failed', error: error.message, error_code: error.code, error_beat: error.beat };
    if (error?.code === 'ETIMEDOUT') return { status: 'failed', error: kind === 'pack' ? 'Packing took too long and was stopped. Nothing was saved.' : TIMED_OUT, error_code: 'timeout' };
    if (error?.code === 'ENOENT' && error?.syscall?.startsWith?.('spawn')) {
        return { status: 'failed', error: 'The video tools are missing. Reinstall Bloop Studio, or choose ffmpeg.exe in Settings › Video tools.', error_code: 'tools' };
    }
    if (error?.code === 'ENOSPC') return { status: 'failed', error: 'The disk is full. Nothing was saved.', error_code: 'disk' };
    return { status: 'failed', error: kind === 'pack' ? 'Packing stopped. Nothing was saved.' : 'The export stopped. Nothing was saved.', error_code: 'failed' };
}

// Export and Pack jobs of the Cut (cut_exports, 006 + 007). One row per press; the media-tools queue runs them
// one at a time. Every write after the row exists reports whether the row is still there: a space deleted
// mid-job cascades the row away, and the job stops on the next write.
import { now } from '../db/database.js';

const json = (text, fallback) => {
    try {
        return text == null ? fallback : JSON.parse(text);
    } catch {
        return fallback;
    }
};

const hydrate = (row) => row && {
    ...row,
    snapshot: json(row.snapshot, null),
    options: json(row.options, {}),
    report: json(row.report, {}),
};

const ACTIVE = "status IN ('queued', 'running')";
const FIELDS = new Set(['status', 'progress', 'step', 'error', 'error_code', 'error_beat', 'media_path', 'bytes', 'node_id', 'report', 'started_at', 'finished_at']);

export class CutExportsRepository {
    constructor(db) {
        this.db = db;
    }

    find(id) {
        return hydrate(this.db.prepare('SELECT * FROM cut_exports WHERE id = ?').get(id)) ?? null;
    }

    /** The row only when it belongs to the space (routes never reach another space's job). */
    findInSpace(spaceId, id) {
        return hydrate(this.db.prepare('SELECT * FROM cut_exports WHERE id = ? AND space_id = ?').get(id, spaceId)) ?? null;
    }

    /** The queued or running job of this kind on the space, if any (one at a time per space). */
    active(spaceId, kind) {
        return hydrate(this.db.prepare(`SELECT * FROM cut_exports WHERE space_id = ? AND kind = ? AND ${ACTIVE} ORDER BY id DESC LIMIT 1`).get(spaceId, kind)) ?? null;
    }

    /** The newest done export of this revision and preset (idempotent Export press). */
    doneFor(spaceId, revision, preset) {
        return hydrate(this.db.prepare(`
            SELECT * FROM cut_exports WHERE space_id = ? AND kind = 'export' AND status = 'done' AND cut_revision = ? AND preset IS ?
            ORDER BY id DESC LIMIT 1
        `).get(spaceId, revision, preset ?? null)) ?? null;
    }

    /** The newest done export of the space (Pack puts it in cut/). */
    latestDone(spaceId) {
        return hydrate(this.db.prepare("SELECT * FROM cut_exports WHERE space_id = ? AND kind = 'export' AND status = 'done' ORDER BY id DESC LIMIT 1").get(spaceId)) ?? null;
    }

    list(spaceId, { limit = 20 } = {}) {
        return this.db.prepare('SELECT * FROM cut_exports WHERE space_id = ? ORDER BY id DESC LIMIT ?').all(spaceId, limit).map(hydrate);
    }

    create(spaceId, { kind, revision = null, preset = null, snapshot = null, options = {} }) {
        const { lastInsertRowid } = this.db.prepare(`
            INSERT INTO cut_exports (space_id, kind, cut_revision, preset, snapshot, options) VALUES (?, ?, ?, ?, ?, ?)
        `).run(spaceId, kind, revision, preset, snapshot == null ? null : JSON.stringify(snapshot), JSON.stringify(options ?? {}));
        return this.find(Number(lastInsertRowid));
    }

    /** @returns {boolean} false when the row is gone (its space was deleted) */
    update(id, changes) {
        const keys = Object.keys(changes).filter((k) => FIELDS.has(k));
        if (!keys.length) return Boolean(this.find(id));
        const values = keys.map((k) => (k === 'report' ? JSON.stringify(changes[k] ?? {}) : changes[k]));
        return this.db.prepare(`UPDATE cut_exports SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...values, id).changes > 0;
    }

    /** Marks a running job for cancel; the queue aborts its child. @returns {boolean} */
    requestCancel(id) {
        return this.db.prepare(`UPDATE cut_exports SET cancel_requested_at = ? WHERE id = ? AND ${ACTIVE}`).run(now(), id).changes > 0;
    }

    /** End state, once: a job that already ended keeps its end. @returns {boolean} */
    finish(id, { status, error = null, error_code = null, error_beat = null, ...rest }) {
        const extra = Object.keys(rest).filter((k) => FIELDS.has(k));
        const values = extra.map((k) => (k === 'report' ? JSON.stringify(rest[k] ?? {}) : rest[k]));
        const sets = ['status = ?', 'error = ?', 'error_code = ?', 'error_beat = ?', 'finished_at = ?', ...extra.map((k) => `${k} = ?`)];
        return this.db.prepare(`UPDATE cut_exports SET ${sets.join(', ')} WHERE id = ? AND ${ACTIVE}`)
            .run(status, error, error_code, error_beat, now(), ...values, id).changes > 0;
    }

    /** On app start: every job left queued or running ended with the app (tries 1). @returns {object[]} the rows ended */
    failInterrupted(messageFor) {
        const rows = this.db.prepare(`SELECT * FROM cut_exports WHERE ${ACTIVE}`).all().map(hydrate);
        for (const row of rows) this.finish(row.id, { status: 'failed', error: messageFor(row), error_code: 'closed' });
        return rows;
    }
}

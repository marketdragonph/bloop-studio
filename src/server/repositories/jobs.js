// The local GPU queue. A single worker claims one job at a time, oldest first.
import { now, transaction } from '../db/database.js';

const hydrate = (row) => row && { ...row, inputs: JSON.parse(row.inputs) };

export class JobsRepository {
    constructor(db) {
        this.db = db;
    }

    enqueue({ nodeId, preset, inputs = {} }) {
        const { lastInsertRowid } = this.db
            .prepare('INSERT INTO jobs (node_id, preset, inputs) VALUES (?, ?, ?)')
            .run(nodeId, preset, JSON.stringify(inputs));
        return this.find(Number(lastInsertRowid));
    }

    find(id) {
        return hydrate(this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
    }

    activeForNode(nodeId) {
        return hydrate(this.db.prepare("SELECT * FROM jobs WHERE node_id = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1").get(nodeId));
    }

    claimNext() {
        return transaction(this.db, () => {
            const job = this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get();
            if (!job) return null;
            this.db.prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?").run(now(), job.id);
            return hydrate({ ...job, status: 'running' });
        });
    }

    setPromptId(id, promptId) {
        this.db.prepare('UPDATE jobs SET comfy_prompt_id = ? WHERE id = ?').run(promptId, id);
    }

    progress(id, progress, label) {
        this.db.prepare('UPDATE jobs SET progress = ?, progress_label = ? WHERE id = ?').run(progress, label, id);
    }

    finish(id, status, error = null) {
        this.db.prepare('UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(status, error, now(), id);
    }

    queuePosition(id) {
        return this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running') AND id < ?").get(id).n;
    }

    /** After a crash or restart, work that was mid-flight is queued again rather than lost. */
    requeueInterrupted() {
        return this.db.prepare("UPDATE jobs SET status = 'queued', comfy_prompt_id = NULL, progress = 0 WHERE status = 'running'").run().changes;
    }

    addTake({ nodeId, mediaPath, mime, preset, seed, params }) {
        this.db.prepare('INSERT INTO takes (node_id, media_path, media_mime, preset, seed, params) VALUES (?, ?, ?, ?, ?, ?)')
            .run(nodeId, mediaPath, mime, preset, seed, JSON.stringify(params));
    }

    takes(nodeId) {
        return this.db.prepare('SELECT * FROM takes WHERE node_id = ? ORDER BY id DESC').all(nodeId);
    }
}

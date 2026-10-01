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

    /**
     * The next job that can run now: oldest first, but never one whose wired-in cards are still
     * queued or rendering (a video must wait for its first-frame still, or it would render without
     * it). Among ready jobs, `preferFamily` wins so the loaded model is reused before swapping.
     */
    claimNext({ preferFamily = null, familyOf = () => null } = {}) {
        return transaction(this.db, () => {
            // A job whose card was deleted can never run: close it instead of leaving it queued forever.
            this.db.prepare("UPDATE jobs SET status = 'canceled', error = 'The card was deleted.', finished_at = ? WHERE status = 'queued' AND node_id IS NULL").run(now());
            const ready = this.db.prepare(`
                SELECT j.*, n.settings AS node_settings, n.type AS node_type FROM jobs j
                JOIN space_nodes n ON n.id = j.node_id
                WHERE j.status = 'queued' AND NOT EXISTS (
                    SELECT 1 FROM space_connections c JOIN space_nodes up ON up.id = c.from_node_id
                    WHERE c.to_node_id = j.node_id AND up.status IN ('queued', 'generating')
                )
                ORDER BY j.id
            `).all();
            if (!ready.length) return null;
            const job = ready.find((j) => preferFamily && familyOf(j) === preferFamily) ?? ready[0];
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

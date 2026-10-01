// Director conversation storage: the provider-native history (append-only) and the panel log.
import { now } from '../db/database.js';

export class DirectorRepository {
    constructor(db) {
        this.db = db;
    }

    /** The thread for a space, reset if the provider or model changed (histories are not portable). */
    thread(spaceId, provider, model) {
        const row = this.db.prepare('SELECT * FROM director_threads WHERE space_id = ?').get(spaceId);
        if (row && row.provider === provider && row.model === model) return JSON.parse(row.messages);
        return [];
    }

    saveThread(spaceId, provider, model, messages) {
        this.db.prepare(`
            INSERT INTO director_threads (space_id, provider, model, messages, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(space_id) DO UPDATE SET provider = excluded.provider, model = excluded.model,
                messages = excluded.messages, updated_at = excluded.updated_at
        `).run(spaceId, provider, model, JSON.stringify(messages), now());
    }

    log(spaceId) {
        return this.db.prepare('SELECT * FROM director_log WHERE space_id = ? ORDER BY id').all(spaceId)
            .map((row) => ({ ...row, actions: JSON.parse(row.actions) }));
    }

    addLog(spaceId, role, text, actions = []) {
        const { lastInsertRowid } = this.db
            .prepare('INSERT INTO director_log (space_id, role, text, actions) VALUES (?, ?, ?, ?)')
            .run(spaceId, role, text, JSON.stringify(actions));
        return Number(lastInsertRowid);
    }

    clear(spaceId) {
        this.db.prepare('DELETE FROM director_log WHERE space_id = ?').run(spaceId);
        this.db.prepare('DELETE FROM director_threads WHERE space_id = ?').run(spaceId);
    }
}

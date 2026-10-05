// One row per Director turn that changed the cut (009_cut_director.sql). Written before the turn's first cut write,
// so Undo turn always has the cut as it was; updated after every write of the same turn.
const json = (text, fallback) => {
    try {
        return text == null ? fallback : JSON.parse(text);
    } catch {
        return fallback;
    }
};

const LISTS = ['changed', 'rows', 'ops_summary', 'reasons'];
const hydrate = (row) => row && {
    ...row,
    before: json(row.before, { items: [], sound: null, settings: {} }),
    ...Object.fromEntries(LISTS.map((k) => [k, json(row[k], [])])),
};

export class CutTurnsRepository {
    constructor(db) {
        this.db = db;
    }

    find(id) {
        return hydrate(this.db.prepare('SELECT * FROM cut_turns WHERE id = ?').get(id)) ?? null;
    }

    findInSpace(spaceId, id) {
        const row = this.find(id);
        return row && row.space_id === spaceId ? row : null;
    }

    /** The newest turn on a space that changed the cut (undone or not). */
    latest(spaceId) {
        return hydrate(this.db.prepare('SELECT * FROM cut_turns WHERE space_id = ? AND after_rev IS NOT NULL ORDER BY id DESC LIMIT 1').get(spaceId)) ?? null;
    }

    /** Every reason stored for a beat, newest first (the why ledger). */
    reasonsFor(spaceId, beatTag, limit = 3) {
        const rows = this.db.prepare('SELECT id, reasons, undone_at FROM cut_turns WHERE space_id = ? AND after_rev IS NOT NULL ORDER BY id DESC LIMIT 20').all(spaceId);
        const out = [];
        for (const row of rows) {
            if (row.undone_at) continue;
            for (const r of json(row.reasons, []).reverse()) if (r.beat_tag === beatTag && out.length < limit) out.push({ ...r, turn: row.id });
        }
        return out;
    }

    create(spaceId, { before, beforeRevision, beforeTotalMs }) {
        const { lastInsertRowid } = this.db.prepare('INSERT INTO cut_turns (space_id, before, before_revision, before_total_ms) VALUES (?, ?, ?, ?)')
            .run(spaceId, JSON.stringify(before), beforeRevision, beforeTotalMs);
        return this.find(Number(lastInsertRowid));
    }

    update(id, changes) {
        const fields = Object.keys(changes);
        if (!fields.length) return this.find(id);
        const values = fields.map((f) => (LISTS.includes(f) ? JSON.stringify(changes[f]) : changes[f]));
        this.db.prepare(`UPDATE cut_turns SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...values, id);
        return this.find(id);
    }

    /** A turn that wrote nothing in the end (a refused or empty draft) leaves no row. */
    discard(id) {
        this.db.prepare('DELETE FROM cut_turns WHERE id = ? AND after_rev IS NULL').run(id);
    }
}

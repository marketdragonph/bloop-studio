// One cut per Space (bloop's SpaceCut, ported). The save is one statement guarded by `revision`:
// 0 rows changed means someone else saved first, and the caller gets the server copy for its 409.
// Canvas saves never touch this table. Also holds the measured take lengths (takes.duration_ms).
import { now } from '../db/database.js';

const json = (text, fallback) => {
    try {
        return text == null ? fallback : JSON.parse(text);
    } catch {
        return fallback;
    }
};

export const DEFAULT_CUT_SETTINGS = Object.freeze({ resolution: 1080, fps: 30 });

const hydrate = (row) => row && {
    ...row,
    items: json(row.items, []),
    sound: json(row.sound, null),
    settings: json(row.settings, { ...DEFAULT_CUT_SETTINGS }),
    previous_items: json(row.previous_items, null),
    auto: Boolean(row.auto),
};

/** The cut a Space has before anything was saved: nothing stored yet, revision 0. */
export const emptyCut = (spaceId) => ({
    id: null, space_id: spaceId, items: [], sound: null, settings: { ...DEFAULT_CUT_SETTINGS },
    previous_items: null, revision: 0, auto: true, updated_by: 'person', created_at: null, updated_at: null,
});

/** A stale save: `cut` is the server copy the client adopts (bloop: "adopt the server revision on 409"). */
export class CutConflictError extends Error {
    constructor(cut) {
        super('This cut changed in another window.');
        this.cut = cut;
    }
}

export class CutsRepository {
    constructor(db) {
        this.db = db;
    }

    find(spaceId) {
        return hydrate(this.db.prepare('SELECT * FROM space_cuts WHERE space_id = ?').get(spaceId)) ?? null;
    }

    /** The stored cut, or an unsaved empty one. Never writes. */
    current(spaceId) {
        return this.find(spaceId) ?? emptyCut(spaceId);
    }

    revision(spaceId) {
        return this.db.prepare('SELECT revision FROM space_cuts WHERE space_id = ?').get(spaceId)?.revision ?? 0;
    }

    /** Makes the row if it is not there yet (revision 0); returns the cut. */
    ensure(spaceId) {
        this.db.prepare('INSERT INTO space_cuts (space_id) VALUES (?) ON CONFLICT(space_id) DO NOTHING').run(spaceId);
        return this.find(spaceId);
    }

    /**
     * Saves items/sound/settings when `revision` is still the stored one, bumping it by one.
     * `keepPrevious` stores the items being replaced as the one-step Undo draft.
     * @throws {CutConflictError} with the server copy when the revision is stale
     */
    save(spaceId, { items, sound, settings, revision, by = 'person', keepPrevious = false, auto }) {
        const before = this.ensure(spaceId);
        const next = {
            items: JSON.stringify(items ?? before.items),
            sound: sound === undefined ? (before.sound == null ? null : JSON.stringify(before.sound)) : (sound == null ? null : JSON.stringify(sound)),
            settings: JSON.stringify(settings ?? before.settings),
        };
        const previous = keepPrevious ? JSON.stringify(before.items) : (before.previous_items == null ? null : JSON.stringify(before.previous_items));
        const keepAuto = auto === undefined ? (before.auto ? 1 : 0) : (auto ? 1 : 0);
        const { changes } = this.db.prepare(`
            UPDATE space_cuts SET items = ?, sound = ?, settings = ?, previous_items = ?, auto = ?, updated_by = ?,
                revision = revision + 1, updated_at = ?
            WHERE space_id = ? AND revision = ?
        `).run(next.items, next.sound, next.settings, previous, keepAuto, by, now(), spaceId, Number(revision));
        if (!changes) throw new CutConflictError(this.find(spaceId));
        return this.find(spaceId);
    }

    /** Live cut on or off (P2b): off once the person edits by hand. Does not bump the revision. */
    setAuto(spaceId, auto) {
        this.ensure(spaceId);
        this.db.prepare('UPDATE space_cuts SET auto = ? WHERE space_id = ?').run(auto ? 1 : 0, spaceId);
        return this.find(spaceId);
    }

    // ── Measured take lengths (MeasureTake writes them; BoardCut reads them) ──

    /** The take a render just saved, found by its card and file. */
    takeFor(nodeId, mediaPath) {
        return this.db.prepare('SELECT * FROM takes WHERE node_id = ? AND media_path = ? ORDER BY id DESC LIMIT 1').get(nodeId, mediaPath) ?? null;
    }

    /** Writes only `duration_ms` (bloop G4: never the whole settings blob). */
    setTakeDuration(takeId, durationMs) {
        const ms = Math.round(Number(durationMs));
        if (!Number.isFinite(ms) || ms <= 0) return false;
        return this.db.prepare('UPDATE takes SET duration_ms = ? WHERE id = ?').run(ms, takeId).changes > 0;
    }
}

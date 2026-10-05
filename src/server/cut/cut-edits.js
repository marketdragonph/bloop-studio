// THE write path for the Cut (01-core.md §2, katana.md §6 "one write path"). The dock's PUT, CutDraft and the
// Director's propose_cut_ops (P4) all save through here: validate (validate-cut.js + src/shared/cut-rules.js),
// stamp who placed each item, save with the revision check, then send one `cut` event on the board's stream.
//
// Stamps (the edit lock, 03-director.md §4): a clip the person adds or changes gets `person_rev` = the revision this
// save makes, and loses the Director's note. A clip a draft puts in is `placed_by: 'director'` with no person_rev.
// Untouched clips keep their stamps, whatever the order. The live cut (P2b, live-cut.js) saves by 'auto': its clips
// are `placed_by: 'auto'`, and the dock adopts them silently (never a "changed in another window" banner).
import { CutConflictError } from '../repositories/cuts.js';
import { CutValidator } from './validate-cut.js';

/** What makes a clip "changed" for the lock. Position in the list is not: a reorder moves, it does not edit. */
const EDIT_FIELDS = ['node_id', 'take_id', 'in_ms', 'out_ms', 'sound', 'join'];
const edited = (before, after) => EDIT_FIELDS.some((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
const unique = (values) => [...new Set(values)];

export class CutEdits {
    /** @param {{ db: import('node:sqlite').DatabaseSync, cuts: import('../repositories/cuts.js').CutsRepository, events?: import('../generation/events.js').BoardEvents }} deps */
    constructor({ db, cuts, events = null, validator = new CutValidator({ db }) }) {
        this.cuts = cuts;
        this.events = events;
        this.validator = validator;
    }

    /**
     * @param {number} spaceId
     * @param {{ items: object[], sound?: object|null, settings?: object, revision: number,
     *   by?: 'person'|'director'|'auto', draft?: boolean, previous?: 'keep'|'set'|'clear', turn?: number|null,
     *   missing?: string[], offer?: string|null, restore?: object[]|null }} save
     *   `draft`: new items are a draft's (placed by the Director). `previous`: what happens to the Undo draft
     *   (default: a person's save clears it, other saves keep it). `restore`: earlier items whose stamps come back.
     * @returns {object} the saved cut
     * @throws {CutConflictError} stale revision (the server copy rides on it) · {CutInvalidError} a rule refused it
     */
    save(spaceId, { items, sound, settings, revision, by = 'person', draft = false, previous, turn = null, missing = [], offer = null, restore = null }) {
        const stored = this.cuts.current(spaceId);
        if (Number(revision) !== stored.revision) throw new CutConflictError(stored);
        const clean = this.validator.validate(spaceId, { items, sound, settings }, stored);
        const nextRevision = stored.revision + 1;
        const before = new Map(stored.items.map((item) => [item.id, item]));
        // Undo draft brings back items from an earlier revision: they keep the stamps they had then.
        const stampedBefore = new Map([...(restore ?? []), ...stored.items].map((item) => [item.id, item]));
        const changes = { added: [], changed: [] };
        const stamped = clean.items.map((item) => {
            const old = before.get(item.id);
            if (!old) changes.added.push(item.node_id);
            else if (edited(old, item)) changes.changed.push(item.node_id);
            return this.#stamp(item, stampedBefore.get(item.id), { by, draft, nextRevision });
        });
        const kept = new Set(stamped.map((item) => item.id));
        for (const old of stored.items) if (!kept.has(old.id)) changes.changed.push(old.node_id);

        const mode = previous ?? (by === 'person' && !draft ? 'clear' : 'keep');
        const saved = this.cuts.save(spaceId, {
            items: stamped, sound: clean.sound, settings: clean.settings, revision: stored.revision, by,
            keepPrevious: mode === 'set', clearPrevious: mode === 'clear',
            // A hand edit turns the live cut off (P2b); a draft leaves it as it was.
            auto: by === 'person' && !draft ? false : undefined,
        });
        this.notify(spaceId, {
            revision: saved.revision, by, added: unique(changes.added), changed: unique(changes.changed), missing, turn, offer,
        });
        return saved;
    }

    /** One `cut` event on the board's stream (01-core.md §3). */
    notify(spaceId, { revision, by, added = [], changed = [], missing = [], turn = null, offer = null }) {
        this.events?.cut({ spaceId, revision, by, added, missing, changed, turn, offer });
    }

    #stamp(item, old, { by, draft, nextRevision }) {
        const { note, ...rest } = item;
        if (!old && draft) return { ...rest, placed_by: by === 'auto' ? 'auto' : 'director', person_rev: null, ...(note ? { note } : {}) };
        if (!old) {
            return by === 'person'
                ? { ...rest, placed_by: 'person', person_rev: nextRevision }
                : { ...rest, placed_by: 'director', person_rev: null, ...(note ? { note } : {}) };
        }
        const placed = { placed_by: old.placed_by ?? 'person', person_rev: old.person_rev ?? null };
        if (!edited(old, item)) return { ...rest, ...placed, ...(old.note ? { note: old.note } : {}) };
        // The person's edit makes the clip theirs this revision and clears the Director's note.
        if (by === 'person') return { ...rest, ...placed, person_rev: nextRevision };
        return { ...rest, ...placed, ...(note ? { note } : {}) };
    }
}

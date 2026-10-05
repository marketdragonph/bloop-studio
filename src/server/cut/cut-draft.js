// CutDraft: THE only code that builds a draft of the cut (03-director.md §2, a port of bloop's CutDraft).
// The dock's Fill the cut (POST /spaces/:id/cut/draft) and the Director's stitch_cut (P4) both call it.
// Order and clips come from BoardCut (the one reader); the save goes through CutEdits (the one write path).
// It never renders and never exports: a beat with no video is named in `missing`, never queued.
//
//   fill     build the cut in beat order, ONLY into an empty cut. A cut with clips: nothing is written, and the
//            `cut` event offers a replace (offer: 'replace'); the choice is the person's.
//   add_new  add ready beats whose card is not in the cut yet. Never moves, trims or removes an item: the
//            items already there stay in their order with every field as it was.
//   replace  the person's press after the offer: a fresh draft in beat order. The old items become the
//            one-step Undo draft (previous_items).
// Zero playable clips: no write, no event. Caps: at most 50 items and 600 s; a draft stops at the cap.
import { randomUUID } from 'node:crypto';
import { CutConflictError } from '../repositories/cuts.js';
import { ASPECTS, CUT_LIMITS, FADE_OUT, MUSIC_LEVEL } from '../../shared/cut-rules.js';
import { cutClock } from '../../shared/cut-clock.js';
import { CutInvalidError } from './validate-cut.js';

export const DRAFT_MODES = Object.freeze(['fill', 'add_new', 'replace']);
export const DRAFT_NOTE = 'Placed in beat order';
const UNMEASURED_MS = 5000;

const lengthMs = (slot) => Math.round(((slot.seconds ?? slot.planned_seconds) || UNMEASURED_MS / 1000) * 1000);

/** A cut item for a ready slot: the whole clip, its own sound on, a cut join, pinned to the take it shows. */
export const itemFor = (slot) => ({
    id: randomUUID(),
    node_id: slot.node_id,
    take_id: slot.take_id,
    beat_tag: slot.beat_tag,
    media_path: slot.media_path,
    seconds_ms: lengthMs(slot),
    in_ms: 0,
    out_ms: lengthMs(slot),
    sound: true,
    join: { type: 'cut' },
    note: DRAFT_NOTE,
});

export class CutDraft {
    /** @param {{ boardCut: import('./board-cut.js').BoardCut, cuts: import('../repositories/cuts.js').CutsRepository, edits: import('./cut-edits.js').CutEdits }} deps */
    constructor({ boardCut, cuts, edits }) {
        this.boardCut = boardCut;
        this.cuts = cuts;
        this.edits = edits;
    }

    /**
     * @param {number} spaceId
     * @param {{ mode: 'fill'|'add_new'|'replace', by?: 'person'|'director', revision?: number|null, turn?: number|null }} request
     *   `revision` (the dock sends it): a stale one is a 409, as for a PUT. The Director omits it.
     * @returns {{ drafted: boolean, mode: string, reason: string|null, added: number, missing: string[], capped: boolean, offer: string|null, cut: object }}
     * @throws {CutConflictError|CutInvalidError}
     */
    draft(spaceId, { mode, by = 'person', revision = null, turn = null }) {
        if (!DRAFT_MODES.includes(mode)) throw new CutInvalidError('A draft fills the cut, adds new clips, or replaces it.');
        const cut = this.cuts.current(spaceId);
        if (revision != null && Number(revision) !== cut.revision) throw new CutConflictError(cut);
        const read = this.boardCut.read(spaceId, { cut });
        const missing = read.slots.filter((s) => s.state !== 'ready').map((s) => s.beat_tag);
        const ready = read.slots.filter((s) => s.state === 'ready' && s.node_id && s.media_path);
        const result = (fields) => ({ drafted: false, mode, reason: null, added: 0, missing, capped: false, offer: null, cut, ...fields });

        if (!ready.length) return result({ reason: 'no_clips' });
        if (mode === 'fill' && cut.items.length) {
            this.edits.notify(spaceId, { revision: cut.revision, by, missing, turn, offer: 'replace' });
            return result({ reason: 'not_empty', offer: 'replace' });
        }

        const kept = mode === 'add_new' ? cut.items : [];
        const inCut = new Set(kept.map((item) => item.node_id));
        const fresh = ready.filter((slot) => !inCut.has(slot.node_id));
        if (!fresh.length) return result({ reason: 'nothing_new' });

        const { items, added, capped } = mode === 'add_new' ? this.#addNew(kept, fresh, read.slots) : this.#fresh(fresh);
        const saved = this.edits.save(spaceId, {
            items,
            sound: mode === 'add_new' ? undefined : this.#sound(cut, read.beds),
            settings: this.#settings(cut, read.slots),
            revision: cut.revision,
            by,
            draft: true,
            previous: 'set',
            turn,
            missing,
        });
        return result({ drafted: true, added, capped, cut: saved });
    }

    /**
     * Undo draft: the items from before the last draft come back, once (01-core.md §2, one step).
     * @throws {CutConflictError|CutInvalidError}
     */
    undo(spaceId, { revision, by = 'person' }) {
        const cut = this.cuts.current(spaceId);
        if (Number(revision) !== cut.revision) throw new CutConflictError(cut);
        if (!Array.isArray(cut.previous_items)) throw new CutInvalidError('There is no draft to undo.');
        return this.edits.save(spaceId, { items: cut.previous_items, revision: cut.revision, by, draft: true, previous: 'clear', restore: cut.previous_items });
    }

    /** Beat order from the first ready slot, up to the caps. */
    #fresh(slots) {
        const items = [];
        for (const slot of slots) {
            const next = itemFor(slot);
            if (!fits([...items, next])) return { items, added: items.length, capped: true };
            items.push(next);
        }
        return { items, added: items.length, capped: false };
    }

    /**
     * Each new clip goes right after the last item from an earlier beat, so the beat order holds; the items already
     * in the cut keep their order and every field. With no plan (guessed order) new clips go at the end.
     */
    #addNew(kept, fresh, slots) {
        const beatOf = new Map(slots.filter((s) => s.node_id).map((s, i) => [s.node_id, i]));
        const items = [...kept];
        let added = 0;
        for (const slot of fresh) {
            const next = itemFor(slot);
            const rank = beatOf.get(slot.node_id);
            let at = items.length;
            for (let i = items.length - 1; i >= 0; i--) {
                const other = beatOf.get(items[i].node_id);
                if (other == null || other < rank) break;
                at = i;
            }
            const trial = [...items.slice(0, at), next, ...items.slice(at)];
            if (!fits(trial)) return { items, added, capped: true };
            items.splice(at, 0, next);
            added += 1;
        }
        return { items, added, capped: false };
    }

    /** The music bed goes in when the board has one and the cut has none; a voice bed is the person's choice. */
    #sound(cut, beds) {
        const music = beds.find((b) => b.kind === 'music');
        if (cut.sound?.music || !music) return cut.sound ?? null;
        return { ...(cut.sound ?? {}), music: { node_id: music.node_id, take_id: music.take_id, gain_db: MUSIC_LEVEL.default, fade_out_ms: FADE_OUT.default } };
    }

    /** The plan's shape, when the cut has none yet. */
    #settings(cut, slots) {
        const aspect = slots.find((s) => ASPECTS.includes(s.plan_aspect))?.plan_aspect;
        return cut.settings?.aspect || !aspect ? cut.settings : { ...cut.settings, aspect };
    }
}

const fits = (items) => items.length <= CUT_LIMITS.maxItems && cutClock(items).total_ms <= CUT_LIMITS.maxTotalMs;

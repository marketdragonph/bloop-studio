// One undo per Director turn (03-director.md §3, 05 §3.1–§3.3). Before a turn's first cut write, `begin` keeps the
// cut as it was in cut_turns; every write of that turn then `record`s its revision, its rows for the turn strip
// and its reasons (the why ledger). `undo` puts the cut back through CutEdits — the one write path — only while the
// cut is still at the turn's revision, with every item's stamps as they were. The dock's Undo turn
// (POST /spaces/:id/cut/undo-turn) and the Director's "undo that" (propose_cut_ops undo_turn) both call it.
import { CutConflictError } from '../repositories/cuts.js';
import { cutClock } from '../../shared/cut-clock.js';
import { CutInvalidError } from './validate-cut.js';

export const LATER_EDITS = 'Later edits came after that turn, so it cannot be undone as a whole.';
export const NO_TURN = 'There is no Director turn to undo.';

export class CutTurns {
    /** @param {{ cuts: object, repo: import('../repositories/cut-turns.js').CutTurnsRepository, edits: import('./cut-edits.js').CutEdits }} deps */
    constructor({ cuts, repo, edits }) {
        Object.assign(this, { cuts, repo, edits });
    }

    /** The row for this turn's cut writes; made once, with the cut as it is now. */
    begin(spaceId, ledger) {
        if (ledger.cutTurnId) return this.repo.find(ledger.cutTurnId);
        const cut = this.cuts.current(spaceId);
        const row = this.repo.create(spaceId, {
            before: { items: cut.items, sound: cut.sound, settings: cut.settings },
            beforeRevision: cut.revision,
            beforeTotalMs: cutClock(cut.items).total_ms,
        });
        ledger.cutTurnId = row.id;
        return row;
    }

    /** A begun turn that wrote nothing leaves no row. */
    abandon(ledger) {
        if (!ledger.cutTurnId) return;
        this.repo.discard(ledger.cutTurnId);
        if (!this.repo.find(ledger.cutTurnId)) ledger.cutTurnId = null;
    }

    /**
     * After a write of this turn: its revision and what it changed, added to the rows already there. `edits` is the
     * count of rows + summary rows this write added (applied-edits.js), so the strip's number is what Show edits lists.
     * `beforeTotalMs`: the length the dock showed before the turn when that was not the stored cut (a fill into an
     * empty cut, whose lane showed the same clips as the draft).
     */
    record(turnId, saved, { rows = [], summary = [], reasons = [], changed = [], edits = 0, beforeTotalMs = null }) {
        const row = this.repo.find(turnId);
        if (!row) return null;
        return this.repo.update(turnId, {
            after_rev: saved.revision,
            after_total_ms: cutClock(saved.items).total_ms,
            edits: row.edits + edits,
            rows: [...row.rows, ...rows],
            ops_summary: [...row.ops_summary, ...summary],
            reasons: [...row.reasons, ...reasons.map((r) => ({ ...r, revision: saved.revision }))],
            changed: [...new Set([...row.changed, ...changed])],
            ...(beforeTotalMs != null ? { before_total_ms: beforeTotalMs } : {}),
        });
    }

    /** The newest turn as the dock's strip shows it, or null. `undoable` while nothing was saved after it. */
    view(spaceId, revision = this.cuts.revision(spaceId)) {
        const row = this.repo.latest(spaceId);
        if (!row) return null;
        return {
            turn: row.id, after_rev: row.after_rev, before_total_ms: row.before_total_ms, after_total_ms: row.after_total_ms,
            edits: row.edits, rows: row.rows, sound_rows: row.ops_summary, changed: row.changed, reasons: row.reasons,
            undone: Boolean(row.undone_at), undoable: !row.undone_at && row.after_rev === revision,
        };
    }

    /**
     * Undo turn. `revision` (the dock's) must be the cut's; the cut must still be at the turn's revision.
     * @throws {CutConflictError|CutInvalidError}
     */
    undo(spaceId, { turn, revision = null, by = 'person' }) {
        const cut = this.cuts.current(spaceId);
        if (revision != null && Number(revision) !== cut.revision) throw new CutConflictError(cut);
        const row = turn == null ? this.repo.latest(spaceId) : this.repo.findInSpace(spaceId, Number(turn));
        if (!row || row.after_rev == null || row.undone_at) throw new CutInvalidError(NO_TURN);
        if (row.after_rev !== cut.revision) throw new CutInvalidError(LATER_EDITS);
        const { items, sound, settings } = row.before;
        const saved = this.edits.save(spaceId, {
            items, sound, settings, revision: cut.revision, by, draft: true, previous: 'keep', restore: items, restoreStamps: true, turn: row.id,
        });
        this.repo.update(row.id, { undone_at: new Date().toISOString() });
        return saved;
    }

    /**
     * "Keep the trims but undo the dissolves" (05 §3.3): only these fields of the turn's items go back to their
     * before values. Returns the items list to save; the caller applies it through its own ops (and the lock).
     */
    partial(spaceId, kinds) {
        const row = this.repo.latest(spaceId);
        const cut = this.cuts.current(spaceId);
        if (!row || row.after_rev == null || row.undone_at) throw new CutInvalidError(NO_TURN);
        if (row.after_rev !== cut.revision) throw new CutInvalidError(LATER_EDITS);
        const before = new Map(row.before.items.map((i) => [i.id, i]));
        const touched = [];
        const items = cut.items.map((item) => {
            const old = before.get(item.id);
            if (!old) return item;
            const next = { ...item };
            if (kinds.includes('trim')) Object.assign(next, { in_ms: old.in_ms, out_ms: old.out_ms });
            if (kinds.includes('join')) next.join = old.join;
            if (kinds.includes('sound')) next.sound = old.sound;
            if (JSON.stringify(next) !== JSON.stringify(item)) touched.push(item.id);
            return next;
        });
        const sound = kinds.includes('duck') || kinds.includes('level') ? row.before.sound : cut.sound;
        // A level takes back the loudness target; 'outputs' (P6) the export set-up; each keeps the other's.
        // A key the turn added goes back to null: the save merges with the stored settings, so a missing key would keep it.
        let settings = { ...cut.settings };
        if (kinds.includes('level')) settings = { ...row.before.settings, target_lufs: row.before.settings?.target_lufs ?? null, outputs: cut.settings?.outputs ?? null };
        if (kinds.includes('outputs')) settings = { ...settings, outputs: row.before.settings?.outputs ?? null };
        return { items, sound, settings, touched, turn: row.id };
    }
}

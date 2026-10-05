// CutOps (03-director.md §3): the Director's one writer for the Cut, a mirror of BoardOps. An op list is checked
// whole — shape (validate.js), then every op against the cut as the earlier ops leave it (op-handlers.js), the
// edit lock included — and saved in ONE write through CutEdits, the same path as the dock's PUT. All or nothing:
// any reason refuses the whole list, and nothing is written. The turn's first write keeps the cut as it was in
// cut_turns, so the whole turn undoes in one step. It never renders, never exports and never queues a job.
import { CutConflictError } from '../../repositories/cuts.js';
import { cutClock } from '../../../shared/cut-clock.js';
import { CUT_LIMITS, checkItems } from '../../../shared/cut-rules.js';
import { beatsInCut } from '../../../shared/cut-ducks.js';
import { CutInvalidError } from '../../cut/validate-cut.js';
import { CutOpsRejected, TIMED, shapeProblems } from './validate.js';
import { applyOp } from './op-handlers.js';
import { isLocked, namedItems } from './lock.js';
import { appliedEdits, editLines, personLines } from './applied-edits.js';
import { heardCache } from '../../../shared/steady-sound.js';
import { scriptsOf } from '../../cut/captions-plan.js';

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const NOT_MEASURED_TOOLS = 'is not measured, so no time can be set. Say the cut could not be measured on this PC in one sentence.';
const NOT_MEASURED_YET = 'is not measured yet, so no time can be set. Leave its times as they are and say it is still being measured.';

/** The working copy one op list edits, with the checks the handlers share. */
export class WorkingCut {
    constructor({ cut, slots, beats, analysisOf, toolsMissing, opened, takesOf, measured, soundCards = [] }) {
        Object.assign(this, { slots, beats, analysisOf, toolsMissing, opened, takesOf, measured, soundCards });
        this.items = clone(cut.items);
        this.sound = clone(cut.sound);
        this.settings = clone(cut.settings);
        this.reasons = [];
        this.rows = [];
        this.summary = [];
        this.snapped = [];
        this.hints = []; // P6: sentences the model must say (the outputs op: a crop will be soft)
        this.notes = new Map();
        this.counts = {};
        const bed = cut.sound?.music ? analysisOf(cut.sound.music.media_path) : null;
        this.downbeats = bed ? beatsInCut(bed, cutClock(cut.items).total_ms).downbeats_ms : [];
    }

    reason(text) {
        this.reasons.push(text);
    }

    count(kind) {
        this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    }

    mayEdit(item) {
        return !isLocked(item) || this.opened === 'all' || this.opened.has(item.id);
    }

    /** A timed op needs the video tools and a measured clip (or, with no clip, at least the tools). */
    timedOk(n, item) {
        const tag = item?.beat_tag ?? 'The cut';
        if (this.toolsMissing) return this.reason(`op ${n}: ${tag} ${NOT_MEASURED_TOOLS}`), false;
        if (item && !this.measured(item)) return this.reason(`op ${n}: ${tag} ${NOT_MEASURED_YET}`), false;
        return true;
    }

    note(itemId, phrase) {
        this.notes.set(itemId, [...(this.notes.get(itemId) ?? []), phrase]);
    }

    row(op, item, text, why = null, extra = {}) {
        this.rows.push({ kind: op.op, beat_tag: item?.beat_tag ?? null, node_id: item?.node_id ?? null, item_id: item?.id ?? null, text, why: why ?? op.why ?? null, ...extra });
    }

    /** The notes as they go on the clips: phrases joined with " · ", whole phrases only, at most 40 characters. */
    noted() {
        return this.items.map((item) => {
            const phrases = this.notes.get(item.id);
            if (!phrases) return item;
            let text = '';
            for (const p of phrases) {
                const next = text ? `${text} · ${p}` : p;
                if (next.length > CUT_LIMITS.noteMax) break;
                text = next;
            }
            return { ...item, note: text || phrases[0].slice(0, CUT_LIMITS.noteMax) };
        });
    }
}

export class CutOps {
    /**
     * @param {{ cuts: object, boardCut: object, edits: import('../../cut/cut-edits.js').CutEdits, turns: import('../../cut/cut-turns.js').CutTurns,
     *   analysis: { cached: (paths: string[]) => Map<string, object>, toolsMissing: boolean }, plans: object, db: object }} deps
     */
    constructor(deps) {
        this.deps = deps;
    }

    /**
     * @param {number} spaceId
     * @param {object[]} ops
     * @param {{ request: string, ledger: object }} turn
     * @returns {{ saved: object, before_ms: number, after_ms: number, edits: number, lines: string[], snapped: string[], rows: object[], summary: object[], changed: number[], turn: number }}
     * @throws {CutOpsRejected}
     */
    apply(spaceId, ops, { request, ledger }) {
        const shape = shapeProblems(ops);
        // A list that cannot be read at all stops here; otherwise every op is still checked against the cut, so the
        // model gets every reason in one answer (bloop: "collected first").
        const unreadable = new Set(shape.map((r) => Number(/^op (\d+)/.exec(r)?.[1] ?? 0)));
        if (shape.length && (unreadable.has(0) || ops.some((o) => o?.op === 'undo_turn'))) throw new CutOpsRejected(shape);
        if (ops[0].op === 'undo_turn') return this.#undo(spaceId, ops[0], { request, ledger });
        const { cuts, boardCut, analysis, plans } = this.deps;
        const cut = cuts.current(spaceId);
        if (!cut.items.length && !ops.some((o) => o.op === 'place')) throw new CutOpsRejected(['The cut is empty, so there is nothing to edit. Put the clips in with stitch_cut first.']);
        const read = boardCut.read(spaceId, { cut });
        const plan = plans.latest(spaceId);
        const beats = plan ? plans.beats(plan.id).map((b) => b.tag) : [];
        const cached = analysis.cached([...cut.items.map((i) => i.media_path), cut.sound?.music?.media_path, cut.sound?.voice?.media_path]);
        const cache = heardCache(cached, cut.items, scriptsOf(this.deps.db, spaceId)); // steady sound: steady-sound.js
        const measuredNodes = new Set(read.slots.filter((s) => s.measured).map((s) => s.node_id));
        const w = new WorkingCut({
            cut, beats, slots: read.slots,
            analysisOf: (path) => cache.get(path) ?? null,
            toolsMissing: Boolean(analysis.toolsMissing),
            opened: namedItems(request, cut.items, beats),
            takesOf: (nodeId) => this.deps.db.prepare('SELECT id, media_path, duration_ms FROM takes WHERE node_id = ? ORDER BY id DESC').all(nodeId),
            measured: (item) => measuredNodes.has(item.node_id) && item.seconds_ms > 0,
            soundCards: ops.some((o) => o?.op === 'music') ? boardCut.soundCards(spaceId) : [],
        });
        ops.forEach((op, i) => {
            if (!unreadable.has(i + 1)) applyOp(w, i + 1, op);
        });
        const reasons = [...shape, ...w.reasons].sort((a, b) => Number(/^op (\d+)/.exec(a)?.[1] ?? 0) - Number(/^op (\d+)/.exec(b)?.[1] ?? 0));
        if (reasons.length) throw new CutOpsRejected(reasons);
        const items = w.noted();
        const rule = checkItems(items);
        if (rule) throw new CutOpsRejected([`The cut would not hold after these ops: ${rule}`]);
        return this.#save(spaceId, cut, { items, sound: w.sound, settings: w.settings }, w, ledger);
    }

    #save(spaceId, cut, next, w, ledger) {
        const { edits, turns } = this.deps;
        turns.begin(spaceId, ledger);
        let saved;
        try {
            saved = edits.save(spaceId, { ...next, revision: cut.revision, by: 'director', turn: ledger.cutTurnId });
        } catch (error) {
            turns.abandon(ledger);
            if (error instanceof CutConflictError) throw new CutOpsRejected(['The person changed the cut while you were working, so nothing was written. Read it again with inspect_cut and send the ops again.']);
            if (error instanceof CutInvalidError) throw new CutOpsRejected([`The cut would not hold after these ops: ${error.message}`]);
            throw error;
        }
        const before = new Map(cut.items.map((i) => [i.id, i]));
        const changed = saved.items.filter((i) => !before.has(i.id) || JSON.stringify(before.get(i.id)) !== JSON.stringify(i)).map((i) => i.node_id);
        const removed = cut.items.filter((i) => !saved.items.some((s) => s.id === i.id)).map((i) => i.node_id);
        // What landed, read from the cut before and after the save (applied-edits.js): the one list and the one
        // count for the strip, the reveal text, Undo turn, the model's tool result and the ledger's closing words.
        const applied = appliedEdits({ before: cut, after: saved, rows: w.rows, summary: w.summary });
        const rows = applied.rows.map(({ detail: _detail, ...r }) => r); // at_ms: Go to edit moves the playhead there
        const reasons = rows.filter((r) => r.why).map((r) => ({ beat_tag: r.beat_tag, item_id: r.item_id, op: r.kind, why: r.why, text: r.text }));
        turns.record(ledger.cutTurnId, saved, { rows, summary: applied.summary, reasons, changed: [...changed, ...removed], edits: applied.count });
        ledger.recordCut({ edits: applied.count, changed: [...changed, ...removed], lines: personLines(applied) });
        return {
            saved, before_ms: cutClock(cut.items).total_ms, after_ms: cutClock(saved.items).total_ms, edits: applied.count, lines: editLines(applied),
            snapped: w.snapped, rows, summary: applied.summary, changed: [...new Set([...changed, ...removed])], turn: ledger.cutTurnId, hints: w.hints ?? [],
        };
    }

    /** "Undo that": the whole last turn, or only some kinds of edit ("keep the trims, undo the dissolves"). */
    #undo(spaceId, op, { request, ledger }) {
        const { cuts, turns, plans } = this.deps;
        const cut = cuts.current(spaceId);
        const beforeMs = cutClock(cut.items).total_ms;
        try {
            if (!op.kinds) {
                const saved = turns.undo(spaceId, { by: 'director' });
                ledger.recordCut({ edits: 1, changed: saved.items.map((i) => i.node_id), undo: true, lines: ['Took back the last turn'] });
                return { saved, before_ms: beforeMs, after_ms: cutClock(saved.items).total_ms, edits: 1, lines: [], snapped: [], rows: [], summary: [], changed: [], turn: null, undone: 'all' };
            }
            const back = turns.partial(spaceId, op.kinds);
            const plan = plans.latest(spaceId);
            const opened = namedItems(request, cut.items, plan ? plans.beats(plan.id).map((b) => b.tag) : []);
            const locked = cut.items.filter((i) => back.touched.includes(i.id) && isLocked(i) && opened !== 'all' && !opened.has(i.id));
            if (locked.length) throw new CutOpsRejected([`${locked.map((i) => i.beat_tag).join(', ')} changed by the person since that turn, so it is theirs. Leave it, or ask them in one sentence.`]);
            const took = `Took back: ${op.kinds.join(', ')}`;
            const whole = op.kinds.filter((k) => ['duck', 'level', 'outputs', 'music'].includes(k));
            const w = { snapped: [], rows: back.touched.map((id) => ({ kind: 'undo', item_id: id, text: took })), summary: whole.length ? [{ kind: 'undo', track: null, text: `Took back: ${whole.join(', ')}`, why: null }] : [] };
            return this.#save(spaceId, cut, { items: back.items, sound: back.sound, settings: back.settings }, w, ledger);
        } catch (error) {
            if (error instanceof CutInvalidError) throw new CutOpsRejected([`${error.message} Say so in one sentence.`]);
            throw error;
        }
    }
}

export { TIMED };

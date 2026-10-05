// The live cut (05-irresistible.md §2.1, P2b): on a planned board, while the person has not edited the cut
// (`space_cuts.auto` = 1), every clip that lands drops into its slot in beat order by itself, and a music bed that
// lands goes under it. It listens to the board's events, OUTSIDE the generation stages: a `node` done event, then
// the measurer's queue (so the clip goes in at its measured length). It writes only through CutDraft (fill into an
// empty cut, else add_new), which never moves, trims or removes an item, and saves as `by: 'auto'`.
//
// The first save by the person turns auto off for good (CutEdits, in the same statement). A save that loses the race
// to the person's edit is a revision conflict: the cut is read again, auto is off, and nothing is placed.
// Never on a board without a plan, never a render, never an export.
import { CutConflictError } from '../repositories/cuts.js';

const SOUND = new Set(['video', 'audio', 'upload']);

export class LiveCut {
    /**
     * @param {{ events: import('../generation/events.js').BoardEvents, cuts: import('../repositories/cuts.js').CutsRepository,
     *   drafts: import('./cut-draft.js').CutDraft, plans: import('../repositories/director-plans.js').DirectorPlans,
     *   spaces: import('../repositories/spaces.js').SpacesRepository, measurer?: { settled: () => Promise<void> } | null,
     *   log?: Pick<Console, 'warn'> }} deps
     */
    constructor({ events, cuts, drafts, plans, spaces, measurer = null, log = console }) {
        Object.assign(this, { events, cuts, drafts, plans, spaces, measurer, log });
        this.queues = new Map(); // spaceId → the promise of the last placement (one at a time per board)
        this.onNode = (update) => {
            if (update?.status === 'done' && update.spaceId != null) this.landed(update.spaceId, update.nodeId);
        };
    }

    start() {
        this.events.on('node', this.onNode);
        return this;
    }

    stop() {
        this.events.off('node', this.onNode);
    }

    /** A card finished: after its length is measured, place what is new. Resolves with the result; never rejects. */
    landed(spaceId, nodeId) {
        const node = nodeId == null ? null : this.spaces.findNode(spaceId, nodeId);
        if (nodeId != null && (!node || !SOUND.has(node.type))) return Promise.resolve(null);
        const previous = this.queues.get(spaceId) ?? Promise.resolve();
        const run = previous
            .then(() => this.measurer?.settled())
            .then(() => this.place(spaceId))
            .catch((error) => {
                this.log.warn(`Live cut: space ${spaceId} not placed: ${error.message}`);
                return null;
            });
        this.queues.set(spaceId, run);
        run.finally(() => { if (this.queues.get(spaceId) === run) this.queues.delete(spaceId); });
        return run;
    }

    /** One placement: only on a planned board, only while auto is on. Returns CutDraft's result, or null. */
    place(spaceId, { retried = false } = {}) {
        const plan = this.plans.latest(spaceId);
        if (!plan || !this.plans.beats(plan.id).length) return null;
        const cut = this.cuts.current(spaceId);
        if (!cut.auto) return null;
        try {
            return this.drafts.draft(spaceId, {
                mode: cut.items.length ? 'add_new' : 'fill', by: 'auto', revision: cut.revision,
            });
        } catch (error) {
            // The person saved between our read and our write: read again (their save turned auto off).
            if (error instanceof CutConflictError && !retried) return this.place(spaceId, { retried: true });
            throw error;
        }
    }
}

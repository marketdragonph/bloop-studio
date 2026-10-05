// Render missing beats (05-irresistible.md §2.2): ONE person's press queues every card the plan still owes, after a
// sheet that shows the count, the models, and on bloop the credits and the balance first (owner decision 7).
// A pipeline of handle(ctx, next) stages: collectOwed → orderByWires → estimate (the sheet) → checkCredits →
// enqueueOwed (the press). Jobs go one at a time through the existing GPU worker via the per-card path (enqueue.js).
// Only POST /spaces/:id/render-plan calls queue(): no Director tool, no dock code path, no timer ever does.
import { runPipeline } from '../pipeline.js';
import { queueCard } from '../enqueue.js';
import { collectOwed, orderByWires } from './owed.js';
import { estimate, checkCredits, RenderRefused } from './estimate.js';

export { RenderRefused };

/** The jobs this press queued carry this origin, so Cancel all stops only them (never a card's own Generate). */
export const ORIGIN = 'render-plan';

/** The press: each owed card in wire order, through the same path as its own Generate key. */
export async function enqueueOwed(ctx, next) {
    const { spaces, jobs, events } = ctx.deps;
    ctx.queued = [];
    for (const card of ctx.cards) {
        if (jobs.activeForNode(card.node_id)) continue;
        const node = spaces.findNode(ctx.spaceId, card.node_id);
        if (!node) continue;
        const { job } = queueCard({ spaces, jobs, events }, node, { family: card.pick, announce: false, origin: ORIGIN });
        ctx.queued.push({ node_id: node.id, job_id: job.id });
    }
    if (ctx.queued.length) events.queue(jobs.activeQueue());
    await next();
}

const SHEET = [collectOwed, orderByWires, estimate];
const PRESS = [...SHEET, checkCredits, enqueueOwed];

export class RenderPlan {
    /**
     * @param {{ db, spaces, jobs, events, boardCut, worker, account?, sources: (type: string) => Promise<object> }} deps
     *   `sources`: card-source.js's rule for this PC (generation/offered.js cardSources).
     */
    constructor(deps) {
        this.deps = deps;
    }

    /** What the sheet shows. Reads only. */
    async preview(spaceId) {
        const ctx = await runPipeline(SHEET, { spaceId, deps: this.deps });
        return ctx.summary;
    }

    /**
     * The person's press. @returns {{ queued: object[], summary: object }}
     * @throws {RenderRefused} with nothing queued
     */
    async queue(spaceId) {
        const ctx = await runPipeline(PRESS, { spaceId, deps: this.deps });
        return { queued: ctx.queued, summary: ctx.summary };
    }

    /** Cancel all: the renders this sheet queued on this board, queued or running; never a card's own Generate. */
    async cancelAll(spaceId) {
        const { jobs, worker } = this.deps;
        const active = jobs.activeQueue().filter((job) => job.spaceId === spaceId && job.origin === ORIGIN);
        // Queued first, so none of them starts while the running one stops.
        active.sort((a, b) => (a.status === 'running') - (b.status === 'running'));
        let stopped = 0;
        for (const job of active) if (await worker.cancel(job.nodeId)) stopped += 1;
        return stopped;
    }
}

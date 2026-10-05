// Render missing beats (05-irresistible.md §2.2). GET: the sheet's numbers (cards, models, time or credits and
// balance, what is skipped and why), reads only. POST: the person's press queues every owed card, or refuses with a
// plain reason and nothing queued. DELETE: Cancel all, every render of this board. CSRF guards the mutations.
// No Director tool calls these routes; the Director never renders (katana.md §2).
import { Hono } from 'hono';
import { RenderPlan, RenderRefused } from '../generation/render-plan/index.js';
import { cardSources } from '../generation/offered.js';

const int = (value) => Number.parseInt(value, 10);
const GONE = 'That space no longer exists.';

export function renderPlanRoutes(deps) {
    const routes = new Hono();
    const { spaces } = deps;
    const plan = deps.renderPlan ?? new RenderPlan({ ...deps, sources: deps.sources ?? cardSources(deps) });

    routes.get('/spaces/:id/render-plan', async (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: GONE }, 404);
        return c.json(await plan.preview(spaceId));
    });

    routes.post('/spaces/:id/render-plan', async (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: GONE }, 404);
        try {
            const { queued, summary } = await plan.queue(spaceId);
            return c.json({ queued: queued.length, jobs: queued, summary }, 202);
        } catch (error) {
            if (error instanceof RenderRefused) return c.json({ error: error.message, code: error.code }, 422);
            throw error;
        }
    });

    routes.delete('/spaces/:id/render-plan', async (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: GONE }, 404);
        return c.json({ cancelled: await plan.cancelAll(spaceId) });
    });

    return routes;
}

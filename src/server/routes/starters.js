// Starter boards (05-irresistible.md §2.4), the HTMX modal pattern: GET /spaces/starters opens the modal (from the
// empty Spaces list, or ?space=<id> from an empty board); one press posts the starter. POST /spaces/starters makes a
// new space named after it; POST /spaces/:id/starter lays it out on that empty board. Success redirects to the board
// (HX-Redirect); a refusal re-renders the modal with the plain reason (422). CSRF guards both posts.
// Mounted before the spaces routes, so /spaces/starters is never read as a space id.
import { Hono } from 'hono';
import { ValidationError } from '../repositories/spaces.js';
import { StarterBoards } from '../spaces/apply-starter.js';
import { BoardOps } from '../director/ops/board-ops.js';
import { DirectorPlans } from '../repositories/director-plans.js';
import { cardSources } from '../generation/offered.js';

const int = (value) => Number.parseInt(value, 10);

export function starterRoutes(deps) {
    const routes = new Hono();
    const { views, spaces, db } = deps;
    const starters = deps.starters ?? new StarterBoards({
        db, spaces, plans: deps.plans ?? new DirectorPlans(db), ops: deps.ops ?? new BoardOps({ spaces }),
        sources: deps.sources ?? (deps.engine ? cardSources(deps) : null),
    });

    const modal = (c, { space = null, error = null } = {}, status = 200) => views.render('pages/spaces/starter-modal', {
        starters: starters.list(), space, error,
    }).then((html) => c.html(html, status));

    const done = (c, spaceId) => {
        if (c.req.header('HX-Request')) {
            c.header('HX-Redirect', `/spaces/${spaceId}`);
            return c.body(null, 204);
        }
        return c.redirect(`/spaces/${spaceId}`);
    };

    routes.get('/spaces/starters', (c) => {
        const space = c.req.query('space') ? spaces.find(int(c.req.query('space'))) : null;
        return modal(c, { space });
    });

    routes.post('/spaces/starters', async (c) => {
        const { starter: id } = await c.req.parseBody();
        const starter = starters.find(String(id ?? ''));
        if (!starter) return modal(c, { error: 'Pick one of the starters.' }, 422);
        const space = spaces.create({ name: starter.title, description: starter.line });
        try {
            await starters.apply(space.id, starter.id);
        } catch (error) {
            spaces.delete(space.id);
            if (!(error instanceof ValidationError)) throw error;
            return modal(c, { error: error.message }, 422);
        }
        return done(c, space.id);
    });

    routes.post('/spaces/:id/starter', async (c) => {
        const space = spaces.find(int(c.req.param('id')));
        if (!space) return c.notFound();
        const { starter: id } = await c.req.parseBody();
        try {
            await starters.apply(space.id, String(id ?? ''));
        } catch (error) {
            if (!(error instanceof ValidationError)) throw error;
            return modal(c, { space, error: error.message }, 422);
        }
        return done(c, space.id);
    });

    return routes;
}

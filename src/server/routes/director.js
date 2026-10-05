// Director chat: the log (with any run still going), starting a run in the background, Stop,
// Continue, and clearing the thread. The run's words and board changes stream on the board's
// event stream (GET /spaces/:id/events, event "director"), so they outlive the panel and the page.
import { Hono } from 'hono';
import { CONTINUE_REQUEST, DirectorBusyError } from '../director/runs.js';
import { MISSING_KEY } from '../director/service.js';

const int = (value) => Number.parseInt(value, 10);
const MAX_REQUEST = 4000;

export function directorRoutes({ spaces, director, directorService, directorRuns }) {
    const routes = new Hono();

    const start = (c, spaceId, request) => {
        if (directorService.resolveProvider().missing) return c.json({ error: MISSING_KEY }, 422);
        try {
            return c.json({ runId: directorRuns.start(spaceId, request) }, 202);
        } catch (error) {
            if (error instanceof DirectorBusyError) return c.json({ error: error.message }, 409);
            throw error;
        }
    };

    routes.get('/spaces/:id/director', (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.notFound();
        return c.json({ log: director.log(spaceId), running: directorRuns.active(spaceId) });
    });

    routes.post('/spaces/:id/director', async (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: 'That space no longer exists.' }, 404);
        const { message } = await c.req.json();
        const request = String(message ?? '').trim();
        if (!request) return c.json({ error: 'Type what you want the Director to build.' }, 422);
        if (request.length > MAX_REQUEST) return c.json({ error: `Keep requests under ${MAX_REQUEST} characters.` }, 422);
        return start(c, spaceId, request);
    });

    // Picks up a turn that ran out of steps, was stopped, or was cut off by a closed app.
    routes.post('/spaces/:id/director/continue', (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: 'That space no longer exists.' }, 404);
        return start(c, spaceId, CONTINUE_REQUEST);
    });

    routes.post('/spaces/:id/director/stop', (c) => {
        const stopped = directorRuns.stop(int(c.req.param('id')));
        return stopped ? c.body(null, 204) : c.json({ error: 'The Director is not working on anything.' }, 409);
    });

    routes.delete('/spaces/:id/director', (c) => {
        const spaceId = int(c.req.param('id'));
        if (directorRuns.active(spaceId)) return c.json({ error: 'Stop the Director before clearing the conversation.' }, 409);
        director.clear(spaceId);
        return c.body(null, 204);
    });

    return routes;
}

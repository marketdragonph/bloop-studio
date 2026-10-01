// Director chat: the log, a streamed turn (POST → SSE response), and clearing the thread.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

const int = (value) => Number.parseInt(value, 10);
const MAX_REQUEST = 4000;

export function directorRoutes({ spaces, director, directorService }) {
    const routes = new Hono();

    routes.get('/spaces/:id/director', (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.notFound();
        return c.json(director.log(spaceId));
    });

    routes.post('/spaces/:id/director', async (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: 'That space no longer exists.' }, 404);
        const { message } = await c.req.json();
        const request = String(message ?? '').trim();
        if (!request) return c.json({ error: 'Type what you want the Director to build.' }, 422);
        if (request.length > MAX_REQUEST) return c.json({ error: `Keep requests under ${MAX_REQUEST} characters.` }, 422);

        return streamSSE(c, async (stream) => {
            const abort = new AbortController();
            stream.onAbort(() => abort.abort());
            const emit = (event, data) => stream.writeSSE({ event, data: JSON.stringify(data) });
            await directorService.turn(spaceId, request, emit, abort.signal);
        });
    });

    routes.delete('/spaces/:id/director', (c) => {
        director.clear(int(c.req.param('id')));
        return c.body(null, 204);
    });

    return routes;
}

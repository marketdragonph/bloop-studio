// Generate / cancel a card, the board's live event stream, and serving rendered media.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { mimeFromName } from '../generation/media-store.js';
import { familiesFor } from '../generation/presets.js';

const int = (value) => Number.parseInt(value, 10);

export function generationRoutes({ spaces, jobs, worker, events, media, presets }) {
    const routes = new Hono();

    routes.post('/spaces/:id/nodes/:nodeId/generate', (c) => {
        const node = spaces.findNode(int(c.req.param('id')), int(c.req.param('nodeId')));
        if (!node) return c.json({ error: 'That card no longer exists.' }, 404);
        if (!['image', 'video'].includes(node.type)) return c.json({ error: 'Only Image and Video cards render.' }, 422);
        if (jobs.activeForNode(node.id)) return c.json({ error: 'This card is already rendering.' }, 409);

        const job = jobs.enqueue({ nodeId: node.id, preset: node.settings.family ?? 'auto' });
        spaces.setNodeResult(node.id, { status: 'queued' });
        const position = jobs.queuePosition(job.id);
        events.node({ spaceId: node.space_id, nodeId: node.id, status: 'queued', label: position ? `queued (#${position + 1})` : 'queued' });
        return c.json({ jobId: job.id, position }, 202);
    });

    routes.post('/spaces/:id/nodes/:nodeId/cancel', async (c) => {
        const canceled = await worker.cancel(int(c.req.param('nodeId')));
        return canceled ? c.body(null, 204) : c.json({ error: 'Nothing is rendering on this card.' }, 409);
    });

    routes.get('/spaces/:id/nodes/:nodeId/takes', (c) => c.json(jobs.takes(int(c.req.param('nodeId')))));

    routes.get('/presets/:type', (c) => c.json(familiesFor(presets, c.req.param('type'))));

    // One stream per open board; only that board's cards are sent.
    routes.get('/spaces/:id/events', (c) => {
        const spaceId = int(c.req.param('id'));
        return streamSSE(c, async (stream) => {
            const onNode = (update) => {
                if (update.spaceId === spaceId) stream.writeSSE({ event: 'node', data: JSON.stringify(update) });
            };
            events.on('node', onNode);
            stream.onAbort(() => events.off('node', onNode));
            while (!stream.aborted) {
                await stream.writeSSE({ event: 'ping', data: '' });
                await stream.sleep(15_000);
            }
        });
    });

    routes.get('/media/*', async (c) => {
        const relativePath = decodeURIComponent(c.req.path.slice('/media/'.length));
        if (!media.resolve(relativePath)) return c.notFound();
        try {
            const bytes = await media.read(relativePath);
            return c.body(bytes, 200, { 'content-type': mimeFromName(relativePath), 'cache-control': 'private, max-age=31536000, immutable' });
        } catch {
            return c.notFound();
        }
    });

    return routes;
}

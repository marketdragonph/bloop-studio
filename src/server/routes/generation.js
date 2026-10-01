// Generate / cancel a card, the board's live event stream, and serving rendered media.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { mimeFromName, UPLOADABLE, MAX_UPLOAD_BYTES } from '../generation/media-store.js';
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

    // A file dropped on an Upload card becomes that card's media (a picture or a clip to wire onward).
    routes.post('/spaces/:id/nodes/:nodeId/upload', async (c) => {
        const node = spaces.findNode(int(c.req.param('id')), int(c.req.param('nodeId')));
        if (!node || node.type !== 'upload') return c.json({ error: 'Only Upload cards take files.' }, 422);
        const { file } = await c.req.parseBody();
        if (!(file instanceof File)) return c.json({ error: 'Choose a file to upload.' }, 422);
        if (!UPLOADABLE.has(file.type)) return c.json({ error: 'Use a PNG, JPEG or WebP picture, or an MP4 or WebM clip.' }, 422);
        if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'That file is over 500 MB.' }, 422);

        const bytes = Buffer.from(await file.arrayBuffer());
        const mediaPath = await media.saveUpload({ spaceId: node.space_id, nodeId: node.id, bytes, mime: file.type });
        spaces.setNodeResult(node.id, { status: 'done', media_path: mediaPath, media_mime: file.type });
        spaces.updateNode(node.space_id, node.id, { label: file.name.slice(0, 120) });
        return c.json(spaces.findNode(node.space_id, node.id));
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

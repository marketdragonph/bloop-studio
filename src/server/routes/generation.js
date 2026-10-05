// Generate / cancel a card, the board's live event stream, and serving rendered media.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { mimeFromName, UPLOADABLE, MAX_UPLOAD_BYTES } from '../generation/media-store.js';
import { familiesFor } from '../generation/presets.js';
import { cloudFamilies } from '../generation/cloud-models.js';

const int = (value) => Number.parseInt(value, 10);

export function generationRoutes({ spaces, jobs, worker, events, media, engine, account, launcher, reveal }) {
    const routes = new Hono();

    /**
     * A card's Model list, in order; the first is what a card with no pick renders on.
     * Local families first. CLOUD ONLY — no ComfyUI answering and none on this PC to start — bloop's
     * models come first, so a signed-in PC without a GPU setup renders out of the box. A PC whose
     * ComfyUI is merely off keeps local first: an untouched card never spends credits by surprise.
     */
    const offered = async (type) => {
        const profile = await engine.current();
        const local = familiesFor(profile.presets, type);
        const cloud = cloudFamilies(await account?.models(), type);
        const cloudOnly = cloud.length && !profile.detected && !launcher?.state().available;
        return cloudOnly ? [...cloud, ...local] : [...local, ...cloud];
    };

    routes.post('/spaces/:id/nodes/:nodeId/generate', async (c) => {
        let node = spaces.findNode(int(c.req.param('id')), int(c.req.param('nodeId')));
        if (!node) return c.json({ error: 'That card no longer exists.' }, 404);
        if (!['image', 'video', 'audio'].includes(node.type)) return c.json({ error: 'Only Image, Video and Audio cards render.' }, 422);
        if (jobs.activeForNode(node.id)) return c.json({ error: 'This card is already rendering.' }, 409);

        // A card with no pick renders on what its Model list shows first, so the press matches the card.
        if (!node.settings?.family) {
            const first = (await offered(node.type))[0]?.id;
            if (first) node = spaces.updateNode(node.space_id, node.id, { settings: { family: first } });
        }

        const job = jobs.enqueue({ nodeId: node.id, preset: node.settings.family ?? 'auto' });
        spaces.setNodeResult(node.id, { status: 'queued' });
        const position = jobs.queuePosition(job.id);
        events.node({ spaceId: node.space_id, nodeId: node.id, status: 'queued' });
        events.queue(jobs.activeQueue());
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
        if (!UPLOADABLE.has(file.type)) return c.json({ error: 'Use a PNG, JPEG or WebP picture, an MP4 or WebM clip, or an MP3, WAV, OGG, FLAC or M4A voice.' }, 422);
        if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'That file is over 500 MB.' }, 422);

        const bytes = Buffer.from(await file.arrayBuffer());
        const mediaPath = await media.saveUpload({ spaceId: node.space_id, nodeId: node.id, bytes, mime: file.type });
        spaces.setNodeResult(node.id, { status: 'done', media_path: mediaPath, media_mime: file.type });
        spaces.updateNode(node.space_id, node.id, { label: file.name.slice(0, 120) });
        return c.json(spaces.findNode(node.space_id, node.id));
    });

    routes.get('/spaces/:id/nodes/:nodeId/takes', (c) => c.json(jobs.takes(int(c.req.param('nodeId')))));

    // The families this machine's ComfyUI can run (see EngineProfile), then bloop's cloud models
    // when a paid bloop account is signed in.
    routes.get('/presets/:type', async (c) => c.json(await offered(c.req.param('type'))));

    // One stream per open board; only that board's cards are sent.
    routes.get('/spaces/:id/events', (c) => {
        const spaceId = int(c.req.param('id'));
        return streamSSE(c, async (stream) => {
            const onNode = (update) => {
                if (update.spaceId === spaceId) stream.writeSSE({ event: 'node', data: JSON.stringify(update) });
            };
            // The queue is shared by every board, so each board sees how many renders are ahead of its own.
            const onQueue = (order) => stream.writeSSE({ event: 'queue', data: JSON.stringify(order) });
            // The Director's background run on this board: its words and board changes as they happen.
            const onDirector = (update) => {
                if (update.spaceId === spaceId) stream.writeSSE({ event: 'director', data: JSON.stringify(update) });
            };
            events.on('node', onNode);
            events.on('queue', onQueue);
            events.on('director', onDirector);
            stream.onAbort(() => {
                events.off('node', onNode);
                events.off('queue', onQueue);
                events.off('director', onDirector);
            });
            await onQueue(jobs.activeQueue());
            while (!stream.aborted) {
                await stream.writeSSE({ event: 'ping', data: '' });
                await stream.sleep(15_000);
            }
        });
    });

    // Local app: show the file in File Explorer (selected) instead of downloading a second copy.
    routes.post('/media/reveal', async (c) => {
        const { path: relativePath } = await c.req.json();
        const full = typeof relativePath === 'string' ? media.resolve(relativePath) : null;
        if (!full) return c.json({ error: 'That file is not in the media folder.' }, 404);
        await reveal(full);
        return c.body(null, 204);
    });

    routes.get('/media/*', async (c) => {
        const relativePath = decodeURIComponent(c.req.path.slice('/media/'.length));
        if (!media.resolve(relativePath)) return c.notFound();
        try {
            const bytes = await media.read(relativePath);
            const headers = { 'content-type': mimeFromName(relativePath), 'cache-control': 'private, max-age=31536000, immutable' };
            // ?download=<name> saves the original file under a readable name (the card's title).
            const name = c.req.query('download');
            if (name !== undefined) {
                const ext = relativePath.slice(relativePath.lastIndexOf('.'));
                const safe = (name || 'bloop-studio').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 100) || 'bloop-studio';
                headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(safe + ext)}`;
            }
            return c.body(bytes, 200, headers);
        } catch {
            return c.notFound();
        }
    });

    return routes;
}

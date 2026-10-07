// Generate / cancel a card, the board's live event stream, and serving rendered media. Uploads: routes/uploads.js.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { parseByteRange } from '../media/byte-range.js';
import { mimeFromName } from '../generation/media-store.js';
import { cardSources } from '../generation/offered.js';
import { queueCard } from '../generation/enqueue.js';

const int = (value) => Number.parseInt(value, 10);

export function generationRoutes({ spaces, jobs, worker, events, media, engine, account, launcher, reveal, loras }) {
    const routes = new Hono();

    // A card's Model list, in order (src/shared/card-source.js); the first is what a card with no pick renders on.
    const sources = cardSources({ engine, account, launcher, loras });
    const offered = async (type) => (await sources(type)).families;

    routes.post('/spaces/:id/nodes/:nodeId/generate', async (c) => {
        const node = spaces.findNode(int(c.req.param('id')), int(c.req.param('nodeId')));
        if (!node) return c.json({ error: 'That card no longer exists.' }, 404);
        if (!['image', 'video', 'audio'].includes(node.type)) return c.json({ error: 'Only Image, Video and Audio cards render.' }, 422);
        if (jobs.activeForNode(node.id)) return c.json({ error: 'This card is already rendering.' }, 409);

        // A card with no pick renders on what its Model list shows first, so the press matches the card.
        const family = node.settings?.family ? null : (await sources(node.type)).family;
        const { job, position } = queueCard({ spaces, jobs, events }, node, { family });
        return c.json({ jobId: job.id, position }, 202);
    });

    routes.post('/spaces/:id/nodes/:nodeId/cancel', async (c) => {
        const canceled = await worker.cancel(int(c.req.param('nodeId')));
        return canceled ? c.body(null, 204) : c.json({ error: 'Nothing is rendering on this card.' }, 409);
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
            // The Cut: what the dock can hold changed (a take landed or was measured, a card was deleted).
            const onCut = (update) => {
                if (update.spaceId === spaceId) stream.writeSSE({ event: 'cut', data: JSON.stringify({ space_id: update.spaceId, ...update }) });
            };
            // Export and Pack jobs of this board (throttled to 4 frames a second by the job).
            const onCutExport = ({ spaceId: id, exportId, nodeId, ...update }) => {
                if (id === spaceId) stream.writeSSE({ event: 'cut_export', data: JSON.stringify({ space_id: id, export_id: exportId, node_id: nodeId ?? null, ...update }) });
            };
            events.on('node', onNode);
            events.on('queue', onQueue);
            events.on('director', onDirector);
            events.on('cut', onCut);
            events.on('cut_export', onCutExport);
            stream.onAbort(() => {
                events.off('node', onNode);
                events.off('queue', onQueue);
                events.off('director', onDirector);
                events.off('cut', onCut);
                events.off('cut_export', onCutExport);
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

    // Streams the file; a Range request gets 206 with only that slice, so seeking a long clip never reads it all.
    routes.get('/media/*', async (c) => {
        const relativePath = decodeURIComponent(c.req.path.slice('/media/'.length));
        const full = media.resolve(relativePath);
        if (!full) return c.notFound();
        try {
            const info = await stat(full);
            if (!info.isFile()) return c.notFound();
            const size = info.size;
            const headers = {
                'content-type': mimeFromName(relativePath),
                'cache-control': 'private, max-age=31536000, immutable',
                'accept-ranges': 'bytes',
            };
            // ?download=<name> saves the original file under a readable name (the card's title).
            const name = c.req.query('download');
            if (name !== undefined) {
                const ext = relativePath.slice(relativePath.lastIndexOf('.'));
                const safe = (name || 'bloop-studio').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 100) || 'bloop-studio';
                headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(safe + ext)}`;
            }
            const range = parseByteRange(c.req.header('range'), size);
            if (range === 'unsatisfiable') return c.body(null, 416, { ...headers, 'content-range': `bytes */${size}` });
            const stream = (opts) => Readable.toWeb(createReadStream(full, opts));
            if (!range) return c.body(size ? stream({}) : null, 200, { ...headers, 'content-length': String(size) });
            const { start, end } = range;
            return c.body(stream({ start, end }), 206, {
                ...headers,
                'content-range': `bytes ${start}-${end}/${size}`,
                'content-length': String(end - start + 1),
            });
        } catch {
            return c.notFound();
        }
    });

    return routes;
}

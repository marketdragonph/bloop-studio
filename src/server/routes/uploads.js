// A file dropped on an Upload card (or brought in by Bring my clips) becomes that card's media. The body IS the file
// (Content-Type = its type, X-File-Name = its name, URL-encoded), streamed to the media folder: a 500 MB clip is never
// held in memory (05-irresistible.md §2.5). A clip or a sound is also a take, measured by ffprobe off the event loop
// (TakeMeasurer, the capped runner), so the Cut knows its real length before anything fills. CSRF guards it.
import { rm } from 'node:fs/promises';
import { Hono } from 'hono';
import { UPLOADABLE, MAX_UPLOAD_BYTES, UploadTooLargeError } from '../generation/media-store.js';
import { withoutExtension } from '../../shared/safe-name.js';

const int = (value) => Number.parseInt(value, 10);
const KINDS = 'Use a PNG, JPEG or WebP picture, an MP4 or WebM clip, or an MP3, WAV, OGG, FLAC or M4A voice.';
const tooLarge = (maxBytes) => `That file is over ${Math.round(maxBytes / (1024 * 1024))} MB.`;

/** The file's own name from the X-File-Name header, without folders or control characters. */
export function fileName(header) {
    let name = '';
    try {
        name = decodeURIComponent(String(header ?? ''));
    } catch {
        name = String(header ?? '');
    }
    return name.split(/[\\/]/).pop().replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 120);
}

/**
 * The card's label after a file came in: the file's name without its extension (it flows into cut tags, the dock and
 * Pack names). A label the person typed stays; only an empty one, "Upload", or the name of a file that came in
 * before (with or without its extension) is replaced.
 */
export function uploadLabel(current, name, previousNames = []) {
    const label = String(current ?? '').trim();
    const auto = !label || /^upload$/i.test(label) || previousNames.some((n) => n && (label === n || label === withoutExtension(n)));
    return auto ? withoutExtension(name) || 'Upload' : label;
}

export function uploadRoutes({ spaces, jobs, events, media, cuts, measurer = null, maxBytes = MAX_UPLOAD_BYTES }) {
    const routes = new Hono();

    routes.post('/spaces/:id/nodes/:nodeId/upload', async (c) => {
        const node = spaces.findNode(int(c.req.param('id')), int(c.req.param('nodeId')));
        if (!node || node.type !== 'upload') return c.json({ error: 'Only Upload cards take files.' }, 422);
        const type = String(c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
        if (type.startsWith('multipart/')) return c.json({ error: 'Send the file itself, not a form.' }, 415);
        if (!UPLOADABLE.has(type)) return c.json({ error: KINDS }, 422);
        if (Number(c.req.header('content-length')) > maxBytes) return c.json({ error: tooLarge(maxBytes) }, 422);
        const body = c.req.raw.body;
        if (!body) return c.json({ error: 'Choose a file to upload.' }, 422);

        let saved;
        try {
            saved = await media.saveUploadStream({ spaceId: node.space_id, nodeId: node.id, mime: type, body, maxBytes });
        } catch (error) {
            if (error instanceof UploadTooLargeError) return c.json({ error: tooLarge(maxBytes) }, 422);
            throw error;
        }
        if (!saved.bytes) {
            await rm(media.resolve(saved.mediaPath) ?? '', { force: true }).catch(() => {});
            return c.json({ error: 'That file is empty.' }, 422);
        }
        const name = fileName(c.req.header('x-file-name')) || 'Upload';
        spaces.setNodeResult(node.id, { status: 'done', media_path: saved.mediaPath, media_mime: type });
        const before = jobs.takes?.(node.id).map((t) => { try { return JSON.parse(t.params ?? '{}').name; } catch { return null; } }) ?? [];
        spaces.updateNode(node.space_id, node.id, { label: uploadLabel(node.label, name, before) });

        // A clip or a sound is something the Cut can hold: a take with a measured length (NULL when not measured).
        let durationMs = null;
        if (/^(video|audio)\//.test(type)) {
            jobs.addTake({ nodeId: node.id, mediaPath: saved.mediaPath, mime: type, preset: 'upload', seed: null, params: { name } });
            durationMs = (await measurer?.measure({ spaceId: node.space_id, nodeId: node.id, mediaPath: saved.mediaPath })) ?? null;
            events.cut?.({ spaceId: node.space_id, revision: cuts?.revision(node.space_id) ?? 0, by: 'upload', changed: [node.id] });
        }
        return c.json({ ...spaces.findNode(node.space_id, node.id), duration_ms: durationMs, bytes: saved.bytes });
    });

    return routes;
}

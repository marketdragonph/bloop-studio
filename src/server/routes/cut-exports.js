// Export and Pack jobs of the Cut (01-core.md §3, §6, §8). Every job starts from the person's press here:
// the dock and the Director never call these by themselves. Status is reload-safe JSON for either kind at
// /cut/exports/:id; live updates come over the board's SSE stream as `cut_export`. CSRF guards every mutation
// (the app-wide middleware).
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CAPTIONS } from '../../shared/cut-captions.js';

/** 50 caption PNGs of 200 KB each, as base64, plus the rest of the press. */
const PRESS_MAX_BYTES = Math.ceil(CAPTIONS.maxCues * CAPTIONS.pngMaxBytes * 1.4) + 64 * 1024;

const int = (value) => Number.parseInt(value, 10);
const GONE = 'That space no longer exists.';
const NO_JOB = 'That export is not on this space.';

const body = async (c) => {
    try {
        const value = await c.req.json();
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
};

export function cutExportRoutes({ spaces, exporter, packer, exportsRepo }) {
    const routes = new Hono();
    const space = (c) => {
        const id = int(c.req.param('id'));
        return spaces.find(id) ? id : null;
    };
    const viewOf = (row) => (row.kind === 'pack' ? packer.view(row) : exporter.view(row));
    const owner = (row) => (row?.kind === 'pack' ? packer : exporter);

    // The sheet's readout before the press: beats in, skipped, length, size, the reason it cannot export. P6:
    // ?shapes=16:9,9:16 → files [{preset, variant, label, line, hint}], captions {cues, default_on, why_off, mode},
    // soft_bars {offer, on, clips}, ready_for (what the video tools can make), choices (as a press would take them).
    routes.get('/spaces/:id/cut/preflight', async (c) => {
        const id = space(c);
        if (!id) return c.json({ error: GONE }, 404);
        const shapes = c.req.query('shapes') ? c.req.query('shapes').split(',').map((s) => s.trim()).filter(Boolean) : null;
        const { items, ...rest } = await exporter.readout(id, { preset: c.req.query('preset') || null, shapes });
        return c.json({ ...rest, items: items.map((item) => ({ id: item.id, node_id: item.node_id, label: item.label })) });
    });

    // Export: {preset, revision?, poster_ms?, shapes?, captions?: {mode, images: [{id, png}]}, soft_bars?, gif?}
    // → 202 {export, exports, group_id} (new jobs, one per shape) or 200 (the group already running, or these
    // files already made from this revision). 422 {error, code, beat} when the preflight refuses or a caption
    // picture is missing; 409 when the cut moved past `revision`; 413 when the body is too big.
    routes.post('/spaces/:id/cut/exports', bodyLimit({ maxSize: PRESS_MAX_BYTES, onError: (c) => c.json({ error: 'The captions are too big to send. Shorten them and export again.', code: 'captions' }, 413) }), async (c) => {
        const id = space(c);
        if (!id) return c.json({ error: GONE }, 404);
        const input = await body(c);
        const revision = Number.isInteger(input.revision) ? input.revision : null;
        const posterMs = Number.isInteger(input.poster_ms) ? input.poster_ms : null;
        const result = await exporter.start(id, {
            preset: input.preset ?? undefined, revision, posterMs,
            shapes: Array.isArray(input.shapes) ? input.shapes : undefined,
            captions: input.captions && typeof input.captions === 'object' ? input.captions : undefined,
            soft_bars: typeof input.soft_bars === 'boolean' ? input.soft_bars : undefined,
            gif: typeof input.gif === 'boolean' ? input.gif : undefined,
        });
        if (result.error) return c.json({ error: result.error, code: result.code, beat: result.beat ?? null }, result.status ?? 422);
        return c.json({ export: result.export, exports: result.exports, group_id: result.group_id, created: result.created }, result.created ? 202 : 200);
    });

    routes.get('/spaces/:id/cut/exports', (c) => {
        const id = space(c);
        if (!id) return c.json({ error: GONE }, 404);
        return c.json({ exports: exportsRepo.list(id).map(viewOf) });
    });

    // Status of an export or a pack (the dock asks both here after a reload).
    routes.get('/spaces/:id/cut/exports/:exportId', (c) => {
        const id = space(c);
        if (!id) return c.json({ error: GONE }, 404);
        const row = exportsRepo.findInSpace(id, int(c.req.param('exportId')));
        return row ? c.json({ export: viewOf(row) }) : c.json({ error: NO_JOB }, 404);
    });

    // Cancel: a waiting job is dropped, a running one has its child killed; nothing is saved.
    routes.delete('/spaces/:id/cut/exports/:exportId', (c) => {
        const id = space(c);
        if (!id) return c.json({ error: GONE }, 404);
        const jobId = int(c.req.param('exportId'));
        const row = exportsRepo.findInSpace(id, jobId);
        const view = row && owner(row).cancel(id, jobId);
        return view ? c.json({ export: view }) : c.json({ error: NO_JOB }, 404);
    });

    // Pack assets: {include_prompts?} → 202 {export} (kind 'pack'), or 200 with the pack already running.
    const pack = async (c) => {
        const id = space(c);
        if (!id) return c.json({ error: GONE }, 404);
        const input = await body(c);
        const result = packer.start(id, { includePrompts: input.include_prompts !== false });
        return c.json({ export: result.export, created: result.created }, result.created ? 202 : 200);
    };
    routes.post('/spaces/:id/cut/pack', pack);
    routes.post('/spaces/:id/cut/packs', pack);

    return routes;
}

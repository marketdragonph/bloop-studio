// Export and Pack jobs of the Cut (01-core.md §3, §6, §8). Every job starts from the person's press here:
// the dock and the Director never call these by themselves. Status is reload-safe JSON for either kind at
// /cut/exports/:id; live updates come over the board's SSE stream as `cut_export`. CSRF guards every mutation
// (the app-wide middleware).
import { Hono } from 'hono';

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

    // The sheet's readout before the press: beats in, skipped, length, size, the reason it cannot export.
    routes.get('/spaces/:id/cut/preflight', async (c) => {
        const id = space(c);
        if (!id) return c.json({ error: GONE }, 404);
        const { items, ...rest } = await exporter.preflight(id, c.req.query('preset') || undefined);
        return c.json({ ...rest, items: items.map((item) => ({ id: item.id, node_id: item.node_id, label: item.label })) });
    });

    // Export: {preset, revision?, poster_ms?} → 202 {export} (a new job) or 200 {export} (the one already
    // running, or this revision already done). 422 {error, code, beat} when the preflight refuses; 409 when the
    // cut moved past `revision`.
    routes.post('/spaces/:id/cut/exports', async (c) => {
        const id = space(c);
        if (!id) return c.json({ error: GONE }, 404);
        const input = await body(c);
        const revision = Number.isInteger(input.revision) ? input.revision : null;
        const posterMs = Number.isInteger(input.poster_ms) ? input.poster_ms : null;
        const result = await exporter.start(id, { preset: input.preset ?? undefined, revision, posterMs });
        if (result.error) return c.json({ error: result.error, code: result.code, beat: result.beat ?? null }, result.status ?? 422);
        return c.json({ export: result.export, created: result.created }, result.created ? 202 : 200);
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

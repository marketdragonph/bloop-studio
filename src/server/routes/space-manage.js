// Edit and delete a space, from its tile on the Spaces list or from the board's header (HTMX modals).
// On the list a change reloads the page (it keeps the search and the page in its URL); on the board an edit
// renames the title in place, so a move the board has not saved yet is never thrown away, and a delete goes back
// to the list.
import { Hono } from 'hono';
import { ValidationError } from '../repositories/spaces.js';

const id = (c) => Number.parseInt(c.req.param('id'), 10);

/** True when the request was made from the board of space `spaceId` (not from the list). */
const fromBoard = (c, spaceId) => {
    try {
        return new URL(c.req.header('HX-Current-URL') ?? '').pathname === `/spaces/${spaceId}`;
    } catch {
        return false;
    }
};

export function spaceManageRoutes({ views, spaces, jobs = null, directorRuns = null, runner = null, plans = null }) {
    const routes = new Hono();

    /** Why the space cannot be deleted right now (work still writing to it), or null. */
    const busyReason = (spaceId) => {
        if (directorRuns?.active(spaceId)) return 'The Director is working on this space. Stop it, or wait for it to finish, then delete.';
        if (runner && plans && runner.state(plans.latest(spaceId))?.building) return 'The Director is still writing this space\'s beats. Wait for the build to finish, then delete.';
        const renders = (jobs?.activeQueue() ?? []).filter((job) => job.spaceId === spaceId).length;
        if (renders) return `${renders} render${renders === 1 ? ' is' : 's are'} queued or running on this space. Cancel ${renders === 1 ? 'it' : 'them'}, or wait, then delete.`;
        return null;
    };

    const counts = (spaceId) => {
        const board = spaces.board(spaceId);
        return { cards: board?.nodes.length ?? 0, media: board?.nodes.filter((n) => n.media_path).length ?? 0 };
    };

    routes.get('/:id/edit', async (c) => {
        const space = spaces.find(id(c));
        if (!space) return c.notFound();
        return c.html(await views.render('pages/spaces/edit-modal', { space, errors: {}, old: space }));
    });

    routes.put('/:id', async (c) => {
        const space = spaces.find(id(c));
        if (!space) return c.notFound();
        const body = await c.req.parseBody();
        try {
            const saved = spaces.update(space.id, { name: body.name, description: body.description });
            if (!fromBoard(c, space.id)) {
                c.header('HX-Refresh', 'true');
                return c.body(null, 204);
            }
            // The board renames its title from this event; the empty answer closes the modal.
            c.header('HX-Trigger', JSON.stringify({ 'space:updated': { id: saved.id, name: saved.name } }));
            return c.html('');
        } catch (error) {
            if (!(error instanceof ValidationError)) throw error;
            return c.html(await views.render('pages/spaces/edit-modal', { space, errors: { name: error.message }, old: body }), 422);
        }
    });

    routes.get('/:id/delete', async (c) => {
        const space = spaces.find(id(c));
        if (!space) return c.notFound();
        return c.html(await views.render('pages/spaces/delete-modal', { space, ...counts(space.id), busy: busyReason(space.id) }));
    });

    routes.delete('/:id', async (c) => {
        const space = spaces.find(id(c));
        if (!space) return c.notFound();
        const busy = busyReason(space.id);
        if (busy) return c.html(await views.render('pages/spaces/delete-modal', { space, ...counts(space.id), busy }), 422);
        spaces.delete(space.id);
        if (fromBoard(c, space.id)) c.header('HX-Redirect', '/spaces');
        else c.header('HX-Refresh', 'true');
        return c.body(null, 204);
    });

    return routes;
}

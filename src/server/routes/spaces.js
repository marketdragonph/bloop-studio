// Spaces: list + create modal (HTMX pages) and the board's JSON API used by the editor.
import { Hono } from 'hono';
import { ValidationError } from '../repositories/spaces.js';
import { NODE_TYPES } from '../../shared/node-types.js';

const id = (c, name = 'id') => Number.parseInt(c.req.param(name), 10);
const CUT_TYPES = new Set(['video', 'audio', 'upload']);
export const SPACES_PER_PAGE = 12;

/** The pager's numbers: the first, the last and two either side of this page; null marks a gap. */
export function pageNumbers(page, pages) {
    const shown = [...new Set([1, pages, ...[-2, -1, 0, 1, 2].map((d) => page + d)])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    return shown.flatMap((n, i) => (i && n - shown[i - 1] > 1 ? [null, n] : [n]));
}

const KEY_NAMES = { anthropic: 'anthropicApiKey', openai: 'openaiApiKey' };

export function spacesRoutes({ views, spaces, events, cuts, settings = null }) {
    const routes = new Hono();

    /** Ask the Director shows only with a Director key (05 §2.3); the key itself never leaves settings. */
    const directorReady = () => {
        try {
            return Boolean(settings?.get(KEY_NAMES[settings.get('llmProvider')] ?? 'anthropicApiKey'));
        } catch {
            return false;
        }
    };

    // A clip or sound card leaving (or coming back to) the board changes what the Cut can hold.
    const cutChanged = (spaceId, node, by) => {
        if (!node || !CUT_TYPES.has(node.type) || !events?.cut) return;
        events.cut({ spaceId, revision: cuts?.revision(spaceId) ?? 0, by, changed: [node.id] });
    };

    // Turns a ValidationError into a 422 the board can toast; anything else is a real failure.
    const json = (fn) => async (c) => {
        try {
            return await fn(c);
        } catch (error) {
            if (error instanceof ValidationError) return c.json({ error: error.message }, 422);
            throw error;
        }
    };

    const findOr404 = (c) => {
        const space = spaces.find(id(c));
        return space ?? null;
    };

    // ── Pages ──

    // The list: searchable and paged. A search or page change from the page itself swaps only the results.
    routes.get('/', async (c) => {
        const q = String(c.req.query('q') ?? '').trim().slice(0, 120);
        const total = spaces.count({ q });
        const pages = Math.max(1, Math.ceil(total / SPACES_PER_PAGE));
        const page = Math.min(pages, Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1));
        const list = spaces.list({ q, limit: SPACES_PER_PAGE, offset: (page - 1) * SPACES_PER_PAGE });
        const pageUrl = (n) => {
            const query = new URLSearchParams({ ...(q ? { q } : {}), ...(n > 1 ? { page: String(n) } : {}) }).toString();
            return query ? `/spaces?${query}` : '/spaces';
        };
        const data = { spaces: list, q, page, pages, total, pageUrl, pageNumbers: pageNumbers(page, pages), any: q ? spaces.count() > 0 : total > 0 };
        const partial = c.req.header('HX-Target') === 'space-results' && !c.req.header('HX-History-Restore-Request');
        return c.html(await views.render(partial ? 'pages/spaces/results' : 'pages/spaces/index', data));
    });

    routes.get('/create', async (c) => c.html(await views.render('pages/spaces/create-modal', { errors: {}, old: {} })));

    routes.post('/', async (c) => {
        const body = await c.req.parseBody();
        try {
            const space = spaces.create({ name: body.name, description: body.description });
            // HTMX would follow a 302 inside its own request and swap the editor into the modal.
            if (c.req.header('HX-Request')) {
                c.header('HX-Redirect', `/spaces/${space.id}`);
                return c.body(null, 204);
            }
            return c.redirect(`/spaces/${space.id}`);
        } catch (error) {
            if (!(error instanceof ValidationError)) throw error;
            return c.html(await views.render('pages/spaces/create-modal', { errors: { name: error.message }, old: body }), 422);
        }
    });

    routes.get('/:id', async (c) => {
        const board = spaces.board(id(c));
        if (!board) return c.notFound();
        // Embedded in <script type="application/json">: escape "<" so card text can never close the tag.
        const boardJson = JSON.stringify(board).replace(/</g, '\\u003c');
        const creatableTypes = Object.entries(NODE_TYPES).filter(([, t]) => t.creatable).map(([key, t]) => ({ key, ...t }));
        return c.html(await views.render('pages/spaces/editor', { board, boardJson, creatableTypes, directorReady: directorReady() }));
    });

    routes.delete('/:id', (c) => {
        if (!findOr404(c)) return c.notFound();
        spaces.delete(id(c));
        c.header('HX-Redirect', '/spaces');
        return c.body(null, 204);
    });

    // ── Board API (JSON) ──

    routes.get('/:id/board.json', (c) => {
        const board = spaces.board(id(c));
        return board ? c.json(board) : c.notFound();
    });

    routes.patch('/:id', json(async (c) => {
        if (!findOr404(c)) return c.notFound();
        spaces.rename(id(c), (await c.req.json()).name);
        return c.json(spaces.find(id(c)));
    }));

    routes.put('/:id/canvas', json(async (c) => {
        if (!findOr404(c)) return c.notFound();
        spaces.saveCanvas(id(c), await c.req.json());
        return c.json({ ok: true });
    }));

    routes.post('/:id/nodes', json(async (c) => {
        if (!findOr404(c)) return c.notFound();
        return c.json(spaces.createNode(id(c), await c.req.json()), 201);
    }));

    routes.patch('/:id/nodes/:nodeId', json(async (c) => {
        const node = spaces.updateNode(id(c), id(c, 'nodeId'), await c.req.json());
        return node ? c.json(node) : c.notFound();
    }));

    // The deleted card's takes ride on the answer, so the board's undo can put them back (restore below).
    routes.delete('/:id/nodes/:nodeId', json((c) => {
        const node = spaces.findNode(id(c), id(c, 'nodeId'));
        const takes = spaces.deleteNode(id(c), id(c, 'nodeId'));
        cutChanged(id(c), node, 'card_deleted');
        return c.json({ takes });
    }));

    routes.post('/:id/nodes/:nodeId/restore', json(async (c) => {
        const { node, connections, takes } = await c.req.json();
        const restored = spaces.restoreNode(id(c), { ...node, id: id(c, 'nodeId') }, connections, takes);
        cutChanged(id(c), restored, 'card_restored');
        return c.json(restored, 201);
    }));

    routes.post('/:id/connections', json(async (c) => {
        if (!findOr404(c)) return c.notFound();
        const { from_node_id: from, to_node_id: to, to_socket: socket } = await c.req.json();
        return c.json(spaces.connect(id(c), Number(from), Number(to), socket || null), 201);
    }));

    routes.delete('/:id/connections/:connId', json((c) => {
        spaces.disconnect(id(c), id(c, 'connId'));
        return c.body(null, 204);
    }));

    return routes;
}

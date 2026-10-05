// Shared fakes for the Cut dock view tests (cut-dock-view, cut-export-view): the board page render, a fake
// GET /spaces/:id/cut, and a CutDock whose fetches are answered from a list and recorded. No server, no GPU.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createViews } from '../src/server/views.js';

export const root = new URL('../', import.meta.url);
export const read = (path) => readFileSync(new URL(path, root), 'utf8');

// The browser serves src/shared at /shared/; map it the same way so the dock's own modules load in Node.
const shared = new URL('../src/shared/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, n) {
    return n(s.startsWith('/shared/') ? ${JSON.stringify(shared)} + s.slice(8) : s, c);
}`)}`);
export const { default: CutDock } = await import('../public/js/components/cut-dock.js');

export async function renderBoard() {
    const views = createViews({ csrfToken: 'test-token' });
    const board = {
        space: { id: 7, name: 'Last Train Home', canvas_state: { zoom: 1, panX: 0, panY: 0 } },
        nodes: [{ id: 41, type: 'video', label: 's4-flashback', position_x: 0, position_y: 0, settings: {} }],
        connections: [],
    };
    return views.render('pages/spaces/editor', { board, boardJson: JSON.stringify(board), creatableTypes: [] });
}

// A fake GET /spaces/:id/cut: 7 beats, beat 4 never rendered, beat 6 rendering, a 40 s music bed.
export const fakeCut = {
    cut: { revision: 3, items: [], sound: null, settings: { resolution: 1080, fps: 30 } },
    slots: [
        { index: 1, beat_tag: 's1-hook', label: '01 · Hook', node_id: 11, take_id: 101, state: 'ready', seconds: 6, poster_url: '/media/p1.png', media_url: '/media/s/11.mp4' },
        { index: 2, beat_tag: 's2-arrival', label: '02 · Arrival', node_id: 12, take_id: 102, state: 'ready', seconds: 8.2, media_url: '/media/s/12.mp4' },
        { index: 3, beat_tag: 's3-letter', label: '03 · The letter', node_id: 13, take_id: 103, state: 'ready', seconds: 7.5, media_url: '/media/s/13.mp4' },
        { index: 4, beat_tag: 's4-flashback', label: '04 · Flashback', node_id: 14, state: 'missing', reason: 'never_rendered', seconds: null, planned_seconds: 8 },
        { index: 5, beat_tag: 's5-call', label: '05 · The call', node_id: 15, take_id: 105, state: 'ready', seconds: 9.1, media_url: '/media/s/15.mp4' },
        { index: 6, beat_tag: 's6-running', label: '06 · Running', node_id: 16, state: 'rendering', seconds: null, planned_seconds: 6.4 },
        { index: 7, beat_tag: 's7-last', label: '07 · Last train', node_id: 17, take_id: 107, state: 'ready', seconds: 0.5, media_url: '/media/s/17.mp4' },
    ],
    beds: [{ node_id: 20, label: 'music bed', kind: 'music', media_url: '/media/song.mp3', seconds: 40 }],
    clock: { total_ms: 31300 },
};

export const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document = { querySelector: (sel) => (sel.startsWith('meta') ? { content: 'csrf-test' } : null), visibilityState: 'visible' };
globalThis.CSS = { escape: (s) => s };

export const respond = (status, data) => ({ status, ok: status < 400, json: async () => data });
export const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A CutDock with the board's bits faked and every fetch answered from `replies` (and recorded in `calls`). */
export function fakeDock(t, replies = []) {
    store.clear();
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url, method: options.method ?? 'GET', headers: options.headers ?? {}, body: options.body ? JSON.parse(options.body) : null, keepalive: options.keepalive });
        if ((options.method ?? 'GET') === 'GET') return respond(200, fakeCut);
        return replies.shift() ?? respond(500, { error: 'no reply' });
    };
    const dock = Object.assign(CutDock(), { spaceId: 7, $refs: {}, $nextTick: (fn) => fn?.(), directorOpen: false });
    dock.cutInitHistory();
    dock._cutChanges = 0;
    dock._cutRetries = 0;
    t.after(() => {
        for (const timer of ['_cutSaveTimer', '_cutTimer', '_cutRemovedTimer', '_cutRingTimer']) clearTimeout(dock[timer]);
    });
    return { dock, calls };
}

export const stored = (ids) => ids.map((n) => ({
    id: `i${n}`, node_id: n, take_id: 90 + n, beat_tag: `s${n}`, media_path: `s/${n}.mp4`, seconds_ms: 6000, in_ms: 0, out_ms: 6000,
    sound: true, join: { type: 'cut', ms: 0 }, placed_by: 'director',
}));
export const withItems = (ids, revision = 3) => ({ ...fakeCut, cut: { ...fakeCut.cut, revision, items: stored(ids) } });
export const key = (k, extra = {}) => ({ key: k, code: k === ' ' ? 'Space' : k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: { closest: () => null }, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });

// Mini Katana P5 follow-ups from P2b (05-irresistible.md §2.7 "Deferred"): a clip taken out on purpose stays out of
// Add new clips and the live cut (a new take counts as new), and the rail's Cancel all shows only for the renders
// Render missing beats queued. Temp SQLite, the dock with fakes; never the GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutFixture } from './cut-fixture.js';
import { CutEdits, leftOutAfter } from '../src/server/cut/cut-edits.js';
import { CutDraft } from '../src/server/cut/cut-draft.js';
import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fakeDock, respond, stored } from './cut-dock-fakes.js';

async function draftFixture(t) {
    const f = await cutFixture('bloop-cut-polish-');
    t.after(() => f.close());
    const edits = new CutEdits({ db: f.db, cuts: f.cuts, events: f.events });
    return { ...f, edits, drafts: new CutDraft({ boardCut: f.boardCut, cuts: f.cuts, edits }) };
}

/** A new take lands on a card (a re-render): its own media path, measured. */
function newTake(f, spaceId, node, ms) {
    const path = `spaces/${spaceId}/card-${node.id}/take-2.mp4`;
    f.jobs.addTake({ nodeId: node.id, mediaPath: path, mime: 'video/mp4', preset: 'wan5b', seed: 2, params: {} });
    const take = f.cuts.takeFor(node.id, path);
    f.cuts.setTakeDuration(take.id, ms);
    f.spaces.setNodeResult(node.id, { status: 'done', media_path: path, media_mime: 'video/mp4' });
    return f.cuts.takeFor(node.id, path);
}

test('a clip the person took out stays out of Add new clips; its new take is new; putting it back clears it', async (t) => {
    const f = await draftFixture(t);
    const { space, clips } = f.board('left out', ['s1', 's2', 's3']);
    f.drafts.draft(space.id, { mode: 'fill' });
    const filled = f.cuts.current(space.id);
    // The person removes beat 2 on purpose.
    const res = await f.send('PUT', `/spaces/${space.id}/cut`, { revision: filled.revision, items: [filled.items[0], filled.items[2]] });
    assert.equal(res.status, 200);
    const mine = f.cuts.current(space.id);
    assert.deepEqual(mine.settings.left_out, [{ node_id: clips.s2.node.id, take_id: clips.s2.take.id }]);

    const again = f.drafts.draft(space.id, { mode: 'add_new' });
    assert.deepEqual([again.drafted, again.reason], [false, 'nothing_new'], 'Add new clips does not put it back');
    // The live cut (by 'auto') does not either, and never adds to the list.
    assert.equal(f.drafts.draft(space.id, { mode: 'add_new', by: 'auto' }).reason, 'nothing_new');

    // A re-render lands a new take: that is a new clip.
    const take2 = newTake(f, space.id, clips.s2.node, 5200);
    const added = f.drafts.draft(space.id, { mode: 'add_new' });
    assert.equal(added.added, 1);
    assert.deepEqual(added.cut.items.map((i) => i.node_id), [clips.s1.node.id, clips.s2.node.id, clips.s3.node.id]);
    assert.equal(added.cut.items[1].take_id, take2.id);
    assert.equal(added.cut.settings.left_out, undefined, 'back in the cut: off the list');
});

test('left_out: drafts and the live cut never add to it; a Director removal does; undo puts the clip back', () => {
    const items = stored([1, 2, 3]);
    const cut = { items, settings: {} };
    assert.deepEqual(leftOutAfter(cut, items.slice(1), { by: 'auto', draft: false }), []);
    assert.deepEqual(leftOutAfter(cut, items.slice(1), { by: 'person', draft: true }), []);
    assert.deepEqual(leftOutAfter(cut, items.slice(1), { by: 'director', draft: false }), [{ node_id: 1, take_id: 91 }]);
    const out = { items: items.slice(1), settings: { left_out: [{ node_id: 1, take_id: 91 }] } };
    assert.deepEqual(leftOutAfter(out, items, { by: 'person', draft: false }), [], 'undo of the remove');
    assert.deepEqual(leftOutAfter(out, items.slice(1), { by: 'person', draft: false }), [{ node_id: 1, take_id: 91 }], 'kept, never doubled');
});

test('the dock: Add new clips skips a clip removed on purpose, saved or not yet saved', (t) => {
    const { dock } = fakeDock(t);
    dock.cutReceive({ revision: 1, items: stored([11, 12]), sound: null, auto: false });
    dock.cutSetBase({ items: stored([11, 12]) });
    dock._cutSlots = [{ node_id: 11, take_id: 101, state: 'ready' }, { node_id: 12, take_id: 102, state: 'ready' }, { node_id: 13, take_id: 103, state: 'ready' }];
    dock.cutAuto = false;
    dock.cutStatus = 'ready';
    dock.cutLayout();
    assert.equal(dock.cutNewCount(), 1, 'beat 3 is new');
    // The person removes beat 2: not saved yet, it is still not new.
    dock.cutModel = dock.cutModel.filter((i) => i.node_id !== 12);
    assert.equal(dock.cutNewCount(), 1);
    // Saved: the server's list says so.
    dock.cutAfterSave({ items: dock.cutModel, sound: null, settings: { left_out: [{ node_id: 12, take_id: 102 }] } });
    assert.equal(dock.cutNewCount(), 1);
    // A new take of beat 2 counts as new.
    dock._cutSlots[1] = { ...dock._cutSlots[1], take_id: 202 };
    assert.equal(dock.cutNewCount(), 2);
});

test('the rail: Cancel all shows only while renders Render missing beats queued are on the board', (t) => {
    const { dock } = fakeDock(t);
    dock.renderQueue = [{ id: 1, nodeId: 5, spaceId: 7, status: 'running', origin: null }, { id: 2, nodeId: 6, spaceId: 8, status: 'queued', origin: 'render-plan' }];
    assert.equal(dock.cutPlanRenders(), 0, 'a Generate press here, a plan render on another board');
    dock.renderQueue.push({ id: 3, nodeId: 9, spaceId: 7, status: 'queued', origin: 'render-plan' });
    assert.equal(dock.cutPlanRenders(), 1);
});

/** A fake server for Bring my clips: nodes get ids from 50, `failName`'s upload fails, every write is recorded. */
function bringServer(dock, { failName = null, beds = [] } = {}) {
    const calls = [];
    let next = 50;
    globalThis.fetch = async (url, options = {}) => {
        const method = options.method ?? 'GET';
        calls.push({ url, method, body: options.body });
        if (method === 'GET') return respond(200, { cut: { revision: 1, items: [{ id: 'x', node_id: 50, take_id: 1, in_ms: 0, out_ms: 4500, seconds_ms: 4500 }], sound: null, settings: {} }, slots: [], beds });
        if (url.endsWith('/nodes') && method === 'POST') return respond(201, { id: next++, ...JSON.parse(options.body) });
        if (url.endsWith('/upload')) {
            const name = decodeURIComponent(options.headers['X-File-Name']);
            return name === failName ? respond(507, { error: 'The disk is full.' }) : respond(200, { media_path: `m/${name}`, media_mime: options.headers['Content-Type'], label: name });
        }
        if (method === 'PATCH' || method === 'DELETE') return respond(200, {});
        if (url.endsWith('/cut/draft')) return respond(200, { drafted: true, cut: { revision: 2, items: [{ id: 'x', node_id: 50, take_id: 1, in_ms: 0, out_ms: 4500, seconds_ms: 4500 }], sound: null } });
        if (method === 'PUT') return respond(200, { cut: { revision: 3, items: JSON.parse(options.body).items, sound: JSON.parse(options.body).sound, settings: {} } });
        return respond(500, {});
    };
    const toasts = [];
    const pushed = [];
    Object.assign(dock, { nodes: [], base: '/spaces/7', toast: (m) => toasts.push(m), history: { push: (cmd) => pushed.push(cmd) },
        removeCard: async (id) => { dock.nodes = dock.nodes.filter((n) => n.id !== id); return { id, takes: [] }; },
        restoreCard: async (card) => { dock.nodes.push(card); return card; } });
    return { calls, toasts, pushed };
}
const file = (name, type) => new File([new Uint8Array(4)], name, { type });

test('Bring my clips: a failed copy takes its empty card off the board; the rest is one board undo step', async (t) => {
    const { dock } = fakeDock(t);
    const { calls, toasts, pushed } = bringServer(dock, { failName: 'bad.mp4' });
    await dock.cutBring([file('a.mp4', 'video/mp4'), file('bad.mp4', 'video/mp4'), file('c.mp4', 'video/mp4')]);
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.url === '/spaces/7/nodes/51'), 'the failed card is deleted');
    assert.deepEqual(dock.nodes.map((n) => n.id), [50, 52], 'no empty Upload card is left');
    assert.ok(toasts.includes('bad.mp4 did not copy, so its empty card was taken off the board. The disk is full.'), toasts.join(' / '));
    assert.equal(pushed.length, 1, 'one undo step for the whole bring');
    assert.equal(pushed[0].label, 'Bring 2 files');
    await pushed[0].undo();
    assert.deepEqual(dock.nodes, []);
    await pushed[0].redo();
    assert.deepEqual(dock.nodes.map((n) => n.id), [50, 52]);
});

test('Bring my clips: two songs, none is guessed; the dock says so and the pick becomes the bed in one undo step', async (t) => {
    const { dock } = fakeDock(t);
    const beds = [];
    const { calls } = bringServer(dock, { beds });
    await dock.cutBring([file('a.mp4', 'video/mp4'), file('one.mp3', 'audio/mpeg'), file('two.mp3', 'audio/mpeg')]);
    assert.ok(!calls.some((c) => c.method === 'PATCH'), 'no song is labelled music bed by a guess');
    assert.deepEqual(dock.cutBringSongs, [{ node_id: 51, name: 'one.mp3' }, { node_id: 52, name: 'two.mp3' }]);
    assert.equal(dock.cutAnnounce, 'You brought 2 songs. Pick the one that goes under the clips.');

    beds.push({ node_id: 52, take_id: 9, label: 'music bed', kind: 'music', media_url: '/media/m/two.mp3', seconds: 30 });
    await dock.cutBringPickSong(dock.cutBringSongs[1]);
    assert.deepEqual(JSON.parse(calls.find((c) => c.method === 'PATCH').body), { label: 'music bed' });
    assert.equal(dock.cutSound.music.node_id, 52);
    assert.equal(dock.cutSound.music.gain_db, -12);
    assert.equal(dock._cutHistory.nextUndoLabel(), 'two.mp3 is under the clips');
    assert.deepEqual(dock.cutBringSongs, []);

    dock.cutBringSongs = [{ node_id: 51, name: 'one.mp3' }];
    await dock.cutBringPickSong(null);
    assert.match(dock.cutAnnounce, /^No song under the clips/);
});

test('every :style binding in the views gives Alpine an object (a string or null is an inline style the CSP blocks)', () => {
    const views = new URL('../src/server/views/', import.meta.url);
    const bad = [];
    for (const name of readdirSync(views, { recursive: true })) {
        if (!String(name).endsWith('.edge')) continue;
        const text = readFileSync(new URL(String(name).split(sep).join('/'), views), 'utf8');
        for (const [, expr] of text.matchAll(/(?:^|\s)(?::style|x-bind:style)="([^"]*)"/g)) {
            // `a && {…}` gives null or false when a is falsy; a ternary needs an object on both sides.
            const guarded = /^[^?]*&&/.test(expr) && !expr.includes('?');
            if (guarded || /^\s*['`]/.test(expr) || /\?[^:]*:\s*(null|''|false|undefined)\s*$/.test(expr)) bad.push(`${name}: ${expr.slice(0, 60)}`);
        }
        assert.doesNotMatch(text, /\sstyle="/, `${name} has an inline style attribute`);
    }
    assert.deepEqual(bad, []);
});

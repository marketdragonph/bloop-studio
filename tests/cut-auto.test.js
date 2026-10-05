// The live cut (05-irresistible.md §2.1, P2b): on a planned board the cut fills itself as clips land, in beat order,
// at their measured length, and stops for good after the person's first edit. Auto placements are stamped 'auto',
// and the dock rebases over them silently (no "changed in another window" banner). Temp SQLite, fake measurer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutFixture } from './cut-fixture.js';
import { CutEdits } from '../src/server/cut/cut-edits.js';
import { CutDraft, DRAFT_NOTE } from '../src/server/cut/cut-draft.js';
import { LiveCut } from '../src/server/cut/live-cut.js';
import { rebaseAuto } from '../src/shared/cut-rebase.js';
import { fakeDock, flush, respond, stored } from './cut-dock-fakes.js';

const quiet = { warn: () => {} };

async function liveFixture(t) {
    const f = await cutFixture('bloop-cut-auto-');
    t.after(() => f.close());
    const edits = new CutEdits({ db: f.db, cuts: f.cuts, events: f.events });
    const drafts = new CutDraft({ boardCut: f.boardCut, cuts: f.cuts, edits });
    let release = () => {};
    const measurer = { settled: () => new Promise((resolve) => { release = resolve; }) };
    const live = new LiveCut({ events: f.events, cuts: f.cuts, drafts, plans: f.plans, spaces: f.spaces, measurer, log: quiet }).start();
    t.after(() => live.stop());
    /** A card finished rendering: the worker's `node` done event, then the measurer settles. */
    const land = async (spaceId, nodeId) => {
        const sent = await f.listen(async () => {
            f.events.node({ spaceId, nodeId, status: 'done' });
            await flush();
            release();
            await live.queues.get(spaceId);
        });
        return sent;
    };
    return { ...f, edits, drafts, live, land };
}

test('a clip that lands on a planned board drops into its beat slot by itself, at its measured length, as auto', async (t) => {
    const f = await liveFixture(t);
    const { space } = f.board('night', ['s1-open', 's2-turn', 's3-close'], [], { music: false });
    const turn = f.clip(space.id, 's2-turn', 4200);

    const sent = await f.land(space.id, turn.node.id);
    const cut = f.cuts.current(space.id);
    assert.equal(cut.items.length, 1);
    const [item] = cut.items;
    assert.equal(item.node_id, turn.node.id);
    assert.equal(item.placed_by, 'auto');
    assert.equal(item.note, DRAFT_NOTE, 'noted "Placed in beat order"');
    assert.equal(item.out_ms, 4200, 'the measured length, not the asked one');
    assert.equal(cut.updated_by, 'auto');
    assert.equal(cut.auto, true, 'an auto placement never turns the live cut off');
    assert.equal(cut.previous_items, null, 'the live cut is not a draft to undo');
    assert.deepEqual(sent.map((e) => [e.by, e.added]), [['auto', [turn.node.id]]]);

    // An earlier beat lands later: it goes BEFORE beat 2; beat 2's item is untouched.
    const open = f.clip(space.id, 's1-open', 3000);
    await f.land(space.id, open.node.id);
    const after = f.cuts.current(space.id);
    assert.deepEqual(after.items.map((i) => i.node_id), [open.node.id, turn.node.id]);
    assert.deepEqual(after.items[1], item);
});

test('a music bed that lands after the clips goes under the cut; nothing else moves', async (t) => {
    const f = await liveFixture(t);
    const { space, clips } = f.board('bed', ['s1-open', 's2-turn'], ['s1-open', 's2-turn'], { music: false });
    await f.land(space.id, clips['s1-open'].node.id);
    const before = f.cuts.current(space.id);
    assert.equal(before.items.length, 2, 'the first placement fills every ready beat');
    assert.equal(before.sound, null);

    const bed = f.clip(space.id, 'music bed', 30_000, { type: 'audio', mime: 'audio/mpeg' });
    await f.land(space.id, bed.node.id);
    const after = f.cuts.current(space.id);
    assert.equal(after.sound.music.node_id, bed.node.id);
    assert.deepEqual(after.items, before.items);
});

test('the person\'s first edit turns the live cut off for good; later clips wait for Add new clips', async (t) => {
    const f = await liveFixture(t);
    const { space, clips } = f.board('edit', ['s1-open', 's2-turn', 's3-close'], ['s1-open'], { music: false });
    await f.land(space.id, clips['s1-open'].node.id);
    const placed = f.cuts.current(space.id);
    const trimmed = placed.items.map((i) => ({ ...i, out_ms: i.out_ms - 500 }));
    const res = await f.send('PUT', `/spaces/${space.id}/cut`, { revision: placed.revision, items: trimmed });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).cut.auto, false);

    const turn = f.clip(space.id, 's2-turn', 4000);
    const sent = await f.land(space.id, turn.node.id);
    assert.equal(sent.length, 0, 'no placement, no event');
    assert.deepEqual(f.cuts.current(space.id).items.map((i) => i.node_id), [clips['s1-open'].node.id]);

    // The person's press on Add new clips adds it after their items, which keep every field.
    const add = await f.send('POST', `/spaces/${space.id}/cut/draft`, { mode: 'add_new', revision: f.cuts.revision(space.id) });
    const body = await add.json();
    assert.equal(body.added, 1);
    assert.equal(body.cut.items[0].out_ms, trimmed[0].out_ms);
    assert.equal(body.cut.items[1].placed_by, 'director');
});

test('never on a board without a plan, never for a card that is not a clip or a sound', async (t) => {
    const f = await liveFixture(t);
    const space = f.spaces.create({ name: 'loose' });
    const loose = f.clip(space.id, 'my clip', 3000);
    assert.equal((await f.land(space.id, loose.node.id)).length, 0);
    assert.equal(f.cuts.find(space.id), null, 'no cut row was written');
    const { space: planned } = f.board('planned', ['s1-open'], [], { music: false });
    const still = f.spaces.createNode(planned.id, { type: 'image', label: 's1-open still' });
    assert.equal(await f.live.landed(planned.id, still.id), null);
});

test('CutEdits stamps a draft saved by auto as placed_by auto, and stores updated_by auto (migration 008)', async (t) => {
    const f = await liveFixture(t);
    const { space } = f.board('stamp', ['s1-open'], ['s1-open'], { music: false });
    const result = f.drafts.draft(space.id, { mode: 'fill', by: 'auto' });
    assert.equal(result.cut.items[0].placed_by, 'auto');
    const row = f.db.prepare('SELECT updated_by, auto FROM space_cuts WHERE space_id = ?').get(space.id);
    assert.deepEqual({ ...row }, { updated_by: 'auto', auto: 1 });
    assert.throws(() => f.db.prepare("UPDATE space_cuts SET updated_by = 'robot'").run(), /CHECK/);
});

// ── The silent rebase (src/shared/cut-rebase.js) ──

const item = (id, extra = {}) => ({ id, node_id: Number(id.slice(1)), take_id: 1, in_ms: 0, out_ms: 4000, sound: true, join: { type: 'cut' }, ...extra });

test('rebaseAuto keeps the person\'s edit and adds only clips the live cut placed, in their beat place', () => {
    const base = { items: [item('i1'), item('i3')], sound: null };
    const local = { items: [item('i3'), item('i1', { out_ms: 2500 })], sound: null }; // reordered and trimmed
    const server = { items: [item('i1'), item('i2', { placed_by: 'auto' }), item('i3'), item('i4', { placed_by: 'auto' })], sound: null };
    const merged = rebaseAuto(base, local, server);
    assert.deepEqual(merged.items.map((i) => i.id), ['i3', 'i4', 'i1', 'i2']);
    assert.equal(merged.items.find((i) => i.id === 'i1').out_ms, 2500);

    assert.equal(rebaseAuto(base, local, { ...server, items: [...base.items, item('i9', { placed_by: 'director' })] }), null, 'the Director is not the live cut');
    assert.equal(rebaseAuto(base, local, { items: [item('i1', { out_ms: 1000 }), item('i3'), item('i5', { placed_by: 'auto' })], sound: null }), null, 'someone else edited a clip');
    assert.equal(rebaseAuto(base, local, { items: base.items, sound: null }), null, 'nothing new');
    const bed = { node_id: 9, take_id: 2, gain_db: -12, fade_out_ms: 1500 };
    assert.deepEqual(rebaseAuto(base, local, { items: base.items, sound: { music: bed } }).sound, { music: bed }, 'the bed the live cut added');
});

test('the dock: a 409 that only adds auto clips is rebased silently and saved again; then the live cut is off', async (t) => {
    const serverCopy = { revision: 6, items: [...stored([11]), { ...stored([12])[0], placed_by: 'auto' }], sound: null, settings: {}, auto: true, updated_by: 'auto' };
    const { dock, calls } = fakeDock(t, [
        respond(409, { error: 'This cut changed in another window.', cut: serverCopy }),
        respond(200, { cut: { ...serverCopy, revision: 7, auto: false, updated_by: 'person' } }),
    ]);
    dock.cutReceive({ revision: 5, items: stored([11]), sound: null, auto: true });
    assert.equal(dock.cutAuto, true);
    dock.cutCommit('Trim out', { items: stored([11]).map((i) => ({ ...i, out_ms: 3000 })) });
    await dock.cutSaveNow();
    assert.equal(dock.cutBanner, null, 'no banner for the live cut');
    assert.equal(dock.cutRevision, 6);
    assert.deepEqual(dock.cutModel.map((i) => [i.node_id, i.out_ms]), [[11, 3000], [12, 6000]]);
    await dock.cutSaveNow();
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 2);
    assert.equal(puts[1].body.revision, 6);
    assert.deepEqual(puts[1].body.items.map((i) => i.node_id), [11, 12]);
    assert.equal(dock.cutAuto, false);
    assert.equal(dock.cutAnnounce, 'You edited the cut. New clips now wait for you.');
});

test('the dock: a clean dock adopts an auto placement quietly; Add new clips shows once auto is off', async (t) => {
    const { dock } = fakeDock(t);
    dock.cutReceive({ revision: 1, items: [], sound: null, auto: true });
    dock.cutReceive({ revision: 2, items: [{ ...stored([11])[0], placed_by: 'auto' }], sound: null, auto: true }, { by: 'auto' });
    assert.equal(dock.cutBanner, null);
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [11]);
    assert.equal(dock._cutHistory.nextUndoLabel(), 'Placed in beat order');

    dock._cutSlots = [{ node_id: 11, state: 'ready' }, { node_id: 12, state: 'ready' }];
    dock.cutStatus = 'ready';
    dock.cutLayout();
    assert.equal(dock.cutCanAddNew(), false, 'the live cut adds it by itself');
    dock.cutAuto = false;
    assert.equal(dock.cutCanAddNew(), true);
    assert.equal(dock.cutAddNewText(), 'Add new clips · 1');
});

// CutDraft (03-director.md §2): fill only an empty cut, add_new never moves/trims/removes, replace keeps the one-step
// Undo draft, zero clips writes nothing. The dock's POST /spaces/:id/cut/draft and the service (the Director's
// stitch_cut in P4) build the same draft. Nothing renders: no ComfyUI here at all, and missing beats are only named.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cutFixture } from './cut-fixture.js';
import { CutEdits } from '../src/server/cut/cut-edits.js';
import { CutDraft, DRAFT_NOTE } from '../src/server/cut/cut-draft.js';
import { CutConflictError } from '../src/server/repositories/cuts.js';
import { CutInvalidError } from '../src/server/cut/validate-cut.js';

let f;
let drafts;
before(async () => {
    f = await cutFixture('bloop-cut-draft-');
    drafts = new CutDraft({ boardCut: f.boardCut, cuts: f.cuts, edits: new CutEdits({ db: f.db, cuts: f.cuts, events: f.events }) });
});
after(() => f.close());

const post = (spaceId, payload) => f.send('POST', `/spaces/${spaceId}/cut/draft`, payload);
const shape = (items) => items.map(({ id, ...rest }) => rest);

test('fill builds the cut in beat order into an empty cut, names the missing beats, and sets the music bed', async () => {
    const { space, clips, bed } = f.board('fill', ['s1', 's2', 's3'], ['s1', 's3']);
    let body;
    const sent = await f.listen(async () => {
        const res = await post(space.id, { mode: 'fill', revision: 0 });
        assert.equal(res.status, 200);
        body = await res.json();
    });
    assert.deepEqual([body.drafted, body.added, body.missing, body.offer], [true, 2, ['s2'], null]);
    const { cut } = body;
    assert.equal(cut.revision, 1);
    assert.deepEqual(cut.items.map((i) => [i.node_id, i.in_ms, i.out_ms, i.placed_by, i.note]), [
        [clips.s1.node.id, 0, 3000, 'director', DRAFT_NOTE],
        [clips.s3.node.id, 0, 4000, 'director', DRAFT_NOTE],
    ]);
    assert.equal(cut.items[0].media_path, clips.s1.take.media_path);
    assert.equal(cut.items[0].take_id, clips.s1.take.id);
    assert.deepEqual(cut.sound.music, { node_id: bed.node.id, take_id: bed.take.id, media_path: bed.take.media_path, gain_db: -12, fade_out_ms: 1500 });
    assert.equal(cut.settings.aspect, '16:9');
    assert.equal(cut.can_undo_draft, true);
    assert.equal(cut.auto, true, 'a draft leaves the live cut on');
    assert.deepEqual(sent.map((u) => [u.revision, u.by, u.added, u.missing, u.offer]), [[1, 'person', [clips.s1.node.id, clips.s3.node.id], ['s2'], null]]);
});

test('fill only writes into an empty cut: a cut with clips is left alone and a replace is offered', async () => {
    const { space, clips } = f.board('fill twice', ['s1', 's2']);
    await post(space.id, { mode: 'fill' });
    const mine = f.cuts.current(space.id);
    await f.send('PUT', `/spaces/${space.id}/cut`, { revision: mine.revision, items: [{ ...mine.items[1], out_ms: 1500 }] });
    const before = f.cuts.current(space.id);

    let body;
    const sent = await f.listen(async () => {
        body = await (await post(space.id, { mode: 'fill' })).json();
    });
    assert.deepEqual([body.drafted, body.reason, body.offer], [false, 'not_empty', 'replace']);
    const after = f.cuts.current(space.id);
    assert.equal(after.revision, before.revision, 'nothing was written');
    assert.deepEqual(after.items, before.items);
    assert.deepEqual(sent.map((u) => [u.revision, u.offer, u.added]), [[before.revision, 'replace', []]]);
    assert.ok(clips.s2);
});

test('add_new never moves, trims or removes the items already there; new beats go in at their beat', async () => {
    const { space, clips } = f.board('add new', ['s1', 's2', 's3', 's4'], ['s2', 's4']);
    await post(space.id, { mode: 'fill' });
    const filled = f.cuts.current(space.id);
    // The person trims s4, turns its sound off, and puts it first.
    const [s2, s4] = filled.items;
    await f.send('PUT', `/spaces/${space.id}/cut`, {
        revision: filled.revision,
        items: [{ ...s4, in_ms: 500, out_ms: 2000, sound: false }, { ...s2, join: { type: 'dissolve', ms: 400 } }],
    });
    const mine = f.cuts.current(space.id);

    const s1 = f.clip(space.id, 's1', 2500);
    const s3 = f.clip(space.id, 's3', 3500);
    const body = await (await post(space.id, { mode: 'add_new', revision: mine.revision })).json();
    assert.deepEqual([body.drafted, body.added, body.missing], [true, 2, []]);
    const items = body.cut.items;

    const kept = items.filter((i) => mine.items.some((m) => m.id === i.id));
    assert.deepEqual(kept, mine.items, 'every field of every existing item is as it was, in the same order');
    assert.deepEqual(items.map((i) => i.node_id), [s1.node.id, clips.s4.node.id, clips.s2.node.id, s3.node.id]);
    assert.deepEqual(items.filter((i) => i.placed_by === 'director' && i.person_rev == null && i.note === DRAFT_NOTE).map((i) => i.node_id), [s1.node.id, s3.node.id]);

    // Nothing new: no write.
    const again = await (await post(space.id, { mode: 'add_new' })).json();
    assert.deepEqual([again.drafted, again.reason, again.cut.revision], [false, 'nothing_new', body.cut.revision]);
});

test('replace makes a fresh draft and keeps the old items as the one-step Undo draft', async () => {
    const { space } = f.board('replace', ['s1', 's2']);
    await post(space.id, { mode: 'fill' });
    const filled = f.cuts.current(space.id);
    await f.send('PUT', `/spaces/${space.id}/cut`, { revision: filled.revision, items: [{ ...filled.items[1], out_ms: 1000 }] });
    const mine = f.cuts.current(space.id);

    const body = await (await post(space.id, { mode: 'replace', revision: mine.revision })).json();
    assert.equal(body.drafted, true);
    assert.equal(body.cut.items.length, 2);
    assert.equal(body.cut.can_undo_draft, true);
    assert.deepEqual(f.cuts.current(space.id).previous_items, mine.items);

    // Undo draft: the person's cut comes back with its stamps, once.
    const undo = await f.send('DELETE', `/spaces/${space.id}/cut/draft`, { revision: body.cut.revision });
    assert.equal(undo.status, 200);
    const { cut } = await undo.json();
    assert.deepEqual(cut.items, mine.items);
    assert.equal(cut.can_undo_draft, false);
    const twice = await f.send('DELETE', `/spaces/${space.id}/cut/draft`, { revision: cut.revision });
    assert.equal(twice.status, 422);
    assert.match((await twice.json()).error, /no draft to undo/);
});

test('zero playable clips: no write and no event', async () => {
    const { space } = f.board('nothing yet', ['s1', 's2'], [], { music: true });
    let body;
    const sent = await f.listen(async () => {
        body = await (await post(space.id, { mode: 'fill' })).json();
    });
    assert.deepEqual([body.drafted, body.reason, body.missing], [false, 'no_clips', ['s1', 's2']]);
    assert.equal(sent.length, 0);
    assert.equal(f.cuts.find(space.id), null);
});

test('the dock\'s Fill and the service build the same draft', async () => {
    const one = f.board('dock fill', ['s1', 's2', 's3']);
    const two = f.board('service fill', ['s1', 's2', 's3']);
    const dock = (await (await post(one.space.id, { mode: 'fill' })).json()).cut.items;
    const service = drafts.draft(two.space.id, { mode: 'fill', by: 'director' }).cut.items;
    const local = (items, { clips }) => shape(items).map((i) => ({ ...i, node_id: Object.keys(clips).find((t) => clips[t].node.id === i.node_id), take_id: null, media_path: null }));
    assert.deepEqual(local(dock, one), local(service, two));
    assert.equal(f.cuts.current(two.space.id).updated_by, 'director');
});

test('a draft on a stale revision is a 409 with the server copy; an unknown mode is a 422; CSRF guards it', async () => {
    const { space } = f.board('stale draft', ['s1']);
    await post(space.id, { mode: 'fill' });
    const stale = await post(space.id, { mode: 'add_new', revision: 0 });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).cut.revision, 1);
    assert.throws(() => drafts.draft(space.id, { mode: 'add_new', revision: 0 }), CutConflictError);
    assert.equal((await post(space.id, { mode: 'export' })).status, 422);
    assert.throws(() => drafts.draft(space.id, { mode: 'render' }), CutInvalidError);
    assert.equal((await f.send('POST', `/spaces/${space.id}/cut/draft`, { mode: 'fill' }, { token: null })).status, 403);
});

test('a draft stops at the 50-clip cap and says so', async () => {
    const tags = Array.from({ length: 52 }, (_, i) => `s${i + 1}`);
    const space = f.spaces.create({ name: 'many' });
    const plan = f.plans.create(space.id, {});
    f.plans.saveBeats(plan.id, tags.map((tag, i) => ({ tag, lane: i + 1, brief: 'b' })));
    for (const tag of tags) f.clip(space.id, tag, 2000);
    const result = drafts.draft(space.id, { mode: 'fill' });
    assert.deepEqual([result.drafted, result.added, result.capped], [true, 50, true]);
    assert.equal(result.cut.items.at(-1).beat_tag, 's50');
});

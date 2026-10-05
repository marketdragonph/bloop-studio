// PUT /spaces/:id/cut: the whole cut saved with its revision through CutEdits (01-core.md §2–§3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cutFixture } from './cut-fixture.js';
import { CUT_LIMITS, MUSIC_LEVEL, checkItems, clampLevel, levelText } from '../src/shared/cut-rules.js';

let f;
before(async () => {
    f = await cutFixture('bloop-cut-save-');
});
after(() => f.close());

const item = (id, { node, take }, fields = {}) => ({
    id, node_id: node.id, take_id: take.id, beat_tag: node.label, seconds_ms: take.duration_ms ?? 4000,
    in_ms: 0, out_ms: take.duration_ms ?? 4000, sound: true, join: { type: 'cut' }, ...fields,
});
const put = (spaceId, payload, options) => f.send('PUT', `/spaces/${spaceId}/cut`, payload, options);

test('PUT needs the CSRF header', async () => {
    const { space, clips } = f.board('csrf', ['s1']);
    const res = await put(space.id, { revision: 0, items: [item('a', clips.s1)] }, { token: null });
    assert.equal(res.status, 403);
    assert.equal(f.cuts.find(space.id), null);
});

test('a save bumps the revision, takes media paths and lengths from the take, stamps the person, and sends one cut event', async () => {
    const { space, clips } = f.board('save', ['s1', 's2']);
    let res;
    const sent = await f.listen(async () => {
        res = await put(space.id, {
            revision: 0,
            items: [item('a', clips.s1, { media_path: '../../etc/passwd', seconds_ms: 99_000, note: 'mine' }), item('b', clips.s2, { out_ms: 2500 })],
        });
    });
    assert.equal(res.status, 200);
    const { cut } = await res.json();
    assert.equal(cut.revision, 1);
    assert.equal(cut.can_undo_draft, false);
    assert.equal(cut.auto, false, 'a hand edit turns the live cut off');
    const [a, b] = cut.items;
    assert.equal(a.media_path, clips.s1.take.media_path, 'the page never sets a media path');
    assert.equal(a.seconds_ms, 3000, 'the measured length wins over the page');
    assert.deepEqual([a.placed_by, a.person_rev, a.note], ['person', 1, undefined]);
    assert.equal(b.out_ms, 2500);
    assert.deepEqual(sent, [{ spaceId: space.id, revision: 1, by: 'person', added: [clips.s1.node.id, clips.s2.node.id], missing: [], changed: [], turn: null, offer: null }]);
});

test('a stale save is a 409 with the server copy; the save after it, on the server revision, succeeds', async () => {
    const { space, clips } = f.board('conflict', ['s1', 's2']);
    assert.equal((await put(space.id, { revision: 0, items: [item('a', clips.s1)] })).status, 200);

    // Another window still holds revision 0.
    const stale = await put(space.id, { revision: 0, items: [item('b', clips.s2)] });
    assert.equal(stale.status, 409);
    const conflict = await stale.json();
    assert.match(conflict.error, /changed in another window/);
    assert.equal(conflict.cut.revision, 1);
    assert.deepEqual(conflict.cut.items.map((i) => i.id), ['a']);
    assert.equal(f.cuts.current(space.id).revision, 1, 'the stale save wrote nothing');

    // "Keep mine": the dock adopts the server revision in the same step and saves on top. No 409 loop.
    const mine = await put(space.id, { revision: conflict.cut.revision, items: [item('b', clips.s2)] });
    assert.equal(mine.status, 200);
    const { cut } = await mine.json();
    assert.equal(cut.revision, 2);
    assert.deepEqual(cut.items.map((i) => i.id), ['b']);
});

test('the rules refuse in plain words and write nothing', async () => {
    const { space, clips } = f.board('rules', ['s1', 's2']);
    const other = f.board('other board', ['x1']);
    const words = f.spaces.createNode(space.id, { type: 'note', label: 'words' });
    const refuse = async (payload, pattern) => {
        const res = await put(space.id, { revision: 0, ...payload });
        assert.equal(res.status, 422, JSON.stringify(payload).slice(0, 120));
        assert.match((await res.json()).error, pattern);
    };
    await refuse({ items: [item('a', other.clips.x1)] }, /another board/);
    await refuse({ items: [{ ...item('a', clips.s1), node_id: words.id }] }, /not a video card/);
    await refuse({ items: [{ ...item('a', clips.s1), take_id: clips.s2.take.id }] }, /take is not from its card/);
    await refuse({ items: [{ ...item('a', clips.s1), node_id: 999_999 }] }, /not on this board/);
    await refuse({ items: [item('a', clips.s1, { out_ms: 3051 })] }, /runs past the end/);
    await refuse({ items: [item('a', clips.s1, { in_ms: 2000, out_ms: 2000 })] }, /ends before it starts/);
    await refuse({ items: [item('a', clips.s1, { in_ms: -1 })] }, /starts before/);
    await refuse({ items: [item('a', clips.s1), item('a', clips.s2)] }, /twice/);
    await refuse({ items: [item('a', clips.s1), item('b', clips.s2, { join: { type: 'dissolve', ms: 100 } })] }, /250 to 1000 ms/);
    await refuse({ items: [item('a', clips.s1), item('b', clips.s2, { join: { type: 'wipe' } })] }, /cut or a dissolve/);
    await refuse({ items: [item('a', clips.s1), item('b', clips.s2, { join: { type: 'dissolve', audio_ms: -300 } })] }, /never on a dissolve/);
    await refuse({ items: Array.from({ length: 51 }, (_, i) => item(`i${i}`, clips.s1)) }, /at most 50 clips/);
    await refuse({ items: [item('a', clips.s1)], settings: { resolution: 2160 } }, /720p or 1080p/);
    assert.equal(f.cuts.find(space.id), null);

    // Within the 50 ms slack and inside the dissolve limits is fine.
    const ok = await put(space.id, { revision: 0, items: [item('a', clips.s1, { out_ms: 3050 }), item('b', clips.s2, { join: { type: 'dissolve' } })] });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).cut.items[1].join, { type: 'dissolve', ms: 500 });
});

test('the cut is at most 10 minutes, by the one clock', async () => {
    const space = f.spaces.create({ name: 'long' });
    const long = f.clip(space.id, 'long', 400_000);
    const res = await put(space.id, { revision: 0, items: [item('a', long), item('b', long)] });
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /13:20\. The limit is 10:00/);
});

test('bad bodies: unreadable JSON is a 400, a missing revision a 422, a space that is gone a 404', async () => {
    const { space } = f.board('bodies', ['s1']);
    assert.equal((await put(space.id, '{not json')).status, 400);
    assert.equal((await put(space.id, { items: [] })).status, 422);
    assert.equal((await put(9_999_999, { revision: 0, items: [] })).status, 404);
});

test('a deleted card stays in the cut as its snapshot; a save that keeps it still works', async () => {
    const { space, clips } = f.board('deleted', ['s1', 's2']);
    await put(space.id, { revision: 0, items: [item('a', clips.s1), item('b', clips.s2)] });
    f.spaces.deleteNode(space.id, clips.s1.node.id);
    const res = await put(space.id, { revision: 1, items: [item('a', clips.s1, { media_path: 'elsewhere.mp4' }), item('b', clips.s2, { out_ms: 2000 })] });
    assert.equal(res.status, 200);
    const [a] = (await res.json()).cut.items;
    assert.equal(a.media_path, clips.s1.take.media_path, 'the stored snapshot, not the page');

    // A card that was never in the cut and is gone from the board is refused.
    const fresh = f.clip(space.id, 'spare');
    f.spaces.deleteNode(space.id, fresh.node.id);
    assert.equal((await put(space.id, { revision: 2, items: [item('c', fresh)] })).status, 422);
});

test('the edit lock: a changed clip becomes the person\'s and loses its note; an untouched one keeps its stamps when reordered', async () => {
    const { space, clips } = f.board('lock', ['s1', 's2']);
    const draft = await f.send('POST', `/spaces/${space.id}/cut/draft`, { mode: 'fill' });
    const { cut } = await draft.json();
    const [a, b] = cut.items;
    assert.deepEqual([a.placed_by, a.person_rev, a.note], ['director', null, 'Placed in beat order']);

    const res = await put(space.id, { revision: cut.revision, items: [{ ...b }, { ...a, out_ms: 2000 }] });
    const saved = (await res.json()).cut;
    const byId = Object.fromEntries(saved.items.map((i) => [i.id, i]));
    assert.deepEqual([byId[b.id].placed_by, byId[b.id].person_rev, byId[b.id].note], ['director', null, 'Placed in beat order']);
    assert.deepEqual([byId[a.id].placed_by, byId[a.id].person_rev, byId[a.id].note], ['director', saved.revision, undefined]);
    assert.equal(saved.can_undo_draft, false, 'a hand edit after a draft ends the one-step Undo draft');
    assert.ok(clips.s1);
});

test('music level and duck settings live in sound; omitting sound keeps it', async () => {
    const { space, clips, bed } = f.board('sound', ['s1']);
    const items = [item('a', clips.s1)];
    const save = (revision, sound) => put(space.id, { revision, items, ...(sound === undefined ? {} : { sound }) });

    const res = await save(0, { music: { node_id: bed.node.id, take_id: bed.take.id, gain_db: -14, duck: { depth_db: -10 } } });
    assert.equal(res.status, 200);
    const { music } = (await res.json()).cut.sound;
    assert.deepEqual(music, {
        node_id: bed.node.id, take_id: bed.take.id, media_path: bed.take.media_path, gain_db: -14, fade_out_ms: 1500,
        duck: { depth_db: -10, attack_ms: 120, release_ms: 400 },
    });
    assert.equal((await (await save(1)).json()).cut.sound.music.gain_db, -14);

    assert.match((await (await save(2, { music: { node_id: bed.node.id, gain_db: -30 } })).json()).error, /Music level is -24 to \+6 dB/);
    assert.match((await (await save(2, { music: { node_id: bed.node.id, gain_db: 0, duck: { depth_db: -30 } } })).json()).error, /Ducking/);
    assert.match((await (await save(2, { music: { node_id: clips.s1.node.id, gain_db: 0 } })).json()).error, /not a sound card/);
    assert.match((await (await save(2, { drums: {} })).json()).error, /no drums track/);
    const voice = await save(2, { voice: { node_id: bed.node.id, gain_db: 0, start_ms: 1200 } });
    assert.deepEqual((await voice.json()).cut.sound, { voice: { node_id: bed.node.id, take_id: null, media_path: bed.take.media_path, gain_db: 0, start_ms: 1200 } });
    assert.equal((await (await save(3, null)).json()).cut.sound, null);
});

test('the shared rules: level text and clamp, J and L cuts need sound to borrow', () => {
    assert.equal(levelText('Music', -14), 'Music −14 dB');
    assert.equal(levelText('Music', 3), 'Music +3 dB');
    assert.equal(clampLevel(-40), MUSIC_LEVEL.min);
    assert.equal(clampLevel(2.6), 3);
    assert.equal(clampLevel('loud'), MUSIC_LEVEL.default);
    const clipA = { id: 'a', node_id: 1, seconds_ms: 4000, in_ms: 0, out_ms: 3000, sound: true, join: { type: 'cut' } };
    const clipB = { id: 'b', node_id: 2, seconds_ms: 4000, in_ms: 500, out_ms: 3000, sound: true };
    assert.equal(checkItems([clipA, { ...clipB, join: { type: 'cut', audio_ms: -400 } }]), null, 'J: 500 ms before the in point');
    assert.match(checkItems([clipA, { ...clipB, join: { type: 'cut', audio_ms: -600 } }]), /no sound before its in point/);
    assert.equal(checkItems([clipA, { ...clipB, join: { type: 'cut', audio_ms: 1000 } }]), null, 'L: 1 s after the out point');
    assert.match(checkItems([clipA, { ...clipB, join: { type: 'cut', audio_ms: 1200 } }]), /no sound after its out point/);
    assert.match(checkItems([clipA, { ...clipB, sound: false, join: { type: 'cut', audio_ms: 300 } }]), /sound on in both/);
    assert.match(checkItems([{ ...clipA, join: { type: 'cut', audio_ms: 300 } }]), /first clip/);
    assert.match(checkItems([clipA, { ...clipB, join: { type: 'cut', audio_ms: 1600 } }]), /at most 1\.5 s/);
    assert.equal(CUT_LIMITS.maxItems, 50);
});

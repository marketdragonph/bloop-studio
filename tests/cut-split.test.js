// Split (Ctrl/Cmd+B, S, or the Split key): one clip becomes two items from the same card at the playhead.
// The pure split (src/shared/cut-edit.js), the dock's key and undo (cut-actions.js), the export's timing
// (recipe.js on the one clock) and the server's save (two items from one card are accepted).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_SPLIT_MS, sameCut, splitItem, splitRefusal, toggleJoin } from '../src/shared/cut-edit.js';
import { CUT_LIMITS, checkItems } from '../src/shared/cut-rules.js';
import { cutClock } from '../src/shared/cut-clock.js';
import { layoutParts } from '../src/server/cut/export/recipe.js';
import { fakeCut, fakeDock, flush, key, withItems } from './cut-dock-fakes.js';
import { cutFixture } from './cut-fixture.js';
import { timedFindings } from '../src/server/cut/findings.js';
import { applyOp, locate } from '../src/server/director/cut/op-handlers.js';
import { inspectText } from '../src/server/director/cut/inspect-text.js';
import { guideKatana } from '../src/server/director/prompts/guide-katana.js';
import { CONTROLS, KEYS, controlLabel, copy } from '../src/shared/katana-controls.js';

const item = (id, ms, extra = {}) => ({
    id, node_id: Number(id.slice(1)), take_id: 1, beat_tag: id, media_path: `s/${id}.mp4`, seconds_ms: ms,
    in_ms: 0, out_ms: ms, sound: true, join: { type: 'cut' }, placed_by: 'person', ...extra,
});
const cut = () => [item('n1', 4000), item('n2', 6000, { sound: false, join: { type: 'dissolve', ms: 500 }, frame: { '9:16': { x: 0.2, y: 0.5, scale: 1 } } }), item('n3', 3000)];

test('split: two items from the same card, ending and starting at the source time; sound, crop and join carried over', () => {
    const items = cut();
    const snapshot = JSON.stringify(items);
    const { items: next, refused } = splitItem(items, 1, 2500);
    assert.equal(refused, null);
    assert.equal(JSON.stringify(items), snapshot, 'pure: the input is untouched, so undo restores it exactly');
    assert.deepEqual(next.map((i) => i.node_id), [1, 2, 2, 3]);
    const [, first, second] = next;
    assert.deepEqual([first.id, first.in_ms, first.out_ms, first.join], ['n2', 0, 2500, { type: 'dissolve', ms: 500 }], 'the first keeps its id and join');
    assert.deepEqual([second.in_ms, second.out_ms, second.join], [2500, 6000, { type: 'cut' }], 'the second starts there, joined by a cut');
    assert.deepEqual([first.sound, second.sound], [false, false]);
    assert.deepEqual(second.frame, first.frame);
    assert.equal(new Set(next.map((i) => i.id)).size, next.length, 'ids are unique');
    assert.equal(checkItems(next), null, 'the rule file accepts both parts');
    assert.equal(cutClock(next).total_ms, cutClock(items).total_ms, 'the total length does not change');
    assert.ok(sameCut({ items }, { items }) && !sameCut({ items }, { items: next }));
});

test('split again: every new id is unique, even when the next one is taken', () => {
    let items = [item('n1', 9000), item('n1.2', 3000, { node_id: 1 })];
    items = splitItem(items, 0, 3000).items;
    items = splitItem(items, 0, 1000).items;
    assert.deepEqual(items.map((i) => i.id), ['n1', 'n1.4', 'n1.3', 'n1.2']);
    assert.equal(checkItems(items), null);
    const long = 'x'.repeat(CUT_LIMITS.idMax);
    const split = splitItem([item('n5', 4000, { id: long })], 0, 2000).items;
    assert.ok(split[1].id.length <= CUT_LIMITS.idMax && split[1].id !== long);
});

test('edges: the playhead must sit at least 100 ms (3 frames) inside the clip', () => {
    const items = [item('n1', 4000, { in_ms: 1000, out_ms: 3000 })];
    assert.equal(MIN_SPLIT_MS, 100);
    for (const at of [1000, 1099, 2901, 3000, 500, 3500, NaN]) assert.equal(splitRefusal(items, 0, at), 'Move the playhead inside the clip', `at ${at}`);
    for (const at of [1100, 2000, 2900]) assert.equal(splitItem(items, 0, at).refused, null, `at ${at}`);
    assert.equal(splitItem(items, 0, 1099).items, items, 'a refused split changes nothing');
    assert.equal(splitRefusal(items, 4, 2000), 'Select a clip to split.');
});

test('the clip cap still applies: a split that would make 51 clips is refused in words', () => {
    const full = Array.from({ length: CUT_LIMITS.maxItems }, (_, i) => item(`n${i + 1}`, 2000));
    const { items, refused } = splitItem(full, 3, 1000);
    assert.match(refused, /at most 50 clips/);
    assert.equal(items, full);
    assert.equal(splitItem(full.slice(1), 3, 1000).refused, null, '49 clips split to 50');
});

test('a split that would change a dissolve is refused, so the total never moves', () => {
    const items = toggleJoin([item('n1', 4000), item('n2', 4000)], 1).items; // a 500 ms dissolve needs 1 s on both sides
    assert.match(splitItem(items, 1, 600).refused, /dissolve/);
    assert.match(splitItem(items, 0, 3500).refused, /dissolve/);
    assert.equal(splitItem(items, 1, 1000).refused, null);
    assert.equal(cutClock(splitItem(items, 1, 1000).items).total_ms, cutClock(items).total_ms);
});

test('the export needs no change: parts of a split cut add up to the same frames', () => {
    const items = cut();
    const split = splitItem(splitItem(items, 1, 2500).items, 0, 1234).items;
    const frames = (list) => layoutParts(list).totalFrames;
    assert.equal(frames(split), frames(items));
    assert.ok(layoutParts(split).parts.length > layoutParts(items).parts.length, 'one part per item, as for any list');
});

test('the dock: Ctrl+B splits at the playhead as ONE undo step, announces it, selects the second part', async (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([11, 12, 13]));
    dock.cutSelectedKey = 'c:i12'; // 6000 → 12000 on the lane
    dock.cutPlayheadMs = 6050;
    assert.equal(dock.cutSplitPlan().refused, 'Move the playhead inside the clip', 'too close to the edge');
    assert.equal(dock.cutSplitTitle(), 'Move the playhead inside the clip');
    dock.cutOnKey(key('b', { ctrlKey: true }));
    assert.equal(dock.cutModel.length, 3, 'a refused split changes nothing');
    assert.equal(dock.cutAnnounce, 'Move the playhead inside the clip');
    dock.cutPlayheadMs = 9200;
    const readout = dock.cutReadout();
    assert.equal(dock.cutSplitTitle(), 'Split (Ctrl+B, S)');
    const press = key('b', { metaKey: true });
    dock.cutOnKey(press);
    assert.ok(press.prevented && press.stopped, 'Cmd+B is the dock\'s, never the board\'s');
    assert.deepEqual(dock.cutModel.map((i) => [i.node_id, i.in_ms, i.out_ms]), [[11, 0, 6000], [12, 0, 3200], [12, 3200, 6000], [13, 0, 6000]]);
    assert.equal(dock.cutAnnounce, 'Split 02 · Arrival at 0:09.2');
    assert.equal(dock.cutSelectedKey, `c:${dock.cutModel[2].id}`);
    assert.equal(dock.cutLay().export_ms, 18000, 'the total length does not change');
    assert.equal(dock.cutReadout(), readout, 'a split card is still one beat on the rail');
    dock.cutOnKey(key('z', { ctrlKey: true }));
    await flush();
    assert.deepEqual(dock.cutModel, withItems([11, 12, 13]).cut.items, 'one undo restores exactly');
    dock.cutSelectedKey = 'c:i13';
    dock.cutPlayheadMs = 15000;
    dock.cutOnKey(key('s'));
    assert.equal(dock.cutModel.length, 4, 'S splits too');
});

test('the dock: a slate and a draft lane are not splittable', (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([11, 12]));
    const gap = dock.cutItems.find((i) => !i.ready);
    dock.cutSelectedKey = gap.key;
    dock.cutPlayheadMs = gap.board_ms + 1000;
    assert.equal(dock.cutSplitPlan().refused, 'A beat with no video yet cannot be split.');

    const draft = fakeDock(t).dock;
    draft.cutApply(fakeCut); // no items yet: the lane shows the ready beats, read only
    assert.ok(draft.cutDraft, 'a cut with no items is a draft lane');
    const clip = draft.cutItems.find((i) => i.ready);
    const entry = draft.cutLay().entries[clip.lane];
    draft.cutSelectedKey = clip.key;
    draft.cutPlayheadMs = (entry.start_ms + entry.end_ms) / 2;
    assert.equal(draft.cutSplitPlan().refused, copy('splitWhy'));
    draft.cutOnKey(key('b', { ctrlKey: true }));
    assert.deepEqual(draft.cutModel, [], 'Ctrl+B on a draft lane changes nothing');
});

test('Check your cut: a finding about the second part points at the second part', (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([11, 12, 13]));
    dock.cutApply({ ...withItems([]), cut: { ...withItems([]).cut, items: splitItem(withItems([11, 12, 13]).cut.items, 1, 3000).items } });
    const second = dock.cutModel[2];
    const found = dock.cutFindingItem({ code: 'SHORT', node_id: 12, item_id: second.id });
    assert.equal(dock.cutModel[found.clip].id, second.id);
    assert.equal(dock.cutModel[dock.cutFindingItem({ code: 'SHORT', node_id: 12 }).clip].id, 'i12', 'no clip id: the card\'s first clip');
});

test('Check your cut: a split that plays straight on is one shot, not a jump', () => {
    const briefs = new Map([['n1', 'Close-up of the hand'], ['n2', 'Close-up of the cup']]);
    const run = (items) => timedFindings({ cut: { items, sound: null }, briefs, analysisOf: () => null }).filter((f) => f.code === 'JUMP');
    const split = splitItem([item('n1', 6000)], 0, 3000).items;
    assert.deepEqual(run(split), [], 'two parts of one shot');
    const moved = [split[1], split[0]];
    assert.equal(run(moved).length, 1, 'parts out of order do jump');
    assert.equal(run([item('n1', 4000), item('n2', 4000)]).length, 1, 'two close-ups from two cards still jump');
});

/** A working cut for the Director's op handlers, with the checks it needs and nothing else. */
const working = (items) => {
    const w = {
        items, beats: items.map((i) => i.beat_tag), slots: [], downbeats: [], reasons: [], rows: [],
        reason: (text) => w.reasons.push(text), mayEdit: () => true, timedOk: () => true,
        row: (op, it, text) => w.rows.push(text), count: () => {}, note: () => {},
    };
    return w;
};

test('the Director names one part of a split beat: #id; a bare beat tag is refused in words', () => {
    const split = () => splitItem(cut(), 1, 2500).items; // n2 and n2.2
    let w = working(split());
    applyOp(w, 1, { op: 'remove', beat: 'n2' });
    assert.equal(w.items.length, 4, 'nothing removed');
    assert.equal(w.reasons[0], 'op 1: n2 is split into 2 parts in the cut; name the part: #n2, #n2.2.');
    w = working(split());
    applyOp(w, 1, { op: 'remove', beat: '@2' });
    assert.match(w.reasons[0], /split into 2 parts/);
    w = working(split());
    applyOp(w, 1, { op: 'remove', beat: '#n2.2' });
    assert.deepEqual([w.reasons, w.items.map((i) => i.id)], [[], ['n1', 'n2', 'n3']]);
    w = working(split());
    applyOp(w, 1, { op: 'trim', beat: '#N2.2', out_s: 5 });
    assert.deepEqual([w.reasons, w.items[2].out_ms], [[], 5000], 'a clip id is matched like a beat tag, case aside');
    w = working(split());
    applyOp(w, 1, { op: 'move', beat: 'n1', after: 'n2' });
    assert.deepEqual(w.items.map((i) => i.id), ['n2', 'n2.2', 'n1', 'n3'], 'after a split beat: after its last part');
    w = working(split());
    applyOp(w, 1, { op: 'join', beat: 'n2', type: 'cut' });
    assert.match(w.reasons[0], /name the part/);
    assert.equal(locate(working(split()), '#n9'), null);
});

test('inspect_cut lists each part of a split beat with the id to name it by', () => {
    const items = splitItem(cut(), 1, 2500).items;
    const text = inspectText({ cut: { items, revision: 1, sound: null }, analysisOf: () => ({ speech: [] }) });
    assert.match(text, /n2 @2 6\.0 s, used 0\.0–2\.5, at 3\.5 in the cut \| part 1 of 2, name it #n2 \| dissolve in 0\.5/);
    assert.match(text, /part 2 of 2, name it #n2\.2/);
    assert.doesNotMatch(text, /n1 @1[^\n]*part/, 'a beat in one piece has no part');
});

test('the Director\'s guide gives both Split keys, as the registry does', () => {
    assert.ok(guideKatana().includes(`${KEYS.split} or ${KEYS.splitAlt} (${controlLabel('cut.split')})`));
    assert.equal(CONTROLS.find((c) => c.id === 'cut.split').keys, `${KEYS.split}, ${KEYS.splitAlt}`);
});

let f;
before(async () => { f = await cutFixture('bloop-cut-split-'); });
after(() => f.close());

test('the server saves two items from the same card, each with its own trim', async () => {
    const { space, clips } = f.board('split', ['s1', 's2']);
    const { node, take } = clips.s1;
    const base = { node_id: node.id, take_id: take.id, sound: false, join: { type: 'cut' } };
    const items = [{ id: 'a', ...base, in_ms: 0, out_ms: 1200 }, { id: 'a.2', ...base, in_ms: 1200, out_ms: 3000 }];
    const res = await f.send('PUT', `/spaces/${space.id}/cut`, { revision: 0, items });
    assert.equal(res.status, 200);
    const { cut: saved } = await res.json();
    assert.deepEqual(saved.items.map((i) => [i.id, i.node_id, i.in_ms, i.out_ms, i.sound]), [['a', node.id, 0, 1200, false], ['a.2', node.id, 1200, 3000, false]]);
    const twice = await f.send('PUT', `/spaces/${space.id}/cut`, { revision: saved.revision, items: [items[0], { ...items[1], id: 'a' }] });
    assert.equal(twice.status, 422, 'the same id twice is still refused');
});

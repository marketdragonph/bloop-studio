// The dock's one time map (src/shared/cut-timeline.js on cut-clock.js): lane order, board time with gaps vs
// export time, the playhead maps, and where the beds play. Fixture numbers are pinned so the preview, the
// lanes and the export can never drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutClock } from '../src/shared/cut-clock.js';
import {
    bedGain, bedTime, bedWindow, drifted, entryAt, entryKey, fadeStart, laneEntries, layoutLane, nextClip, nextShown,
    sourceAt, toExport, toScreen,
} from '../src/shared/cut-timeline.js';

const slot = (index, node_id, state, seconds, extra = {}) => ({
    index, node_id, beat_tag: `s${index}`, label: `0${index} · Beat ${index}`, state, seconds, planned_seconds: seconds,
    take_id: node_id, media_url: state === 'ready' ? `/media/spaces/1/${node_id}.mp4` : null, ...extra,
});
const item = (id, node_id, in_ms, out_ms, join = { type: 'cut', ms: 0 }) => ({
    id, node_id, take_id: node_id, beat_tag: `n${node_id}`, media_path: `spaces/1/${node_id}.mp4`, seconds_ms: 10_000, in_ms, out_ms, sound: true, join,
});

// Beats 1–5; beat 3 has no video (a 3 s slate); the cut holds 1, 2, 4, 5 with a dissolve into 5.
const slots = [slot(1, 11, 'ready', 4), slot(2, 12, 'ready', 6), slot(3, 13, 'missing', null, { planned_seconds: 3, reason: 'never_rendered' }), slot(4, 14, 'ready', 5), slot(5, 15, 'ready', 4)];
const items = [item('a', 11, 0, 4000), item('b', 12, 1000, 6000), item('c', 14, 0, 5000), item('d', 15, 0, 4000, { type: 'dissolve', ms: 500 })];

test('lane entries: items in cut order, a gap for a beat with no clip, placed after the earlier beats', () => {
    const { entries, draft } = laneEntries(items, slots);
    assert.equal(draft, false);
    assert.deepEqual(entries.map((e) => e.kind === 'gap' ? `gap${e.beat}` : e.item.id), ['a', 'b', 'gap3', 'c', 'd']);
    const moved = laneEntries([items[2], items[0], items[1], items[3]], slots).entries;
    assert.deepEqual(moved.map((e) => e.kind === 'gap' ? 'gap' : e.item.id), ['c', 'a', 'b', 'gap', 'd'], 'a moved clip takes its beat with it');
    assert.equal(entryKey(entries[0]), 'c:a');
    assert.equal(entryKey(entries[2]), 'g:s3:13');
    const gone = laneEntries([item('x', 99, 0, 1000)], slots).entries[0];
    assert.equal(gone.gone, true, 'an item whose card is gone says so');
});

test('no items yet: the ready slots stand in, read only, in beat order', () => {
    const { entries, draft } = laneEntries([], slots);
    assert.equal(draft, true);
    assert.deepEqual(entries.map((e) => e.kind), ['clip', 'clip', 'gap', 'clip', 'clip']);
    assert.deepEqual(entries.map((e) => e.item?.out_ms ?? null), [4000, 6000, null, 5000, 4000]);
    assert.equal(entries[0].gone, false);
});

test('with gaps: a 3 s slate sits in board time and holds the export clock still', () => {
    const lay = layoutLane(laneEntries(items, slots).entries);
    const clock = cutClock(items);
    assert.equal(clock.total_ms, 17_500);
    assert.equal(lay.export_ms, clock.total_ms);
    assert.deepEqual(lay.entries.map((e) => [e.start_ms, e.end_ms]), [[0, 4000], [4000, 9000], [9000, 12_000], [12_000, 17_000], [16_500, 20_500]]);
    assert.equal(lay.total_ms, 20_500, 'board time = export + the slate');
    // During the slate the bed clock holds: export time stays at 9 s for the whole 3 s.
    assert.equal(toExport(lay, 9000), 9000);
    assert.equal(toExport(lay, 11_999), 9000);
    assert.equal(toExport(lay, 12_000), 9000);
    assert.equal(toExport(lay, 13_000), 10_000);
    assert.equal(toScreen(lay, 10_000), 13_000);
    assert.equal(entryAt(lay, 16_700), 4, 'the incoming clip during the dissolve');
    assert.equal(entryAt(lay, 20_500), -1);
    assert.equal(lay.entries[4].overlap_ms, 500);
    assert.equal(sourceAt(lay.entries[1], 5000), 2000, 'source time under the playhead (in 1 s + 1 s in)');
    assert.equal(nextShown(lay, 1), 2);
    assert.equal(nextClip(lay, 1), 3, 'the hidden video loads the clip after the gap');
});

test('as exported: gaps hidden, every number equals the export clock', () => {
    const lay = layoutLane(laneEntries(items, slots).entries, { gaps: false });
    const clock = cutClock(items);
    assert.equal(lay.total_ms, clock.total_ms, 'the playhead total equals cutClock');
    assert.equal(lay.entries[2].hidden, true);
    const clips = lay.entries.filter((e) => e.kind === 'clip');
    assert.deepEqual(clips.map((e) => e.start_ms), clock.items.map((i) => i.start_ms));
    for (const t of [0, 3999, 9000, 12_345, 17_499]) assert.equal(toExport(lay, t), t);
    assert.equal(nextShown(lay, 1), 3, 'the hidden gap is skipped');
});

test('a dissolve right after a gap plays as a cut on the board; the export keeps it', () => {
    const joined = [items[0], items[1], { ...items[2], join: { type: 'dissolve', ms: 500 } }];
    const board = layoutLane(laneEntries(joined, slots).entries);
    assert.equal(board.entries[3].overlap_ms, 0);
    assert.equal(board.entries[3].start_ms, 12_000);
    const exported = layoutLane(laneEntries(joined, slots).entries, { gaps: false });
    assert.equal(exported.entries[3].overlap_ms, 500);
    assert.equal(exported.total_ms, cutClock(joined).total_ms);
});

test('beds: play once from their start, cut at the end, fade over the last 1.5 s, and hold through a slate', () => {
    const lay = layoutLane(laneEntries(items, slots).entries);
    const music = bedWindow(0, 40_000, lay.export_ms);
    assert.deepEqual(music, { from_ms: 0, to_ms: 17_500 });
    const short = bedWindow(0, 6000, lay.export_ms);
    assert.equal(bedTime(short, 7000), null, 'a short bed stops; it never loops');
    const voice = bedWindow(2000, 5000, lay.export_ms);
    assert.equal(bedTime(voice, 1000), null);
    assert.equal(bedTime(voice, 2500), 500);
    // Through the 3 s slate the expected bed time does not move.
    assert.equal(bedTime(music, toExport(lay, 9500)), bedTime(music, toExport(lay, 11_500)));
    assert.equal(fadeStart(17_500, 40_000), 16_000);
    assert.equal(fadeStart(17_500, 6000), 4500);
    assert.equal(bedGain({ gainDb: 0 }, 1000), 1);
    assert.ok(Math.abs(bedGain({ gainDb: -12 }, 1000) - 0.2512) < 1e-3);
    assert.equal(bedGain({ gainDb: 0, fadeFromMs: 16_000 }, 16_750), 0.5);
    assert.equal(bedGain({ gainDb: 0, fadeFromMs: 16_000 }, 18_000), 0);
    assert.equal(drifted(1000, 1150), false);
    assert.equal(drifted(1000, 1151), true, 'more than 150 ms off is corrected');
});

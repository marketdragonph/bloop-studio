// fitPlan (05 §1.1): can the cut reach a length, and by which trims — dead frames first, then holds, never inside a
// spoken line, never under the shortest clip, the ending held; and honestly unreachable with the beat to drop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitPlan, MIN_CLIP_MS } from '../src/shared/cut-rules.js';
import { cutClock } from '../src/shared/cut-clock.js';

const item = (id, ms, extra = {}) => ({ id, beat_tag: id, media_path: `${id}.mp4`, seconds_ms: ms, in_ms: 0, out_ms: ms, sound: true, join: { type: 'cut' }, ...extra });
const ITEMS = [item('s1', 5000), item('s2', 5000), item('s3', 5000)];
const ANALYSIS = new Map([
    ['s1.mp4', { still_head: [0, 600], still_tail: [4400, 5000], speech: [] }],
    ['s2.mp4', { still_head: [0, 400], still_tail: [4600, 5000], speech: [[800, 4300]] }],
    ['s3.mp4', { still_head: [0, 500], still_tail: [4000, 5000], speech: [] }],
]);

test('reachable: the dead frames and holds that get there, biggest first, and only as many as needed', () => {
    const fit = fitPlan(ITEMS, ANALYSIS, 13);
    assert.equal(fit.total_ms, 15_000);
    assert.equal(fit.reachable, true);
    assert.ok(fit.best_ms <= 13_000);
    const after = cutClock(ITEMS.map((i) => {
        const t = fit.trims.find((x) => x.item_id === i.id);
        return t ? { ...i, in_ms: t.in_ms, out_ms: t.out_ms } : i;
    })).total_ms;
    assert.ok(after <= 13_000, `${after} ms after the listed trims`);
    assert.ok(fit.trims.every((t, k, all) => k === 0 || all[k - 1].lose_ms >= t.lose_ms), 'biggest first');
    assert.deepEqual(fit.drops, []);
});

test('never inside a spoken line, never under the shortest clip, and the last clip keeps its hold', () => {
    const fit = fitPlan(ITEMS, ANALYSIS, 1);
    const s2 = fit.can_lose.find((t) => t.item_id === 's2');
    assert.ok(s2.in_ms <= 800 && s2.out_ms >= 4300, `s2 keeps its line: ${s2.in_ms}–${s2.out_ms}`);
    for (const t of fit.can_lose) assert.ok(t.out_ms - t.in_ms >= MIN_CLIP_MS);
    const last = fit.can_lose.find((t) => t.item_id === 's3');
    assert.equal(last.out_ms, 5000, 'the ending is not cut short');
    assert.ok(last.out_ms - last.in_ms >= 2000);
});

test('unreachable: says the shortest honest length and which beat to drop, never the ending', () => {
    const fit = fitPlan(ITEMS, ANALYSIS, 9);
    assert.equal(fit.reachable, false);
    assert.ok(fit.best_ms > 9000);
    assert.ok(fit.drops.length > 0);
    assert.ok(fit.drops.every((d) => d.beat_tag !== 's3'), 'the last beat is the resolution');
    assert.ok(fit.drops[0].total_ms < fit.best_ms);
    assert.deepEqual(fit.drops.map((d) => Math.abs(d.total_ms - 9000)), [...fit.drops.map((d) => Math.abs(d.total_ms - 9000))].sort((a, b) => a - b), 'closest first');
});

test('no measures: nothing can be lost without a guess', () => {
    const fit = fitPlan(ITEMS, new Map(), 14);
    assert.equal(fit.best_ms, 15_000, 'an unmeasured clip could hide a line, so it loses nothing');
    assert.equal(fit.reachable, false);
    const none = fitPlan([item('a', 5000)], {}, 10);
    assert.equal(none.reachable, true);
    assert.deepEqual(none.trims, []);
});

test('dissolves count: the clock decides the length', () => {
    const joined = [item('s1', 5000), item('s2', 5000, { join: { type: 'dissolve', ms: 1000 } })];
    const fit = fitPlan(joined, new Map(), 9); // 9 s already: nothing needs to go
    assert.equal(fit.total_ms, 9000);
    assert.equal(fit.reachable, true);
});

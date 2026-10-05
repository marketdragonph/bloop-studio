import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutClock, dissolveMs, itemAt } from '../src/shared/cut-clock.js';

const clip = (in_ms, out_ms, join) => ({ in_ms, out_ms, ...(join ? { join } : {}) });
const starts = (clock) => clock.items.map((i) => i.start_ms);

test('an empty cut is 0 ms', () => {
    assert.deepEqual(cutClock([]), { total_ms: 0, items: [] });
});

test('cuts sit end to end, trimmed lengths', () => {
    const clock = cutClock([clip(0, 4000), clip(500, 3500, { type: 'cut', ms: 0 }), clip(1000, 2000)]);
    assert.equal(clock.total_ms, 8000);
    assert.deepEqual(starts(clock), [0, 4000, 7000]);
    assert.deepEqual(clock.items.map((i) => i.length_ms), [4000, 3000, 1000]);
});

test('a dissolve overlaps and shortens the cut by its length', () => {
    const clock = cutClock([clip(0, 4000), clip(0, 4000, { type: 'dissolve', ms: 500 })]);
    assert.equal(clock.total_ms, 7500);
    assert.deepEqual(starts(clock), [0, 3500]);
    assert.deepEqual(clock.items[1].join, { type: 'dissolve', ms: 500 });
});

test('the first item join is ignored', () => {
    const clock = cutClock([clip(0, 2000, { type: 'dissolve', ms: 800 })]);
    assert.equal(clock.total_ms, 2000);
    assert.deepEqual(clock.items[0].join, { type: 'cut', ms: 0 });
});

test('dissolve is clamped to 250..1000 ms', () => {
    assert.equal(dissolveMs(100, 10_000, 10_000), 250);
    assert.equal(dissolveMs(5000, 10_000, 10_000), 1000);
    assert.equal(dissolveMs(undefined, 10_000, 10_000), 500);
    const clock = cutClock([clip(0, 10_000), clip(0, 10_000, { type: 'dissolve', ms: 3000 })]);
    assert.equal(clock.total_ms, 19_000);
});

test('dissolve never exceeds half the shorter neighbour', () => {
    assert.equal(dissolveMs(1000, 1200, 8000), 600);
    assert.equal(dissolveMs(1000, 8000, 300), 150); // under the 250 floor: half the shorter clip wins
    const clock = cutClock([clip(0, 8000), clip(0, 1200, { type: 'dissolve', ms: 1000 }), clip(0, 8000, { type: 'dissolve', ms: 1000 })]);
    assert.deepEqual(clock.items.map((i) => i.join.ms), [0, 600, 600]);
    assert.deepEqual(starts(clock), [0, 7400, 8000]);
    assert.equal(clock.total_ms, 16_000);
});

test('itemAt picks the incoming clip during a dissolve', () => {
    const clock = cutClock([clip(0, 4000), clip(0, 4000, { type: 'dissolve', ms: 500 })]);
    assert.equal(itemAt(clock, 0), 0);
    assert.equal(itemAt(clock, 3499), 0);
    assert.equal(itemAt(clock, 3500), 1);
    assert.equal(itemAt(clock, 7500), -1);
});

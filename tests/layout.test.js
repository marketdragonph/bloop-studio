import { test } from 'node:test';
import assert from 'node:assert/strict';
import { untangle } from '../src/shared/layout.js';

const box = (id, x, y, h, w = 280) => ({ id, x, y, w, h });

test('a card that runs into the card above moves below it, snapped to the grid', () => {
    const moves = untangle([box(1, 0, 0, 455), box(2, 0, 320, 511)]);
    assert.deepEqual([...moves], [[2, 500]]); // 455 + 40 gap = 495 -> 500
});

test('the push cascades down a column', () => {
    const moves = untangle([box(1, 0, 0, 455), box(2, 0, 320, 511), box(3, 0, 840, 160)]);
    assert.equal(moves.get(2), 500);
    assert.equal(moves.get(3), 1060); // 500 + 511 + 40 = 1051 -> 1060
});

test('cards side by side, or already clear, never move', () => {
    assert.equal(untangle([box(1, 0, 0, 455), box(2, 380, 100, 511), box(3, 0, 470, 100)]).size, 0);
});

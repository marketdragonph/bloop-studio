import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeFor, knobInputs, knobOptions, aspectCss } from '../src/shared/formats.js';

test('sizes land on the tested defaults and stay multiples of 32', () => {
    assert.deepEqual(sizeFor('16:9', 0.41), { width: 864, height: 480 });
    assert.deepEqual(sizeFor('16:9', 0.4), { width: 832, height: 480 });
    assert.deepEqual(sizeFor('1:1', 1.05), { width: 1024, height: 1024 });
    for (const aspect of ['9:16', '4:5', '21:9']) {
        const { width, height } = sizeFor(aspect, 0.41);
        assert.equal(width % 32, 0);
        assert.equal(height % 32, 0);
    }
    assert.ok(sizeFor('9:16', 0.41).height > sizeFor('9:16', 0.41).width);
});

test('H3 frames follow the template rule; Wan frames are 4n+1', () => {
    assert.equal(knobInputs('h3', { duration: 5 }).length, 124);
    assert.equal(knobInputs('h3', { duration: 3 }).length % 17, 5);
    assert.equal(knobInputs('wan5b', { duration: 5 }).length, 121);
    assert.equal((knobInputs('wan5b', { duration: 3 }).length - 1) % 4, 0);
});

test('quality picks steps; unknown values fall back safely', () => {
    assert.equal(knobInputs('h3', { quality: 'draft' }).steps, 6);
    assert.equal(knobInputs('h3', {}).steps, 8);
    assert.equal(knobInputs('h3', { duration: 99 }).length, 124);
    assert.equal(knobInputs('zimage', { aspect: '9:16' }).length, undefined);
    assert.deepEqual(knobInputs('unknown', {}), {});
});

test('options and preview ratio for the card UI', () => {
    assert.equal(knobOptions('zimage').durations.length, 0);
    assert.deepEqual(knobOptions('h3').durations.map((d) => d.value), [3, 4, 5]);
    assert.equal(aspectCss('9:16'), '9 / 16');
});

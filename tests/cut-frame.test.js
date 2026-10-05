// Shapes and the crop box (05-irresistible.md §5.4): one set of crop maths for the preview and the export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRAME, checkFrame, cleanFrame, cropBox, displaySize, fitFor, frameOf } from '../src/shared/cut-frame.js';
import { cropFilter } from '../src/server/cut/export/frame-chain.js';
import { checkItem } from '../src/shared/cut-rules.js';

const HD = { width: 1280, height: 720 };
const VERTICAL = { width: 1080, height: 1920 };

test('9:16 from a 720p clip: the box at x = 0, 0.5 and 1 matches the preview fractions pixel for pixel', () => {
    const at = (x) => cropBox(HD, '9:16', { x }, VERTICAL);
    // The largest 9:16 box in 1280 × 720 is 405 × 720 → 404 × 718 on the even grid.
    assert.deepEqual([at(0).w, at(0).h, at(0).x, at(0).y], [404, 718, 0, 1]);
    assert.deepEqual([at(0.5).x, at(0.5).y], [438, 1]);
    assert.deepEqual([at(1).x, at(1).y], [876, 1]);
    for (const x of [0, 0.5, 1]) {
        const box = at(x);
        assert.equal(Math.round(box.fx * HD.width), box.x, 'preview left = export x');
        assert.equal(Math.round(box.fw * HD.width), box.w, 'preview width = export width');
        assert.equal(box.x + box.w <= HD.width, true, 'never past the right edge');
        assert.equal(cropFilter(box), `crop=404:718:${box.x}:1`);
    }
    assert.equal(at(0.5).upscale, 2.67, '1080 / 404: the soft-bars offer applies');
});

test('1:1 and zoom: scale 2 halves the box, y moves it, numbers stay even and inside', () => {
    const square = cropBox(HD, '1:1', {}, { width: 1080, height: 1080 });
    assert.deepEqual([square.w, square.h, square.x, square.y, square.upscale], [720, 720, 280, 0, 1.5]);
    const zoom = cropBox(HD, '1:1', { scale: 2, x: 0, y: 1 });
    assert.deepEqual([zoom.w, zoom.h, zoom.x, zoom.y], [360, 360, 0, 360]);
    const wide = cropBox({ width: 1080, height: 1920 }, '16:9', { y: 0.25 });
    assert.deepEqual([wide.w, wide.h, wide.x, wide.y], [1080, 606, 0, 329]);
});

test('non-square pixels and phone rotation: the box is in display pixels, the filter in stored ones', () => {
    assert.deepEqual(displaySize({ width: 1440, height: 1080, sar: 4 / 3 }), { width: 1920, height: 1080 });
    assert.deepEqual(displaySize({ width: 1920, height: 1080, rotation: -90 }), { width: 1080, height: 1920 });
    const box = cropBox({ width: 1920, height: 1080 }, '9:16', {});
    assert.equal(cropFilter(box, 4 / 3), `crop=${Math.round(box.w / (4 / 3) / 2) * 2}:${box.h}:${Math.round(box.x / (4 / 3))}:${box.y}`);
});

test('fitFor: the cut’s own shape fits (P3), another shape crops centred, soft bars only past 2× when asked', () => {
    const item = { id: 'a' };
    assert.equal(fitFor({ item, shape: '16:9', planShape: '16:9', source: HD, out: { width: 1920, height: 1080 } }).mode, 'fit');
    const crop = fitFor({ item, shape: '9:16', planShape: '16:9', source: HD, out: VERTICAL });
    assert.equal(crop.mode, 'crop');
    assert.equal(crop.box.x, 438);
    assert.equal(fitFor({ item, shape: '9:16', planShape: '16:9', source: HD, out: VERTICAL, softBars: true }).mode, 'bars');
    assert.equal(fitFor({ item, shape: '1:1', planShape: '16:9', source: { width: 1920, height: 1080 }, out: { width: 1080, height: 1080 }, softBars: true }).mode, 'crop', '1.0× is no blow-up');
    const moved = { id: 'b', frame: { '9:16': { x: 0.2 } } };
    assert.equal(fitFor({ item: moved, shape: '9:16', planShape: '16:9', source: HD, out: VERTICAL, softBars: true }).mode, 'crop', 'a box the person placed is kept');
    assert.equal(fitFor({ item: { frame: { '9:16': { fit: 'bars' } } }, shape: '9:16', planShape: '9:16', source: HD, out: VERTICAL }).mode, 'bars');
    assert.equal(fitFor({ item, shape: '9:16', planShape: '16:9', source: VERTICAL, out: VERTICAL }).mode, 'fit', 'already that shape');
    assert.ok(FRAME.softBarsOver === 2);
});

test('checkFrame refuses what the box cannot be; cleanFrame keeps known shapes only; checkItem reads it', () => {
    assert.equal(checkFrame(null), null);
    assert.equal(checkFrame({ '9:16': { x: 0.3, y: 1, scale: 1.5, fit: 'crop' } }), null);
    assert.match(checkFrame({ '4:3': { x: 0.5 } }), /16:9, 9:16 or 1:1/);
    assert.match(checkFrame({ '9:16': { x: 1.2 } }), /inside the clip/);
    assert.match(checkFrame({ '9:16': { scale: 4 } }), /1× to 3×/);
    assert.match(checkFrame({ '9:16': { fit: 'stretch' } }), /soft bars/);
    assert.match(checkFrame({ '9:16': { w: 3 } }), /x, y, scale and fit only/);
    assert.deepEqual(cleanFrame({ '9:16': { x: 0.33333, fit: 'bars' }, '1:1': {} }), { '9:16': { x: 0.333, fit: 'bars' }, '1:1': {} });
    assert.deepEqual(frameOf({}, '9:16'), { x: 0.5, y: 0.5, scale: 1, fit: 'crop' });
    const item = { node_id: 1, in_ms: 0, out_ms: 1000, sound: true, seconds_ms: 1000, frame: { '9:16': { x: -1 } } };
    assert.match(checkItem(item, 0), /^Clip 1: the crop box sits inside the clip/);
});

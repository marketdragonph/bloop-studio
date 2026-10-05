// The crop box in the dock (05-irresistible.md §5.4), on cut-frame.js: the preview shows the export's crop to the
// pixel at x = 0, 0.5 and 1 (and zoomed), drags stop at the edges, keys nudge 2 %, Home centres, zoom stays 1×–3×,
// and an edit touches only that clip's box for that shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropBox } from '../src/shared/cut-frame.js';
import { boxVars, centreFrame, frameText, isCentred, moveFrame, nudgeFrame, previewFrame, withFrame, zoomFrame } from '../src/shared/cut-frame-edit.js';

const SRC = { width: 1920, height: 1080 };
const OUT = { width: 1080, height: 1920 };
const pct = (v) => Number(String(v).replace('%', '')) / 100;

/** What a screen of `screenW` px shows of the source, from the preview's CSS variables alone. */
function shownRect(vars, screenW, screenH) {
    const videoW = screenW * pct(vars['--cut-crop-w']);
    const videoH = screenH * pct(vars['--cut-crop-h']);
    const scale = videoW / SRC.width; // px of screen per source px
    return {
        x: Math.round(-screenW * pct(vars['--cut-crop-x']) / scale) + 0,
        y: Math.round(-screenH * pct(vars['--cut-crop-y']) / (videoH / SRC.height)) + 0,
        w: Math.round(screenW / scale),
        h: Math.round(screenH / (videoH / SRC.height)),
    };
}

test('the preview shows exactly the export crop at x = 0, 0.5, 1 and zoomed, at any screen size', () => {
    for (const frame of [{ x: 0, y: 0.5, scale: 1 }, { x: 0.5, y: 0.5, scale: 1 }, { x: 1, y: 0.5, scale: 1 }, { x: 0.3, y: 0.8, scale: 2 }]) {
        const item = { frame: { '9:16': frame } };
        const box = cropBox(SRC, '9:16', frame, OUT);
        const { mode, vars } = previewFrame({ item, shape: '9:16', planShape: '16:9', source: SRC, out: OUT });
        assert.equal(mode, 'crop');
        for (const screenW of [124, 360]) {
            const screenH = screenW * 16 / 9;
            const shown = shownRect(vars, screenW, screenH);
            assert.deepEqual(shown, { x: box.x, y: box.y, w: box.w, h: box.h }, `x=${frame.x} scale=${frame.scale} on ${screenW} px`);
        }
    }
    const left = cropBox(SRC, '9:16', { x: 0 });
    const right = cropBox(SRC, '9:16', { x: 1 });
    assert.equal(left.x, 0);
    assert.equal(right.x + right.w, SRC.width, 'x = 1 sits on the right edge');
});

test('the preview picks the export\'s mode: the cut\'s own shape fits, another shape crops, soft bars for blown-up crops', () => {
    assert.equal(previewFrame({ item: {}, shape: '16:9', planShape: '16:9', source: SRC, out: { width: 1920, height: 1080 } }).mode, 'fit');
    assert.equal(previewFrame({ item: {}, shape: '9:16', planShape: '16:9', source: SRC, out: OUT }).mode, 'crop', 'centred by default, never a guess');
    const small = { width: 864, height: 480 };
    const soft = previewFrame({ item: {}, shape: '9:16', planShape: '16:9', source: small, out: OUT, softBars: true });
    assert.equal(soft.mode, 'bars');
    assert.ok(soft.upscale > 2);
    assert.equal(previewFrame({ item: { frame: { '9:16': { x: 0.5, y: 0.5, scale: 1 } } }, shape: '9:16', planShape: '16:9', source: small, out: OUT, softBars: true }).mode, 'crop', 'a box the person set is kept');
    assert.equal(previewFrame({ item: {}, shape: '9:16', planShape: '16:9', source: { width: 0, height: 0 }, out: OUT }).mode, 'fit', 'unknown size: whole clip');
});

test('the box over the whole clip, drags that stop at the edges, keys, Home and zoom', () => {
    const vars = boxVars(SRC, '9:16', { x: 0.5, y: 0.5, scale: 1 });
    assert.ok(Math.abs(pct(vars['--cut-box-h']) - 1076 / 1080) < 0.001, 'even pixels: 1076 of 1080 rows');
    assert.ok(Math.abs(pct(vars['--cut-box-w']) - 606 / 1920) < 0.001);
    const start = { x: 0.5, y: 0.5, scale: 1 };
    const room = 1920 - 606;
    const moved = moveFrame(start, 0.1, 0.2, SRC, '9:16');
    assert.ok(Math.abs(moved.x - (657 + 192) / room) < 0.002, `${moved.x}`);
    assert.equal(moved.y, 1, 'four rows of room: the box goes to the bottom');
    assert.deepEqual(moveFrame(start, 0.3, 0.3, { width: 1080, height: 1920 }, '9:16'), start, 'a clip already 9:16 has no room: the box stays');
    assert.equal(moveFrame(start, 5, 0, SRC, '9:16').x, 1, 'stops at the right edge');
    assert.equal(moveFrame(start, -5, 0, SRC, '9:16').x, 0, 'stops at the left edge');
    assert.deepEqual(nudgeFrame(start, 1, 0), { x: 0.52, y: 0.5, scale: 1 });
    assert.deepEqual(nudgeFrame({ x: 0.99, y: 0, scale: 1 }, 1, -1), { x: 1, y: 0, scale: 1 });
    assert.equal(zoomFrame(start, { step: 1 }).scale, 1.1);
    assert.equal(zoomFrame(start, { factor: 10 }).scale, 3, 'at most 3×');
    assert.equal(zoomFrame(start, { factor: 0.1 }).scale, 1, 'never wider than the clip');
    assert.deepEqual(centreFrame({ x: 0.1, y: 0.9, scale: 2.4 }), { x: 0.5, y: 0.5, scale: 1 });
    assert.ok(isCentred({ x: 0.5, y: 0.5, scale: 1 }));
    assert.equal(frameText({ x: 0.34, y: 0.5, scale: 1.4 }), '34 % across, 50 % down, 1.4×');
});

test('an edit sets one clip\'s box for one shape and keeps the rest', () => {
    const items = [{ id: 'a', frame: { '1:1': { x: 0.2, y: 0.5, scale: 1 } } }, { id: 'b' }];
    const next = withFrame(items, 0, '9:16', { x: 0.25, y: 0.5, scale: 1.5, extra: 1 });
    assert.deepEqual(next[0].frame, { '1:1': { x: 0.2, y: 0.5, scale: 1 }, '9:16': { x: 0.25, y: 0.5, scale: 1.5 } });
    assert.equal(next[1], items[1], 'the other clip is the same object');
    assert.deepEqual(withFrame(next, 0, '9:16', { x: 0.5, y: 0.5, scale: 1 })[0].frame['9:16'], { x: 0.5, y: 0.5, scale: 1 }, 'centred on purpose is kept');
    const gone = withFrame(withFrame(items, 0, '1:1', null), 0, '9:16', null);
    assert.equal('frame' in gone[0], false, 'no boxes left: no frame');
    assert.deepEqual(withFrame(items, 1, '9:16', { x: 0, y: 0, scale: 1, fit: 'bars' })[1].frame['9:16'].fit, 'bars');
});

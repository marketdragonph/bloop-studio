// Narrow windows and touch (02-dock.md §2, §6, P5): one bottom sheet at a time (the dock or the Director), a tap
// opens the item sheet until Done, and Trim's sliders commit ONE undo step per drag while ±0.1 s keys are one each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDock, stored } from './cut-dock-fakes.js';

const css = (name) => readFileSync(new URL(`../public/css/${name}`, import.meta.url), 'utf8');

function narrowDock(t, narrow = true) {
    const was = globalThis.matchMedia;
    globalThis.matchMedia = (query) => ({ matches: query.includes('max-width') ? narrow : false });
    t.after(() => { globalThis.matchMedia = was; });
    const { dock } = fakeDock(t);
    dock.cutReceive({ revision: 1, items: stored([11, 12]).map((i) => ({ ...i, seconds_ms: 8000 })), sound: null, auto: false });
    dock._cutSlots = [{ node_id: 11, take_id: 91, state: 'ready' }, { node_id: 12, take_id: 92, state: 'ready' }];
    dock.cutStatus = 'ready';
    dock.cutLayout();
    return dock;
}

test('narrow: opening the dock folds the Director, and the Director opening folds the dock', (t) => {
    const dock = narrowDock(t);
    dock.cutOpen = false;
    dock.directorOpen = true;
    dock.cutToggle();
    assert.deepEqual([dock.cutOpen, dock.directorOpen], [true, false]);
    dock.cutNarrowYield();
    assert.equal(dock.cutOpen, false);
});

test('wide: the dock and the Director stay open side by side', (t) => {
    const dock = narrowDock(t, false);
    dock.cutOpen = false;
    dock.directorOpen = true;
    dock.cutToggle();
    assert.deepEqual([dock.cutOpen, dock.directorOpen], [true, true]);
    dock.cutNarrowYield();
    assert.equal(dock.cutOpen, true);
});

test('a tap opens the item sheet; Done closes it and keeps the clip selected', (t) => {
    const dock = narrowDock(t);
    const clip = dock.cutItems.find((i) => i.ready);
    dock.cutSelect(clip);
    assert.equal(dock.cutItemOpen, true);
    dock.cutCloseItem();
    assert.deepEqual([dock.cutItemOpen, dock.cutSelectedKey], [false, clip.key]);
});

test('Trim: a slider drag is one undo step; −0.1 s / +0.1 s keys are one each; the ends stay inside the clip', async (t) => {
    const dock = narrowDock(t);
    dock.cutSelect(dock.cutItems.find((i) => i.ready));
    assert.deepEqual(dock.cutTrimBounds(), { max: 8000, in_ms: 0, out_ms: 6000 });
    for (const v of [5500, 5000, 4430]) dock.cutTrimRange('out', v);
    assert.equal(dock.cutModel[0].out_ms, 4400, 'snapped to 0.1 s while dragging');
    assert.equal(dock._cutHistory.canUndo(), false, 'nothing committed mid-drag');
    dock.cutTrimRange('out', 4430, { commit: true });
    assert.equal(dock._cutHistory.nextUndoLabel(), 'Trim out');
    assert.equal(dock.cutAnnounce, 'Out 0:04.4');
    dock.cutTrimStep('in', 1);
    dock.cutTrimStep('in', 1);
    assert.equal(dock.cutModel[0].in_ms, 200);
    dock.cutTrimStep('in', -1);
    assert.equal(dock.cutTrimText('in'), 'In 0:00.1');
    dock.cutTrimRange('out', 99_000, { commit: true });
    assert.equal(dock.cutModel[0].out_ms, 8050, 'never past the measured clip (cut-edit.js allows its 50 ms slack)');
    await dock.cutUndo();
    await dock.cutUndo();
    await dock.cutUndo();
    await dock.cutUndo();
    assert.deepEqual([dock.cutModel[0].in_ms, dock.cutModel[0].out_ms], [0, 4400], 'four presses, four steps; the drag was one');
    await dock.cutUndo();
    assert.equal(dock.cutModel[0].out_ms, 6000);
});

test('the narrow sheet, the item sheet and 44 px touch targets are in the CSS; reduced motion stops the dock moving', () => {
    const narrow = css('cut-narrow.css');
    assert.match(narrow, /@media \(max-width: 47\.999rem\)[\s\S]*\.cut-dock\.is-open \{ height: 60dvh; \}/);
    assert.match(narrow, /\.cut-details\.is-item-open \{[\s\S]*position: fixed;/);
    assert.match(narrow, /scroll-snap-type: x proximity/);
    assert.match(narrow, /@media \(pointer: coarse\)[\s\S]*\.cut-dock \.ae-key \{ min-height: var\(--touch-min\); \}/);
    assert.match(css('director.css'), /@media \(max-width: 47\.999rem\)/, 'the Director turns into a sheet at the same width');
    assert.ok(css('app.css').includes("@import url('./cut-narrow.css');"));
    // Every animation or transition in the Katana CSS has a reduced-motion rule that stops it.
    for (const file of ['cut.css', 'cut-tracks.css', 'cut-edit.css', 'cut-export.css', 'cut-director.css', 'cut-shape.css', 'cut-first-run.css', 'cut-narrow.css', 'mecha.css']) {
        const text = css(file);
        const moves = /(?<!-)\b(animation|transition):\s*(?!none)/.test(text.replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g, ''));
        if (moves) assert.match(text, /@media \(prefers-reduced-motion: reduce\)/, `${file} moves but has no reduced-motion rule`);
    }
});

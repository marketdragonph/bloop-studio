// The dock on a big board (02-dock.md §11, P5): a trim drag patches the view lists in place instead of replacing
// 50 objects a frame, the ruler draws its minor ticks as one gradient, the lanes render one task after the preview,
// and cutPart searches inside the dock only. The browser numbers are in docs/plans/katana/02-dock.md §13.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchList } from '../public/js/components/cut-patch.js';
import { rulerScale, rulerTicks } from '../src/shared/cut-lanes.js';
import { fakeDock, stored } from './cut-dock-fakes.js';

test('patchList: same keys in order patch the old objects field by field; anything else is the new list', () => {
    const prev = [{ key: 'a', x: 0, w: 10, tag: { n: 1 } }, { key: 'b', x: 10, w: 20, tag: { n: 2 } }];
    const keepA = prev[0];
    const keepTag = prev[1].tag;
    const out = patchList(prev, [{ key: 'a', x: 0, w: 12, tag: { n: 1 } }, { key: 'b', x: 12, w: 20, tag: { n: 2 } }]);
    assert.equal(out, prev, 'the same array');
    assert.equal(out[0], keepA, 'the same objects');
    assert.deepEqual(out.map((i) => [i.x, i.w]), [[0, 12], [12, 20]]);
    assert.equal(out[1].tag, keepTag, 'an equal object value is not replaced (no needless update)');
    const reordered = [{ key: 'b', x: 0, w: 20 }, { key: 'a', x: 20, w: 12 }];
    assert.equal(patchList(prev, reordered), reordered);
    const longer = [...reordered, { key: 'c', x: 40, w: 5 }];
    assert.equal(patchList(prev, longer), longer);
    assert.equal(patchList(null, longer), longer);
});

test('rulerScale: the labelled majors as elements, the minors as one step in px', () => {
    const ticks = rulerTicks(150_000, 12);
    const scale = rulerScale(150_000, 12);
    assert.deepEqual(scale.majors.map((t) => t.label), ticks.filter((t) => t.major).map((t) => t.label));
    assert.equal(scale.minorPx, ticks[1].x - ticks[0].x);
    assert.ok(scale.majors.length < ticks.length / 2, `${scale.majors.length} elements instead of ${ticks.length}`);
});

test('a trim drag keeps the item objects: only the changed fields update', (t) => {
    const { dock } = fakeDock(t);
    dock.cutReceive({ revision: 1, items: stored([11, 12, 13]), sound: null, auto: false });
    dock._cutSlots = [11, 12, 13].map((n) => ({ node_id: n, take_id: 90 + n, state: 'ready' }));
    dock.cutStatus = 'ready';
    dock.cutLayout();
    const before = dock.cutItems.slice();
    const ticks = dock.cutTicks;
    dock.cutModel = dock.cutModel.map((item, i) => (i === 0 ? { ...item, out_ms: 4000 } : item));
    dock.cutLayout();
    assert.ok(dock.cutItems.every((item, i) => item === before[i]), 'same objects after a trim frame');
    assert.equal(dock.cutTicks, ticks, 'the ruler list is kept too');
    assert.equal(dock.cutItems[0].ms, 4000, 'the trimmed length is on the kept object');
    dock.cutModel = [dock.cutModel[1], dock.cutModel[0], dock.cutModel[2]];
    dock.cutLayout();
    assert.notEqual(dock.cutItems[0], before[0], 'a reorder replaces the list (x-for re-keys it)');
});

test('unfolding renders the lanes one task after the preview; cutPart stays inside the dock', async (t) => {
    const { dock } = fakeDock(t);
    dock.cutOpen = false;
    dock.cutToggle();
    assert.deepEqual([dock.cutOpen, dock.cutLanesOn], [true, false]);
    await new Promise((resolve) => setTimeout(resolve, 200)); // no frames in Node: the 150 ms fallback
    assert.equal(dock.cutLanesOn, true);
    const view = readFileSync(new URL('../src/server/views/pages/spaces/cut/dock.edge', import.meta.url), 'utf8');
    assert.match(view, /x-if="cutStatus === 'ready' && cutItems.length && cutLanesOn"/);
    const code = readFileSync(new URL('../public/js/components/cut-dock.js', import.meta.url), 'utf8');
    assert.doesNotMatch(code, /document\.querySelector\(`\.cut-dock \[data-cut-part/, 'no page-wide search per frame');
});

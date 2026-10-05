// Zoom on the Cut's lanes, the ruler and waveform that follow it, and the preview's full screen (2026-10-06).
// Ctrl+scroll zooms around the pointer and the time under it stays under it; Ctrl+= / Ctrl+- around the playhead;
// Fit and Ctrl+0 go back. The deck's full-screen key toggles (enter, then exit), and its icon says which.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDock, key, withItems, read } from './cut-dock-fakes.js';
import { rulerScale, rulerTicks } from '../src/shared/cut-lanes.js';

// After the fakes: they map /shared/ for the browser modules.
const { zoomedPps, wheelPixels, ZOOM_MAX_PPS } = await import('../public/js/components/cut-zoom.js');
const { barsAt, resamplePeaks } = await import('../public/js/components/cut-wave.js');

/** A lane scroller the dock can find: scrollLeft clamps to the span like a browser's, to whole pixels. */
function lanes(dock, width = 600) {
    const style = new Map();
    const span = { style: { setProperty: (k, v) => style.set(k, v) } };
    const scroll = {
        clientWidth: width, _left: 0,
        get scrollLeft() { return this._left; },
        set scrollLeft(v) { this._left = Math.round(Math.max(0, Math.min(v, dock.cutSpan - width))); },
        getBoundingClientRect: () => ({ left: 100, top: 0, width, right: 100 + width }),
        scrollTo({ left }) { this.scrollLeft = left; },
        style: { setProperty() {}, removeProperty() {} },
    };
    dock.cutPart = (name) => ({ scroll, span })[name] ?? null;
    return scroll;
}

const wheel = (deltaY, clientX, extra = {}) => ({ deltaY, deltaMode: 0, clientX, ctrlKey: true, prevented: false, preventDefault() { this.prevented = true; }, ...extra });

test('zoom maths: the Fit scale times the zoom, never under Fit, never past the deepest zoom; wheel units', () => {
    assert.equal(zoomedPps(20, 1), 20);
    assert.equal(zoomedPps(20, 0.5), 20, 'never under Fit');
    assert.equal(zoomedPps(20, 10_000), ZOOM_MAX_PPS);
    assert.equal(zoomedPps(2000, 3), 2000, 'a cut already past the deepest scale stays at Fit');
    assert.equal(wheelPixels({ deltaY: 3, deltaMode: 1 }), 48, 'lines');
    assert.equal(wheelPixels({ deltaY: 1, deltaMode: 2 }, 700), 700, 'pages');
});

test('Ctrl+scroll zooms around the pointer: the time under it holds within a pixel, in and back out', async (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([11, 12, 13, 15]));
    const scroll = lanes(dock);
    dock.cutLayout();
    const fit = dock.cutPps;
    const x = 371; // px into the lanes
    const timeAt = () => (scroll.scrollLeft + x) / dock.cutPps;
    const start = timeAt();
    for (let i = 0; i < 25; i++) {
        dock.cutWheel(wheel(-120, 100 + x));
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(dock.cutPps > fit * 10, `zoomed in: ${dock.cutPps} px/s`);
    assert.ok(Math.abs(timeAt() - start) * dock.cutPps < 1, `drift ${(timeAt() - start) * dock.cutPps} px`);
    for (let i = 0; i < 12; i++) {
        dock.cutWheel(wheel(120, 100 + x));
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(Math.abs(timeAt() - start) * dock.cutPps < 1, 'and on the way out');

    const plain = wheel(120, 100 + x, { ctrlKey: false });
    dock.cutWheel(plain);
    assert.equal(plain.prevented, false, 'a plain wheel still scrolls the lanes');

    dock.cutFit();
    assert.equal(dock.cutZoom, 1);
    assert.equal(dock.cutPps, fit);
});

test('Ctrl+= and Ctrl+- zoom around the playhead; Ctrl+0 fits', async (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([11, 12, 13]));
    lanes(dock);
    dock.cutLayout();
    const fit = dock.cutPps;
    dock.cutOnKey(key('=', { ctrlKey: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(Math.abs(dock.cutPps - fit * 1.5) < 1e-6);
    dock.cutOnKey(key('-', { ctrlKey: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(Math.abs(dock.cutPps - fit) < 1e-6);
    dock.cutOnKey(key('=', { ctrlKey: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const zero = key('0', { ctrlKey: true });
    dock.cutOnKey(zero);
    assert.equal(zero.prevented, true, 'the app never page-zooms from the dock');
    assert.equal(dock.cutZoom, 1);
});

test('the ruler: tenths and a tick a frame when zoomed in; only the labels near the view', () => {
    const deep = rulerScale(20_000, 1200);
    assert.deepEqual(deep.majors.slice(0, 3).map((m) => m.label), ['0:00.0', '0:00.1', '0:00.2']);
    assert.equal(deep.minorPx, 40, 'one minor a frame: 1/30 s at 1200 px/s');
    assert.equal(deep.majors[7].x, 840);
    const windowed = rulerScale(600_000, 1200, { fromS: 300, toS: 301 });
    assert.deepEqual([windowed.majors[0].label, windowed.majors.at(-1).label, windowed.majors.length], ['5:00.0', '5:01.0', 11]);
    assert.equal(windowed.majors[0].key, 3000, 'keys are the step index, so a scroll patches in place');
    const fit = rulerTicks(45_700, 10);
    assert.equal(fit.filter((m) => m.major)[1].label, '0:05', 'whole seconds at Fit');
});

test('the waveform keeps its detail: more bars as the lanes zoom, each the loudest of its share', () => {
    assert.equal(barsAt(60_000, 20, 6000), 200, 'one bar per 6 px at Fit');
    assert.equal(barsAt(60_000, 1200, 6000), 6000, 'up to the decoded grain');
    assert.deepEqual(resamplePeaks([0.1, 0.9, 0.2, 0.4, 0.3, 0.3], 3), [0.9, 0.4, 0.3]);
    assert.deepEqual(resamplePeaks([0.5, 0.6], 4), [0.5, 0.6], 'never more bars than decoded');
});

test('full screen: the stage goes full screen, the key exits it again, and the icon says which', () => {
    const preview = read('src/server/views/pages/spaces/cut/preview.edge');
    assert.match(preview, /<div class="cut-stage" x-ref="cutStage"/);
    const deck = read('src/server/views/pages/spaces/media-deck.edge');
    assert.match(deck, /fullOn \? 'Exit full screen \(f\)' : 'Full screen \(f\)'/);
    assert.match(deck, /icon\('shrink'\)/);
    const player = read('public/js/components/cut-player.js');
    assert.match(player, /if \(this\.fullOn\) document\.exitFullscreen/);
    assert.match(player, /this\.\$refs\.cutStage\?\.requestFullscreen/);
    assert.match(read('public/css/cut-shape.css'), /\.cut-stage:fullscreen \{ max-height: none; aspect-ratio: auto; \}/);
    // A video's full screen is never remembered as the window's (only F11 is).
    assert.doesNotMatch(read('src/main/main.js'), /on\('enter-full-screen'/);
});

test('filmstrips: a clip with a sheet draws its tiles; zoomed, only those near the view', async (t) => {
    const { dock } = fakeDock(t);
    const strip = { url: '/media/.bloop-cache/strips/k.jpg', duration_ms: 6000, every_ms: 100, frames: 60, cols: 16, rows: 4, tile_w: 160, tile_h: 90 };
    dock.cutApply({ ...withItems([11, 12, 13]), strips: { 's/11.mp4': strip } });
    const scroll = lanes(dock);
    dock.cutLayout();
    const [first, second] = dock.cutItems;
    assert.equal(first.media_path, 's/11.mp4');
    assert.ok(dock.cutStripTiles(first).length >= 1);
    assert.deepEqual(dock.cutStripTiles(second), [], 'no sheet yet: the first frame shows, as before');
    assert.match(dock.cutStripSheet(first)['--cut-strip'], /strips\/k\.jpg/);
    for (let i = 0; i < 20; i++) {
        dock.cutWheel(wheel(-120, 100));
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const all = Math.ceil(dock.cutItems[0].w / (82 * 16 / 9));
    const drawn = dock.cutStripTiles(dock.cutItems[0]);
    assert.ok(drawn.length < all, `${drawn.length} tiles drawn of ${all}`);
    assert.ok(drawn.every((tile) => dock.cutItems[0].x + tile.x + tile.w >= scroll.scrollLeft - 600 && dock.cutItems[0].x + tile.x <= scroll.scrollLeft + 1200));
});

test('zoomed ruler: the minors are elements exactly on their times (a long gradient drifts), none under a label', () => {
    const pps = 151.7; // an uneven scale (labels every 0.5 s), deep into a long cut
    const scale = rulerScale(600_000, pps, { fromS: 75, toS: 82 });
    const step = 0.5; // labels 0.5 s apart at this scale, a minor every 0.25 s
    assert.ok(Math.abs(scale.majors[1].x - scale.majors[0].x - step * pps) < 0.02);
    for (const tick of scale.minors) {
        assert.ok(Math.abs(tick.x - tick.key * 0.25 * pps) < 0.01, `minor ${tick.key} at ${tick.x}`);
        assert.ok(tick.key % 2 === 1, 'never where a label tick is');
    }
    assert.ok(scale.minors.length > 0 && scale.minors.length < 40);
    assert.deepEqual(rulerScale(20_000, 20).minors, [], 'at Fit the gradient draws them');
});

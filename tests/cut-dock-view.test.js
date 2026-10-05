// The Cut dock (Mini Katana P1): the board page carries one read-only dock with registry labels and
// data-control marks, its CSS keeps the house rules, and the lane geometry for a fake cut is pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createViews } from '../src/server/views.js';
import { CONTROLS, controlLabel } from '../src/shared/katana-controls.js';
import {
    ITEM_MIN_PX, bedSegments, fitScale, fmtClock, fmtLength, gapBlocks, laneLayout, readout, rulerTicks,
    toBoardMs, totals, wavePath, waveWindow,
} from '../src/shared/cut-lanes.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const CUT_VIEWS = 'src/server/views/pages/spaces/cut/';
const cutViews = () => readdirSync(new URL(CUT_VIEWS, root)).map((f) => ({ file: f, text: read(CUT_VIEWS + f) }));

async function renderBoard() {
    const views = createViews({ csrfToken: 'test-token' });
    const board = {
        space: { id: 7, name: 'Last Train Home', canvas_state: { zoom: 1, panX: 0, panY: 0 } },
        nodes: [{ id: 41, type: 'video', label: 's4-flashback', position_x: 0, position_y: 0, settings: {} }],
        connections: [],
    };
    return views.render('pages/spaces/editor', { board, boardJson: JSON.stringify(board), creatableTypes: [] });
}

// A fake GET /spaces/:id/cut: 7 beats, beat 4 never rendered, beat 6 rendering, a 40 s music bed.
const fakeCut = {
    cut: { revision: 3, items: [], sound: null, settings: { resolution: 1080, fps: 30 } },
    slots: [
        { beat_tag: 's1-hook', label: '01 · Hook', node_id: 11, state: 'ready', seconds: 6, poster_url: '/media/p1.png' },
        { beat_tag: 's2-arrival', label: '02 · Arrival', node_id: 12, state: 'ready', seconds: 8.2 },
        { beat_tag: 's3-letter', label: '03 · The letter', node_id: 13, state: 'ready', seconds: 7.5 },
        { beat_tag: 's4-flashback', label: '04 · Flashback', node_id: 14, state: 'missing', reason: 'never_rendered', seconds: null, planned_seconds: 8 },
        { beat_tag: 's5-call', label: '05 · The call', node_id: 15, state: 'ready', seconds: 9.1 },
        { beat_tag: 's6-running', label: '06 · Running', node_id: 16, state: 'rendering', seconds: null, planned_seconds: 6.4 },
        { beat_tag: 's7-last', label: '07 · Last train', node_id: 17, state: 'ready', seconds: 0.5 },
    ],
    beds: [{ node_id: 20, label: 'music bed', kind: 'music', media_url: '/media/song.mp3', seconds: 40 }],
    clock: { total_ms: 31300 },
};

test('the board page includes the Cut dock once, in the board scope, outside the board transform', async () => {
    const html = await renderBoard();
    assert.equal(html.match(/<section class="cut-dock"/g)?.length, 1);
    assert.match(html, /<section class="cut-dock" x-data="CutDock" aria-label="Cut" data-control="cut.dock"/);
    const world = html.indexOf('class="board__world"');
    const dock = html.indexOf('class="cut-dock"');
    const page = html.indexOf('x-data="SpaceBoard"');
    assert.ok(page < world && world < dock, 'the dock comes after the board, inside SpaceBoard');
    assert.match(html, /@board:cut\.window="onCutEvent\(\$event\.detail\)"/);
    assert.match(html, /@board:node\.window="onCutNode\(\$event\.detail\)"/);
    assert.match(html, /@board:nodes\.window="cutRefetchSoon\(\)"/);
    // Folded holds no media: the body (preview, lanes) only exists under x-if="cutOpen".
    assert.match(html, /<template x-if="cutOpen">\s*<div class="cut-dock__body"/);
    assert.doesNotMatch(html.slice(dock), /<video/);
});

test('every control in the dock is marked with a registry id and shows the registry label', async () => {
    const html = await renderBoard();
    const dock = html.slice(html.indexOf('<section class="cut-dock"'));
    const ids = [...dock.matchAll(/data-control="([^"]+)"/g)].map((m) => m[1]);
    const known = new Set(CONTROLS.map((c) => c.id));
    for (const id of ids) assert.ok(known.has(id), `${id} is in katana-controls.js`);
    for (const id of ['cut.dock', 'cut.fold', 'cut.goToCard', 'cut.clip', 'cut.retry', 'cut.askDirector', 'cut.lane.video', 'cut.lane.voice', 'cut.lane.music']) {
        assert.ok(ids.includes(id), `${id} is on the page`);
    }
    for (const id of ['cut.goToCard', 'cut.retry', 'cut.askDirector', 'cut.lane.music']) assert.ok(dock.includes(`>${controlLabel(id)}<`), `${id} label`);
    // Every button in the dock is a marked control.
    const buttons = dock.match(/<button\b[^>]*>/g) ?? [];
    assert.ok(buttons.length >= 4);
    for (const b of buttons) assert.match(b, /data-control="/, b);
    // The fold key says what it does and what it controls.
    assert.match(dock, /aria-controls="cut-dock-body"[^>]*:aria-expanded=/);
    // P1 is read-only: no unshipped keys (Export, Pack, Undo) and nothing that starts a render.
    for (const id of ['cut.export', 'cut.pack', 'cut.undo', 'cut.openKatana']) assert.ok(!ids.includes(id), `${id} waits for its phase`);
    assert.doesNotMatch(dock, /generate\(/);
});

test('the dock templates and CSS keep the house rules', () => {
    for (const { file, text } of cutViews()) {
        assert.doesNotMatch(text, /\sstyle="/, `${file}: no inline styles`);
        assert.ok(text.split('\n').length <= 500, `${file} under 500 lines`);
    }
    for (const file of ['public/css/cut.css', 'public/css/cut-tracks.css']) {
        const css = read(file);
        assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, `${file}: no hex colours`);
        assert.doesNotMatch(css, /rgba?\(|hsla?\(/, `${file}: no raw colours`);
        assert.doesNotMatch(css, /!important/, `${file}: no !important`);
        assert.match(css, /prefers-reduced-motion/, `${file}: reduced motion`);
        assert.ok(css.split('\n').length <= 500);
    }
    const app = read('public/css/app.css');
    assert.match(app, /@import url\('\.\/cut\.css'\)/);
    assert.match(app, /@import url\('\.\/cut-tracks\.css'\)/);
    const js = read('public/js/components/cut-dock.js');
    assert.ok(js.split('\n').length <= 500);
    assert.doesNotMatch(js, /\$watch|x-effect/, 'no watcher over the board');
    assert.match(read('public/js/app.js'), /Alpine\.data\('CutDock', CutDock\)/);
    // Keys pressed inside the dock never reach the board (Delete, Space, Ctrl+Z): onKeyDown returns first.
    const keys = read('public/js/board/cards.js');
    const onKeyDown = keys.slice(keys.indexOf('async onKeyDown(event) {')).split('\n').slice(1, 4).join('\n');
    assert.match(onKeyDown, /if \(event\.target\.closest\?\.\('\.cut-dock'\)\) return;/);
    // One stream: the board's EventSource hands cut events to the dock; a board refresh asks it to refetch.
    assert.match(read('public/js/board/generation.js'), /addEventListener\('cut'.*board:cut/);
    assert.match(read('public/js/board/director.js'), /new CustomEvent\('board:nodes'\)/);
    assert.doesNotMatch(read('src/shared/katana-controls.js') + read('src/shared/cut-lanes.js'), /gundam|rx-78|mobile suit|zeon/i);
});

test('lanes for a fake cut: clips sized by seconds with a 64 px floor, gaps at their planned length', () => {
    const pps = fitScale(900, fakeCut.slots);
    assert.equal(pps, ITEM_MIN_PX / 0.5, 'the 0.5 s clip sets the floor, so the lanes scroll');
    const items = laneLayout(fakeCut.slots, 10);
    assert.deepEqual(items.map((i) => i.w), [60, 82, 75, 80, 91, 64, 5]);
    assert.deepEqual(items.map((i) => i.x), [0, 60, 142, 217, 297, 388, 452]);
    assert.equal(items[3].title, '04 · Flashback');
    assert.equal(items[3].ready, false);
    assert.equal(items[4].export_ms, 21700, 'export time skips the gap');
    assert.equal(fitScale(1000, fakeCut.slots.slice(0, 3)), 1000 / 21.7, 'Fit fills the lane when the floor allows');

    const t = totals(items);
    assert.deepEqual(t, { count: 7, ready: 5, board_ms: 45700, export_ms: 31300 });
    assert.equal(readout(items, fakeCut.clock.total_ms), '5 of 7 beats · 0:31 · 0:45 with gaps');
    assert.equal(readout(laneLayout(fakeCut.slots.slice(0, 3), 10)), '3 of 3 beats · 0:21');
    assert.equal(fmtLength(8200), '0:08.2');
    assert.equal(fmtClock(65_000), '1:05');
});

test('the ruler, beds and waveform follow the same scale; beds pause under gaps', () => {
    const items = laneLayout(fakeCut.slots, 10);
    const ticks = rulerTicks(45_700, 10);
    const majors = ticks.filter((t) => t.major);
    assert.equal(majors[1].x - majors[0].x, 50, 'labels 5 s apart at 10 px/s');
    assert.equal(majors[1].label, '0:05');

    const music = bedSegments(items, 0, 40_000, 10);
    assert.equal(music.length, 5, 'one segment per clip, none under the gaps');
    assert.deepEqual(music[3], { key: items[4].key, x: 297, w: 91, from_ms: 21_700, to_ms: 30_800 });
    assert.deepEqual(music.at(-1).to_ms, 31_300);
    assert.deepEqual(gapBlocks(items).map((g) => g.x), [217, 388]);
    assert.equal(toBoardMs(items, 21_700), 29_700, 'export 21.7 s sits after the 8 s gap');

    const path = wavePath([0, 1, 0.5]);
    assert.equal(path.match(/M/g).length, 3, 'one path, one bar each');
    assert.equal(waveWindow(music[0], 40_000, 80), '0 0 12 100');
});

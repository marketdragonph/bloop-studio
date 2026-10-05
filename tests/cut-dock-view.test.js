// The Cut dock (Mini Katana P1 + P2): the board page carries one dock with registry labels and data-control
// marks, its CSS keeps the house rules, the lane geometry for a fake cut is pinned, and (P2) the dock's own
// methods run against fakes: slots from node events, keys scoped to the dock, snapshot undo/redo, the autosave
// with a 409 and the save after it, reload vs banner on a cut event, and Fill the cut. P3 (export, pack) is in
// cut-export-view.test.js; the shared fakes are in cut-dock-fakes.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { CONTROLS, controlLabel } from '../src/shared/katana-controls.js';
import {
    ITEM_MIN_PX, bedSegments, fitScale, fmtClock, fmtLength, gapBlocks, laneLayout, readout, rulerTicks,
    toBoardMs, totals, wavePath, waveWindow,
} from '../src/shared/cut-lanes.js';
import { fakeCut, fakeDock, flush, key, read, renderBoard, respond, root, store, stored, withItems } from './cut-dock-fakes.js';

const CUT_VIEWS = 'src/server/views/pages/spaces/cut/';
const DOCK_JS = ['cut-dock', 'cut-actions', 'cut-strip', 'cut-history', 'cut-persistence', 'cut-player', 'cut-bed-sync', 'cut-export', 'cut-turn', 'cut-measure', 'cut-check'];
const cutViews = () => readdirSync(new URL(CUT_VIEWS, root)).map((f) => ({ file: f, text: read(CUT_VIEWS + f) }));

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
    assert.match(html, /@keydown="cutOnKey\(\$event\)"/, 'the dock handles its own keys');
    // Folded holds no media: the body (preview videos, beds, lanes) only exists under x-if="cutOpen".
    assert.match(html, /<template x-if="cutOpen">\s*<div class="cut-dock__body"/);
    const body = html.indexOf('<template x-if="cutOpen">');
    const bodyEnd = html.indexOf('aria-live="polite" x-text="cutAnnounce"');
    assert.doesNotMatch(html.slice(dock, body), /<video|<audio/, 'nothing plays in the rail');
    assert.equal(html.slice(body, bodyEnd).match(/<video/g)?.length, 2, 'two stacked videos, A and B');
    assert.equal(html.slice(body, bodyEnd).match(/<audio/g)?.length, 2, 'one bed each for music and voice');
    assert.match(html, /x-data="CutPlayer" data-control="cut.preview"/);
});

test('every control in the dock is marked with a registry id and shows the registry label', async () => {
    const html = await renderBoard();
    const dock = html.slice(html.indexOf('<section class="cut-dock"'));
    const ids = [...dock.matchAll(/data-control="([^"]+)"/g)].map((m) => m[1]);
    const known = new Set(CONTROLS.map((c) => c.id));
    for (const id of ids) assert.ok(known.has(id), `${id} is in katana-controls.js`);
    const p2 = CONTROLS.filter((c) => c.surface === 'dock' && ['P1', 'P2'].includes(c.phase)).map((c) => c.id);
    for (const id of p2) assert.ok(ids.includes(id), `${id} is on the page`);
    for (const id of ['cut.goToCard', 'cut.retry', 'cut.askDirector', 'cut.lane.music', 'cut.fit', 'cut.useNewer', 'cut.keepMine', 'cut.restore', 'cut.moveLeft', 'cut.fill']) {
        assert.ok(dock.includes(`>${controlLabel(id)}<`), `${id} label`);
    }
    // Every button in the dock is a marked control (the shared media deck's own keys aside).
    const buttons = (dock.match(/<button\b[^>]*>/g) ?? []).filter((b) => !b.includes('ae-player__key'));
    assert.ok(buttons.length >= 20);
    for (const b of buttons) assert.match(b, /data-control="/, b);
    assert.match(dock, /aria-controls="cut-dock-body"[^>]*:aria-expanded=/);
    // Handles are sliders with a spoken time; joins say which clips they join; the level is a native range.
    assert.equal(dock.match(/class="cut-handle cut-handle--(in|out)" role="slider" tabindex="0"/g)?.length, 2);
    assert.match(dock, /:aria-valuetext="cutHandleText\(item, 'in'\)"/);
    assert.match(dock, /class="cut-join"[^>]*:aria-label="cutJoinLabel\(item\)"/s);
    assert.match(dock, /type="range" step="1"/);
    assert.match(dock, /:aria-valuetext="cutLevelText\('music'\)"/);
    // P3 and P4 keys are on the page; no unshipped keys (Katana, shapes) and nothing that starts a render.
    const built = CONTROLS.filter((c) => c.surface === 'dock' && ['P3', 'P4'].includes(c.phase)).map((c) => c.id);
    for (const id of built) assert.ok(ids.includes(id), `${id} is on the page`);
    for (const id of ['cut.openKatana', 'cut.shapes', 'cut.captions', 'cut.gif']) assert.ok(!ids.includes(id), `${id} waits for its phase`);
    assert.doesNotMatch(dock, /generate\(/);
});

test('the dock templates, CSS and scripts keep the house rules', () => {
    for (const { file, text } of cutViews()) {
        assert.doesNotMatch(text, /\sstyle="/, `${file}: no inline styles`);
        assert.ok(text.split('\n').length <= 500, `${file} under 500 lines`);
    }
    for (const file of ['public/css/cut.css', 'public/css/cut-tracks.css', 'public/css/cut-edit.css', 'public/css/cut-export.css', 'public/css/cut-director.css']) {
        const css = read(file);
        assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, `${file}: no hex colours`);
        assert.doesNotMatch(css, /rgba?\(|hsla?\(/, `${file}: no raw colours`);
        assert.doesNotMatch(css, /!important/, `${file}: no !important`);
        assert.match(css, /prefers-reduced-motion/, `${file}: reduced motion`);
        assert.ok(css.split('\n').length <= 500);
    }
    const app = read('public/css/app.css');
    for (const css of ['cut', 'cut-tracks', 'cut-edit', 'cut-export', 'cut-director']) assert.match(app, new RegExp(`@import url\\('\\./${css}\\.css'\\)`));
    for (const name of DOCK_JS) {
        const js = read(`public/js/components/${name}.js`);
        assert.ok(js.split('\n').length <= 500, `${name} under 500 lines`);
        assert.doesNotMatch(js, /\$watch|x-effect|\bthis\.nodes\b/, `${name}: no watcher over the board, never reads nodes`);
    }
    assert.match(read('public/js/app.js'), /Alpine\.data\('CutDock', CutDock\)/);
    assert.match(read('public/js/app.js'), /Alpine\.data\('CutPlayer', CutPlayer\)/);
    // Keys pressed inside the dock never reach the board (Delete, Space, Ctrl+Z): onKeyDown returns first.
    const keys = read('public/js/board/cards.js');
    const onKeyDown = keys.slice(keys.indexOf('async onKeyDown(event) {')).split('\n').slice(1, 4).join('\n');
    assert.match(onKeyDown, /if \(event\.target\.closest\?\.\('\.cut-dock'\)\) return;/);
    // One stream: the board's EventSource hands cut events to the dock; a board refresh asks it to refetch.
    assert.match(read('public/js/board/generation.js'), /addEventListener\('cut'.*board:cut/);
    assert.match(read('public/js/board/director.js'), /new CustomEvent\('board:nodes'\)/);
    // The preview catches out points by frame and is a hard cut under reduced motion; the save carries CSRF.
    assert.match(read('public/js/components/cut-player.js'), /requestVideoFrameCallback/);
    assert.match(read('public/js/components/cut-player.js'), /prefers-reduced-motion/);
    assert.match(read('public/js/components/cut-persistence.js'), /'X-CSRF-Token': csrfToken\(\)/);
    assert.match(read('public/js/components/cut-persistence.js'), /keepalive/);
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

// ── P2: the dock's own methods against fakes ─────────────────────────────

test('no cut yet: the ready beats stand in read only; a node event updates only its own slot', (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(fakeCut);
    assert.equal(dock.cutDraft, true);
    assert.equal(dock.cutCanFill(), false, 'still loading');
    dock.cutStatus = 'ready';
    assert.equal(dock.cutCanFill(), true);
    assert.equal(dock.cutReadout(), '5 of 7 beats · 0:31 · 0:45 with gaps');
    assert.equal(dock.cutEditable(), null, 'nothing is editable until Fill the cut');
    dock.onCutNode({ nodeId: 14, status: 'generating' });
    assert.equal(dock.cutItems[dock.cutIndex[14]].live, true);
    dock.onCutNode({ nodeId: 14, status: 'failed' });
    assert.equal(dock.cutItems[dock.cutIndex[14]].state, 'failed');
    const before = JSON.stringify(dock.cutItems);
    dock.onCutNode({ nodeId: 999, status: 'generating' });
    assert.equal(JSON.stringify(dock.cutItems), before, 'a card not in the cut costs one lookup, nothing else');
});

test('keys in the dock are the dock\'s: Ctrl+Z undoes the dock, Space plays, arrows move and nudge', async (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([11, 12, 13]));
    dock.cutSelectedKey = 'c:i11';
    const alt = key('ArrowRight', { altKey: true });
    dock.cutOnKey(alt);
    assert.ok(alt.prevented && alt.stopped);
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [12, 11, 13]);
    assert.equal(dock.cutAnnounce, 'Beat 1 moved to position 2');
    dock.cutOnKey(key('ArrowRight', { shiftKey: true }));
    assert.equal(dock.cutModel[1].out_ms, 6050, 'out passes the clip only by the 50 ms slack');
    dock.cutOnKey(key('ArrowLeft', { shiftKey: true }));
    assert.equal(dock.cutModel[1].out_ms, 5950, 'Shift+arrow nudges 0.1 s');
    const undo = key('z', { ctrlKey: true });
    dock.cutOnKey(undo);
    await flush();
    assert.ok(undo.stopped, 'the board never sees it');
    assert.equal(dock.cutModel[1].out_ms, 6050);
    dock.cutOnKey(key('z', { ctrlKey: true }));
    await flush();
    assert.equal(dock.cutModel[1].out_ms, 6000, 'back before both nudges');
    dock.cutOnKey(key('z', { ctrlKey: true }));
    await flush();
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [11, 12, 13], 'undo walks back one step at a time');
    dock.cutOnKey(key('Z', { ctrlKey: true, shiftKey: true }));
    await flush();
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [12, 11, 13], 'Ctrl+Shift+Z redoes');
    let played = 0;
    dock._cutPlayer = { toggle: () => { played++; }, playing: () => false };
    dock.cutOnKey(key(' '));
    assert.equal(played, 1);
    const typing = key('Delete', { target: { closest: (sel) => (sel.includes('input') ? {} : null) } });
    dock.cutOnKey(typing);
    assert.equal(dock.cutModel.length, 3, 'keys typed into the level slider are its own');
});

test('remove, joins and clip sound are each one undo step; remove shows the 8 s Undo line', async (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([11, 12, 13]));
    dock.cutSelectedKey = 'c:i12';
    dock.cutOnKey(key('d'));
    assert.deepEqual(dock.cutModel[1].join, { type: 'dissolve', ms: 500 });
    assert.equal(dock.cutItemLabel(dock.cutItems.find((i) => i.key === 'c:i12')), 'Beat 2, Arrival, 6.0 seconds, dissolve in, selected');
    dock.cutOnKey(key('m'));
    assert.equal(dock.cutModel[1].sound, false);
    dock.cutOnKey(key('Delete'));
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [11, 13]);
    assert.deepEqual(dock.cutRemoved, { title: '02 · Arrival' });
    assert.equal(dock.cutAnnounce, 'Removed 02 · Arrival from the cut');
    dock.cutUndoRemove();
    await flush();
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [11, 12, 13], 'Undo puts it back; the card was never touched');
    assert.equal(dock.cutRemoved, null);
    for (let i = 0; i < 60; i++) dock.cutCommit(`step ${i}`, { items: stored([11, 12, 13]).map((x) => ({ ...x, in_ms: i + 1 })) });
    let undone = 0;
    while (dock._cutHistory.canUndo()) { await dock.cutUndo(); undone++; }
    assert.equal(undone, 50, 'the dock keeps 50 steps');
});

test('autosave: 800 ms after the last change, a 409 adopts the server revision at once, and Keep mine then saves', async (t) => {
    const server = { revision: 5, items: stored([13, 12]), sound: null, settings: { resolution: 1080, fps: 30 }, updated_by: 'person' };
    const { dock, calls } = fakeDock(t, [respond(409, { error: 'This cut changed in another window.', cut: server }), respond(200, { cut: { ...server, revision: 6, items: stored([12, 11]) } })]);
    dock.cutApply(withItems([11, 12]));
    dock.cutSelectedKey = 'c:i11';
    dock.cutMove(1);
    assert.equal(dock.cutSaveState, 'unsaved');
    assert.ok(store.get('bloop-studio:cut:7'), 'kept on this device at once');
    await dock.cutSaveNow();
    const put = calls.find((c) => c.method === 'PUT');
    assert.equal(put.url, '/spaces/7/cut');
    assert.equal(put.headers['X-CSRF-Token'], 'csrf-test');
    assert.equal(put.body.revision, 3);
    assert.deepEqual(put.body.items.map((i) => i.node_id), [12, 11]);
    assert.equal(dock.cutBanner, 'conflict');
    assert.equal(dock.cutRevision, 5, 'the server revision, in the same step');
    assert.equal(dock.cutSaveText(), 'Not saved, kept on this device');
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [12, 11], 'the person\'s cut stays on screen');
    await dock.cutSaveNow();
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 1, 'nothing saves over the other window until the person chooses');

    dock.cutKeepMine();
    await flush();
    const second = calls.filter((c) => c.method === 'PUT')[1];
    assert.equal(second.body.revision, 5, 'Keep mine saves on top of the newer revision');
    assert.equal(dock.cutSaveState, 'saved');
    assert.equal(dock.cutRevision, 6);
    assert.equal(dock.cutBanner, null);
    assert.equal(store.get('bloop-studio:cut:7'), undefined, 'the local draft goes once saved');
});

test('Use the newer version takes the server copy as one undo step; a change during a save is saved again', async (t) => {
    let release;
    const slow = new Promise((resolve) => { release = resolve; });
    const { dock, calls } = fakeDock(t, [slow]);
    dock.cutApply(withItems([11, 12]));
    dock.cutHoldServer({ revision: 8, items: stored([12]) }, 'director');
    assert.equal(dock.cutCopy(dock.cutBanner), 'The Director changed the cut.');
    dock.cutUseNewer();
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [12]);
    assert.equal(dock.cutSaveState, 'saved');
    assert.equal(dock.cutRevision, 8);

    dock.cutSelectedKey = 'c:i12';
    dock.cutToggleSound();
    const saving = dock.cutSaveNow();
    assert.equal(dock.cutSaveState, 'saving');
    dock.cutToggleSound(); // while the first save is in flight
    release(respond(200, { cut: { revision: 9, items: stored([12]) } }));
    await saving;
    assert.equal(dock.cutRevision, 9);
    assert.equal(dock.cutSaveState, 'unsaved', 'the later change goes in the next save');
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 1);
});

test('a cut event: a clean dock reloads (one undo step), a dirty dock keeps its edits and asks; drafts restore', async (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([11, 12]));
    assert.equal(dock._cutHistory.canUndo(), false, 'the first load is not an edit');
    dock.cutReceive({ revision: 4, items: stored([12, 11]), updated_by: 'director' }, { by: 'director' });
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [12, 11]);
    assert.equal(dock.cutBanner, null);
    assert.equal(dock._cutHistory.nextUndoLabel(), 'The Director changed the cut');
    dock.cutReceive({ revision: 4, items: stored([11]) });
    assert.equal(dock.cutModel.length, 2, 'the same revision is ours already');

    dock.cutSelectedKey = 'c:i12';
    dock.cutToggleSound();
    dock.cutReceive({ revision: 5, items: stored([11]) }, { by: 'person' });
    assert.equal(dock.cutBanner, 'conflict');
    assert.equal(dock.cutModel.length, 2);
    assert.equal(dock.cutRevision, 5);

    dock.cutSaveState = 'saving';
    dock.onCutEvent({ spaceId: 7, revision: 6 });
    assert.equal(dock._cutEventWaiting, true, 'our own save\'s event waits for the save');
    dock.onCutEvent({ spaceId: 8, offer: 'replace' });
    assert.equal(dock.cutBanner, 'conflict', 'another space is ignored');

    // A different draft on this device is offered on the next load.
    const next = fakeDock(t).dock;
    store.set('bloop-studio:cut:7', JSON.stringify({ revision: 3, items: stored([11]), sound: null, at: 1 }));
    next.cutApply(withItems([11, 12]));
    assert.equal(next.cutBanner, 'restore');
    next.cutRestoreDraft();
    assert.deepEqual(next.cutModel.map((i) => i.node_id), [11]);
    assert.equal(next.cutSaveState, 'unsaved', 'restored changes save like any edit');
});

test('Fill the cut posts to the draft service with CSRF and its revision, opens the dock once, and undoes in one step', async (t) => {
    const drafted = { revision: 1, items: stored([11, 12, 13]), sound: null, settings: { resolution: 1080, fps: 30 } };
    const { dock, calls } = fakeDock(t, [respond(200, { drafted: true, reason: null, added: 3, missing: [], offer: null, cut: drafted })]);
    dock.cutApply({ ...fakeCut, cut: { ...fakeCut.cut, revision: 0 } });
    await dock.cutFill();
    const post = calls.find((c) => c.method === 'POST');
    assert.equal(post.url, '/spaces/7/cut/draft');
    assert.deepEqual(post.body, { mode: 'fill', revision: 0 });
    assert.equal(post.headers['X-CSRF-Token'], 'csrf-test');
    assert.equal(dock.cutDraft, false);
    assert.equal(dock.cutRevision, 1);
    assert.equal(dock.cutSaveState, 'saved', 'the server already saved the draft');
    assert.equal(dock.cutOpen, true, 'the first draft opens the dock once');
    assert.equal(store.get('bloop-studio:cut-open:7'), '1');
    assert.equal(dock._cutHistory.nextUndoLabel(), 'Fill the cut');
});

test('a save hands back the stored copy: the dock takes it, so a leftover draft with only stamps never asks to restore', async (t) => {
    const saved = stored([12, 11]).map((i) => ({ ...i, join: { type: 'cut' }, placed_by: 'person', person_rev: 4, media_path: `stored/${i.node_id}.mp4` }));
    const { dock } = fakeDock(t, [respond(200, { cut: { revision: 4, items: saved, sound: null } })]);
    dock.cutApply(withItems([11, 12]));
    dock.cutSelectedKey = 'c:i11';
    dock.cutMove(1);
    await dock.cutSaveNow();
    assert.equal(dock.cutSaveState, 'saved');
    assert.equal(dock.cutModel[0].media_path, 'stored/12.mp4', 'the server\'s copy is the one on screen');
    assert.equal(dock.cutModel[0].person_rev, 4);

    // A keepalive save landed but the page closed before the draft was cleared: same cut, no prompt.
    const next = fakeDock(t).dock;
    store.set('bloop-studio:cut:7', JSON.stringify({ revision: 3, items: stored([11, 12]), sound: null, at: 1 }));
    next.cutApply({ ...fakeCut, cut: { ...fakeCut.cut, revision: 4, items: stored([11, 12]).map((i) => ({ ...i, join: { type: 'cut' }, person_rev: 4 })) } });
    assert.equal(next.cutBanner, null);
    assert.equal(store.get('bloop-studio:cut:7'), undefined, 'the stale draft is dropped');
});

test('a refused save (422) says why, out loud and on the rail, and waits for the person', async (t) => {
    const { dock, calls } = fakeDock(t, [respond(422, { error: 'Clip 1 runs past the end of its clip (6 s).' })]);
    dock.cutApply(withItems([11, 12]));
    dock.cutSelectedKey = 'c:i11';
    dock.cutToggleSound();
    await dock.cutSaveNow();
    assert.equal(dock.cutSaveState, 'failed');
    assert.equal(dock.cutSaveError, 'Clip 1 runs past the end of its clip (6 s).');
    assert.equal(dock.cutAnnounce, dock.cutSaveError);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 1, 'no automatic retry of a refusal');
    assert.match(read('src/server/views/pages/spaces/cut/rail.edge'), /x-text="cutSaveError"/);
});

// ── P4: the Director in the dock (behaviour in cut-turn-view.test.js) ─────

test('P4 views: the turn strip, Snap to beats, beat ticks, duck bands, Duck under lines, measuring and Check your cut on the rail', async () => {
    const html = await renderBoard();
    const dock = html.slice(html.indexOf('<section class="cut-dock"'));
    // The strip sits between the rail and the banner, and holds Show edits, Undo turn and one row key per change.
    const strip = dock.slice(dock.indexOf('class="cut-turn"'), dock.indexOf('class="cut-banner'));
    assert.ok(dock.indexOf('class="cut-rail"') < dock.indexOf('class="cut-turn"'));
    assert.match(strip, /x-show="cutTurnShown\(\)"/);
    assert.match(strip, /data-control="cut.turnShow"[\s\S]*aria-controls="cut-turn-list"|aria-controls="cut-turn-list"[^>]*data-control="cut.turnShow"/);
    assert.match(strip, /@click="cutUndoTurn\(\)"[^>]*data-control="cut.undoTurn">[\s\S]*?<span>Undo turn<\/span>/);
    assert.match(strip, /data-control="cut.turnRow"/);
    assert.match(strip, />Show edits</);
    // Rail: the analysis line in sensor blue and Check your cut with its count, opening its own sheet.
    assert.match(dock, /status-light--busy cut-rail__job" x-show="cutMeasuring\(\)"[\s\S]*?x-text="cutMeasuringText\(\)"/);
    assert.match(dock, /@click="cutOpenSheet\('check'\)"\s+data-control="cut.check"/);
    assert.match(dock, /<template x-if="cutSheet === 'check'">/);
    assert.equal(dock.match(/<section class="cut-check" aria-labelledby="cut-check-(rail|export)"/g)?.length, 2, 'one list, in both sheets');
    assert.match(dock, /x-show="check.card" @click="cutCheckCard\(check\)"\s+data-control="cut.goToCard"/);
    assert.match(dock, /class="cut-check__time ae-readout"/);
    // Tracks: Snap to beats in the corner (a toggle, off without measured beats), downbeats, findings on the ruler.
    assert.match(dock, /class="cut-snap" @click="cutSnapToggle\(\)" :aria-pressed=/);
    assert.match(dock, /data-control="cut.snap"[^>]*>Snap to beats</);
    assert.match(dock, /cut-ruler__beat" :class="\{ 'is-down': beat.down \}"/);
    assert.match(dock, /class="cut-ruler__check"/);
    assert.match(dock, /x-text="cutBeatsShort\(\)"/);
    assert.match(dock, /class="cut-speech"/);
    assert.match(dock, /class="cut-duck"/);
    assert.match(dock, /x-text="cutCopy\('laneNotMeasured'\)"/);
    // Duck under lines lives only in the Music level popover: an on/off key, then a −18..−3 dB range.
    assert.equal(dock.match(/data-control="cut.duck"/g)?.length, 1);
    assert.match(dock, /id="cut-duck-input" type="range" step="1"[\s\S]*?:aria-valuetext="cutDuckText\(\)"/);
    // Clips: trim ghosts, the lock mark, the turn mark; the note's tooltip and the details carry the reason.
    assert.match(dock, /cut-trimghost--out" x-show="cutTurnMark\(item\).ghostOut > 0"/);
    assert.match(dock, /x-show="cutTurnMark\(item\).locked">[\s\S]*?cutCopy\('turnLocked'\)/);
    assert.match(dock, /'is-turn': cutTurnMark\(item\).marked/);
    assert.match(dock, /class="cut-note" x-show="item.note" :title="cutTurnWhy\(item\)"/);
    assert.match(dock, /class="cut-details__why" x-show="cutTurnWhy\(cutSelected\(\)\)"/);
    // The Director never gets a render or export key here, and the views never say Generate.
    assert.doesNotMatch(strip, /cutExport|cutRender|Generate/);
    const css = read('public/css/cut-director.css');
    assert.match(css, /\.cut-turn \{[\s\S]*?var\(--sensor\)/, 'the strip is sensor blue');
    assert.match(css, /\.cut-duck \{[\s\S]*?border-top: 1px dashed var\(--sensor\)/, 'duck bands: sensor tint, dashed top');
    assert.match(read('public/css/cut.css'), /\.cut-dock > \.cut-turn \{ grid-row: 2; \}/);
});

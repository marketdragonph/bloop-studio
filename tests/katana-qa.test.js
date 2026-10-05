// bloop's spaces-mini-timeline/04-qa.md cases that apply to the local dock (P5), as Node tests with fakes. The browser
// cases (contrast walker with its dead-token control, page width, clipped text, hit targets, reduced motion, overlap,
// long tasks) run in scratchpad/p5/gate/look-main.cjs and perf-main.cjs; their numbers are in 02-dock.md §13.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CONTROLS, COPY, EMPTY_TEXT, SLOT_TEXT } from '../src/shared/katana-controls.js';
import { fakeDock, renderBoard, respond, stored } from './cut-dock-fakes.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readyDock(t, ids = [11, 12, 13, 14], replies = []) {
    const { dock, calls } = fakeDock(t, replies);
    dock.cutReceive({ revision: 3, items: stored(ids), sound: null, auto: false });
    dock._cutSlots = ids.map((n) => ({ node_id: n, take_id: 90 + n, state: 'ready', label: `0${n - 10} · Beat` }));
    dock.cutStatus = 'ready';
    dock.cutLayout();
    return { dock, calls };
}

const snap = (dock) => JSON.stringify(dock.cutSnapshot());

// QA-5 "Undo/redo": a 20-step mixed script, 20 undos = the start, 20 redos = the end; the cap keeps 50 of 55.
test('QA-5 undo/redo: 20 mixed steps undo to the start and redo to the end; 50 of 55 steps stay undoable', async (t) => {
    const { dock } = readyDock(t);
    const start = snap(dock);
    const select = (i) => dock.cutSelect(dock.cutItems.filter((x) => x.ready)[i]);
    const steps = [
        () => { select(0); dock.cutNudge('out', -100); }, () => { select(1); dock.cutNudge('in', 100); }, () => { select(1); dock.cutMove(1); },
        () => { select(2); dock.cutToggleSound(); }, () => dock.cutToggleJoin(dock.cutItems.filter((x) => x.ready)[1]),
    ];
    for (let i = 0; i < 20; i++) steps[i % steps.length]();
    const end = snap(dock);
    assert.notEqual(end, start);
    let steps20 = 0;
    while (dock._cutHistory.canUndo()) { await dock.cutUndo(); steps20 += 1; }
    assert.equal(steps20, 20, 'every step of the script is one undo step');
    assert.equal(snap(dock), start, '20 undos = the start snapshot');
    for (let i = 0; i < 20; i++) await dock.cutRedo();
    assert.equal(snap(dock), end, '20 redos = the end snapshot');

    for (let i = 0; i < 55; i++) { select(0); dock.cutNudge('out', i % 2 ? 100 : -100); }
    let undone = 0;
    while (dock._cutHistory.canUndo()) { await dock.cutUndo(); undone += 1; }
    assert.equal(undone, 50, 'the cap is 50 steps');
});

// QA-5 "Debounce": 10 changes inside 500 ms → exactly 1 PUT, about 800 ms after the last change.
test('QA-5 debounce: 10 quick changes make exactly one PUT, about 800 ms after the last', async (t) => {
    const { dock, calls } = readyDock(t, [11, 12], [respond(200, { cut: { revision: 4, items: stored([11, 12]), sound: null } })]);
    const item = dock.cutItems.find((x) => x.ready);
    dock.cutSelect(item);
    const sentAt = [];
    const recorded = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        if (options.method === 'PUT') sentAt.push(Date.now());
        return recorded(url, options);
    };
    let last = 0;
    for (let i = 0; i < 10; i++) { dock.cutNudge('out', i % 2 ? 100 : -100); last = Date.now(); await wait(45); }
    await wait(600);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0, 'nothing before 800 ms');
    await wait(450);
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 1);
    const after = sentAt[0] - last;
    assert.ok(after >= 790 && after <= 1000, `sent ${after} ms after the last change (bar: 800 ± 200)`);
});

// QA-5 "Remove": the board card is never touched; Undo puts the clip back at the same index.
test('QA-5 remove: no request touches the card; Undo puts the clip back where it was', async (t) => {
    const { dock, calls } = readyDock(t);
    const third = dock.cutItems.filter((x) => x.ready)[2];
    dock.cutSelect(third);
    dock.cutRemove();
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [11, 12, 14]);
    assert.match(dock.cutAnnounce, /^Removed 03 · Beat from the cut/);
    assert.equal(dock.cutRemoved.title, '03 · Beat', 'the rail shows the 8 s Undo line');
    assert.ok(!calls.some((c) => /\/nodes\//.test(c.url)), 'no card request');
    dock.cutUndoRemove();
    await wait(0);
    assert.deepEqual(dock.cutModel.map((i) => i.node_id), [11, 12, 13, 14]);
});

// QA-4 "No new poll": an open, idle dock asks the server nothing; the only interval is the player's, while playing.
test('QA-4 no new poll: an idle open dock sends no request, and no dock file polls', async (t) => {
    const { dock, calls } = readyDock(t);
    dock.cutOpen = true;
    const before = calls.length;
    await wait(1200);
    assert.equal(calls.length, before);
    const dir = new URL('../public/js/components/', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.startsWith('cut-'))) {
        const code = readFileSync(new URL(file, dir), 'utf8');
        const intervals = code.match(/setInterval\(/g)?.length ?? 0;
        assert.equal(intervals, file === 'cut-player.js' ? 1 : 0, `${file}: setInterval`);
    }
});

// QA-0 guard "Plain words": no undefined / null / NaN / [object / stderr in any dock word, and ffmpeg is named only
// where the person picks the tool (Settings › Video tools and the export sheet's tools-missing line).
test('QA-0 plain words: the dock copy and the rendered dock hold no code words', async () => {
    const words = [...Object.values(COPY), ...Object.values(EMPTY_TEXT), ...Object.values(SLOT_TEXT), ...CONTROLS.flatMap((c) => [c.label, c.where, c.does])];
    const bad = words.filter((w) => /\bundefined\b|\bnull\b|\bNaN\b|\[object|stderr/i.test(String(w)));
    assert.deepEqual(bad, []);
    const ffmpeg = Object.entries(COPY).filter(([, w]) => /ffmpeg/i.test(w)).map(([k]) => k);
    assert.deepEqual(ffmpeg, ['exportToolsMissing']);
    const html = await renderBoard();
    const dock = html.slice(html.indexOf('<section class="cut-dock"'), html.indexOf('</section>', html.indexOf('<section class="cut-dock"')));
    const text = dock.replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /\bundefined\b|\bNaN\b|\[object|stderr/);
});

// QA-4 "Every state has a way forward": each state in 02-dock.md §5 names a key; every one is a registry control
// with a data-control hook in the views.
test('QA-4 every dock state has its way forward as a real control', () => {
    const WAYS = {
        'No video cards': 'cut.askDirector', 'Plan, nothing rendered': 'cut.goToCard', 'All rendered, cut empty': 'cut.fill',
        'Replace offered': 'cut.replace', 'Load error': 'cut.retry', 'Render failed': 'cut.goToCard', 'Card deleted': 'cut.remove',
        'New take': 'cut.useNewTake', 'Not saved': 'cut.saveRetry', '409': 'cut.useNewer', 'Draft found on load': 'cut.restore',
        'Export preflight': 'cut.export', 'Export unavailable': 'settings.videoTools', 'Exporting': 'cut.exportCancel',
        'Export done': 'cut.showFolder', 'Export stale': 'cut.exportAgain', 'Failed at one clip': 'cut.removeAndExport',
        'Packing done': 'cut.showFolder', 'Several songs brought in (P5)': 'cut.pickSong',
    };
    const ids = new Set(CONTROLS.map((c) => c.id));
    const views = new URL('../src/server/views/', import.meta.url);
    const hooks = readdirSync(views, { recursive: true }).filter((f) => String(f).endsWith('.edge'))
        .map((f) => readFileSync(new URL(String(f).replaceAll('\\', '/'), views), 'utf8')).join('\n');
    const missing = Object.entries(WAYS).filter(([, id]) => !ids.has(id) || !hooks.includes(`data-control="${id}"`)).map(([state, id]) => `${state} → ${id}`);
    assert.deepEqual(missing, []);
});

// QA-8 "Status not colour only": every slot state and every rail state has words.
test('QA-8 status is never colour only: every slot state has words', () => {
    for (const state of ['never_rendered', 'rendering', 'failed', 'card_deleted', 'file_missing', 'unmeasured']) {
        assert.match(SLOT_TEXT[state], /^[a-z]+( [a-z]+)*$/, state);
    }
    for (const key of ['saved', 'saving', 'notSaved', 'conflict', 'exportRunning', 'exportFailed', 'packFailed']) assert.ok(COPY[key], key);
});

// The Cut dock, Mini Katana P3: Export (accent) and Pack on the rail, the export sheet (preflight, Preset, Start,
// progress, end states with a way forward), the pack sheet, Settings › Video tools, and the dock against fakes of
// the backend's routes and the `cut_export` event: Export saves pending edits first, live updates only from the
// stream (one GET when a job ends), Remove it and export again, Cancel, Pack. Nothing starts a render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViews } from '../src/server/views.js';
import { fakeDock, flush, read, renderBoard, respond, store, withItems } from './cut-dock-fakes.js';

test('P3 views: Export (accent) and Pack on the rail, one sheet, the stream relays cut_export, Settings › Video tools', async () => {
    const dock = (await renderBoard()).split('<section class="cut-dock"')[1];
    assert.match(dock, /class="ae-key ae-key--sm ae-key--accent"[^>]*@click="cutOpenSheet\('export'\)" data-control="cut.export"/);
    assert.match(dock, /@board:cut-export\.window="onCutExport\(\$event\.detail\)"/);
    assert.equal(dock.match(/class="cut-sheet" id="cut-sheet"[^>]*role="dialog"/g)?.length, 1);
    assert.match(dock, /class="ae-level cut-sheet__level" role="progressbar"/, 'progress is a level, sensor blue in cut-export.css');
    assert.match(read('public/css/cut-export.css'), /\.cut-sheet__level \{ --ae-level-accent: var\(--sensor\)/);
    assert.match(read('public/js/board/generation.js'), /addEventListener\('cut_export'.*board:cut-export/);
    assert.doesNotMatch(read('public/js/components/cut-export.js'), /setInterval|generate\(/, 'no polling, never a render');
    const views = createViews({ csrfToken: 't' });
    const missing = await views.render('partials/video-tools', { tools: { found: false }, checked: false });
    for (const id of ['settings.videoTools', 'settings.checkAgain', 'settings.chooseFfmpeg']) assert.match(missing, new RegExp(`data-control="${id}"`));
    assert.match(missing, /The video tools are missing/);
    const found = await views.render('partials/video-tools', { tools: { found: true, ready: true, ffmpeg: 'C:/ff/ffmpeg.exe', source: 'bundled', version: 'ffmpeg version n7.1.5', licence: 'LGPL-3.0-or-later', encoders: { video: 'h264_mf', audio: 'aac_mf' } }, checked: true });
    assert.match(found, /Ready[\s\S]*LGPL-3.0-or-later[\s\S]*h264_mf[\s\S]*aac_mf[\s\S]*The video tools work/);
    const notReady = await views.render('partials/video-tools', { tools: { found: true, ready: false, reason: 'Install the Media Feature Pack from Windows Settings.', encoders: {} } });
    assert.match(notReady, /Not ready[\s\S]*Media Feature Pack/);
    assert.match(await views.render('pages/settings', { settings: { configured: {} }, errors: {}, saved: false }), /id="video-tools" hx-get="\/settings\/video-tools"/);
});

test('export: preflight names the skipped beats, Export saves pending edits first, then progress and done come from events', async (t) => {
    const posted = respond(202, { export: { id: 31, status: 'queued', cut_revision: 4 } });
    const { dock, calls } = fakeDock(t, [respond(200, { cut: { ...withItems([11, 12, 13]).cut, revision: 4 } }), posted]);
    dock.cutApply({ ...withItems([11, 12, 13]), findings: [{ code: 'GAP', text: '04 · Flashback has no video yet.', node_id: 14 }] });
    dock.cutStatus = 'ready';
    dock.cutOpenSheet('export');
    assert.equal(dock.cutExportState(), 'preflight');
    assert.deepEqual(dock.cutPreflight().skipped, ['04 · Flashback', '06 · Running']);
    assert.equal(dock.cutCheckTitle(), 'Check your cut · 1');
    assert.equal(dock.cutChecks()[0].target.title, '04 · Flashback', 'Show me finds the beat');
    assert.equal(dock.cutExportBlock(), '');
    dock.cutSelectedKey = 'c:i11';
    dock.cutToggleSound(); // a pending edit: Export must save it first
    dock.cutPickPreset('youtube');
    await dock.cutExportStart();
    assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`), ['PUT /spaces/7/cut', 'POST /spaces/7/cut/exports']);
    const post = calls.at(-1);
    assert.deepEqual(post.body, { preset: 'youtube', revision: 4 });
    assert.equal(post.headers['X-CSRF-Token'], 'csrf-test');
    assert.equal(store.get('bloop-studio:cut-export:7'), '31', 'a reload finds the running export');
    dock.onCutExport({ space_id: 8, export_id: 31, status: 'running', progress: 0.9 });
    assert.equal(dock.cutExport.progress, 0, 'another space\'s event is ignored');
    dock.onCutExport({ space_id: 7, export_id: 31, status: 'running', progress: 0.5, step: 'Joining clip 4 of 6' });
    assert.equal(dock.cutExportText(), 'Joining clip 4 of 6');
    assert.equal(dock.cutExportPercent(), 50);
    assert.equal(dock.cutJobLine('export'), 'Exporting 50%');
    const gets = calls.filter((c) => c.method === 'GET').length;
    dock.onCutExport({ space_id: 7, export_id: 31, status: 'done', progress: 1, bytes: 38_000_000, media_path: 'spaces/7/cuts/last-train-youtube-r4.mp4', node_id: 99 });
    await flush();
    assert.equal(calls.filter((c) => c.method === 'GET').length, gets + 1, 'one GET when the job ends, no polling');
    assert.equal(dock.cutExportState(), 'done');
    assert.match(dock.cutExportText(), /^Your cut is ready · 0:\d\d · 38 MB, saved to your media folder$/);
    assert.equal(dock.cutDownloadUrl(), '/media/spaces/7/cuts/last-train-youtube-r4.mp4?download=last-train-youtube-r4');
    dock.cutRevision = 5;
    assert.equal(dock.cutExportState(), 'stale');
    assert.equal(dock.cutExportText(), 'This export is from an older version of the cut.');
});

test('export: a failed save never exports; a clip that could not be read is removed and exported again; Cancel and Pack', async (t) => {
    const { dock, calls } = fakeDock(t, [respond(500, { error: 'disk' })]);
    dock.cutApply(withItems([11, 12, 13]));
    dock.cutStatus = 'ready';
    dock.cutSelectedKey = 'c:i12';
    dock.cutToggleSound();
    await dock.cutExportStart();
    assert.equal(dock.cutExportState(), 'unsaved');
    assert.equal(dock.cutExportText(), 'The latest changes are not saved yet.');
    assert.ok(!calls.some((c) => c.url.endsWith('/cut/exports')), 'no export of an older revision');

    const replies = [respond(200, { cut: { ...withItems([11, 13]).cut, revision: 4 } }), respond(202, { export: { id: 41 } }), respond(200, { export: { id: 41, status: 'cancelled' } }), respond(202, { export: { id: 50, kind: 'pack' } })];
    const next = fakeDock(t, replies);
    const d2 = next.dock;
    d2.cutApply(withItems([11, 12, 13]));
    d2.cutStatus = 'ready';
    d2.cutExport = { id: 40, status: 'failed', error_beat: 's12', progress: 0.4 };
    assert.equal(d2.cutExportText(), 'The export stopped at 02 · Arrival. That clip could not be read.');
    await d2.cutRemoveAndExport();
    assert.deepEqual(d2.cutModel.map((i) => i.node_id), [11, 13], 'one undo step takes the clip out');
    assert.deepEqual(next.calls.filter((c) => c.method !== 'GET').map((c) => c.method), ['PUT', 'POST']);
    assert.equal(d2.cutExport.id, 41);
    d2.onCutExport({ space_id: 7, export_id: 41, status: 'running', progress: 0.1 });
    await d2.cutExportCancel();
    const del = next.calls.find((c) => c.method === 'DELETE');
    assert.equal(del.url, '/spaces/7/cut/exports/41');
    assert.equal(del.headers['X-CSRF-Token'], 'csrf-test');
    assert.equal(d2.cutExportText(), 'Export cancelled. Nothing was saved.');
    d2.cutPackPrompts = false;
    await d2.cutPackStart();
    assert.equal(next.calls.at(-1).url, '/spaces/7/cut/pack');
    assert.deepEqual(next.calls.at(-1).body, { include_prompts: false });
    d2.onCutExport({ space_id: 7, export_id: 50, kind: 'pack', status: 'running', progress: 0.25 });
    assert.equal(d2.cutJobLine('pack'), 'Packing 25%');
    assert.equal(d2.cutExport.id, 41, 'the pack never touches the export row');
});

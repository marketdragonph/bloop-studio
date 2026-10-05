// The dock, Mini Katana P6 (05-irresistible.md §5.1, §5.3–§5.5), against fakes: the Shape switch places each preview
// video exactly as the export frames it, Crop edits one clip's box in one undo step per drag or key, Captions shows
// the script's lines at their times, and the export sheet sends the presets, shapes, captions (drawn as PNGs), GIF and
// soft bars, then follows the rows of one press as one job. Nothing here exports or renders by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDock, flush, key, read, renderBoard, respond, store, withItems } from './cut-dock-fakes.js';

const { default: CutReframe } = await import('../public/js/components/cut-reframe.js');

/** A preview <video> as cut-shape.js sees it. */
function fakeVideo(index, width = 1920, height = 1080) {
    const vars = new Map();
    return {
        videoWidth: width, videoHeight: height, readyState: 4, dataset: { index: String(index) },
        style: { setProperty: (k, v) => vars.set(k, v), removeProperty: (k) => vars.delete(k) },
        addEventListener() {}, vars,
    };
}

function ready(t, replies = [], ids = [11, 12, 13]) {
    const out = fakeDock(t, replies);
    out.dock.cutApply({
        ...withItems(ids),
        speech: [{ item_id: 'i11', beat_tag: 's11', from_ms: 1000, to_ms: 4000, text: '[VO] The last train leaves at midnight. I am not on it.' }],
    });
    out.dock.cutStatus = 'ready';
    return out;
}

test('P6 views: Shape, Crop and Captions under the preview, the crop box, the caption plate, the sheet\'s rows', async () => {
    const dock = (await renderBoard()).split('<section class="cut-dock"')[1];
    assert.match(dock, /<fieldset class="cut-shape" data-control="cut\.shape">/);
    assert.match(dock, /type="radio" name="cut-shape"/, 'native radios: arrow keys move between shapes');
    assert.match(dock, /data-control="cut\.crop">Crop</);
    assert.match(dock, /class="cut-crop" x-data="CutReframe"/);
    assert.match(dock, /class="cut-crop__box" tabindex="0" role="group" aria-roledescription="crop box" data-control="cut\.cropBox"/);
    assert.match(dock, /class="cut-screen__bars" data-cut-part="bars"/);
    assert.match(dock, /class="cut-caption"[^>]*aria-hidden="true"/);
    assert.match(dock, /:style="cutScreenVars\(\)"/);
    for (const id of ['cut.shapes', 'cut.softBars', 'cut.captions', 'cut.gif']) assert.match(dock, new RegExp(`data-control="${id.replace('.', '\\.')}"`));
    assert.doesNotMatch(dock, /No captions are burned in/);
    assert.match(read('public/js/app.js'), /Alpine\.data\('CutReframe', CutReframe\)/);
    assert.match(read('public/css/app.css'), /@import url\('\.\/cut-shape\.css'\)/);
    const css = read('public/css/cut-shape.css');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|!important|rgb\(/i, 'tokens only');
    assert.match(css, /container-type: inline-size/);
    for (const file of ['public/js/components/cut-shape.js', 'public/js/components/cut-reframe.js', 'public/js/components/cut-outputs.js']) {
        assert.doesNotMatch(read(file), /setInterval|generate\(|cutExportStart\(/, `${file}: no polling, never a render, never an export`);
    }
});

test('Shape: the preview frames each clip as the export does, remembered per viewer; the cut\'s own shape fits', (t) => {
    const { dock } = ready(t);
    assert.equal(dock.cutShapeNow(), '16:9', 'the cut\'s own shape by default');
    const video = fakeVideo(0);
    const entry = dock.cutLay().entries[0];
    dock.cutFrameVideo(video, entry);
    assert.equal(video.dataset.fit, 'fit');
    dock.cutSetShape('9:16');
    assert.equal(store.get('bloop-studio:cut-shape:7'), '9:16');
    assert.equal(dock.cutAnnounce, 'Preview shape 9:16');
    assert.deepEqual(dock.cutScreenVars()['--cut-screen-ratio'], '0.5625');
    dock.cutFrameVideo(video, entry);
    assert.equal(video.dataset.fit, 'crop');
    assert.equal(video.vars.get('--cut-crop-h'), `${Math.round(1080 / 1076 * 100000) / 1000}%`);
    assert.deepEqual(dock.cutClipSizes['s/11.mp4'], { width: 1920, height: 1080 }, 'the sheet learns the size');
    dock.cutSetOutput('soft_bars', true);
    const small = fakeVideo(0, 864, 480);
    dock.cutFrameVideo(small, entry);
    assert.equal(small.dataset.fit, 'bars', 'a crop blown up more than 2× gets soft bars when asked');
    assert.equal(small.vars.size, 0);
    dock.cutSetShape('16:9');
    assert.equal(dock.cutShapePick, null, 'back to the cut\'s own shape');
});

test('Crop: the selected clip under the box, one undo step per key, Home centres, the item carries the box', async (t) => {
    const { dock, calls } = ready(t, [respond(200, { cut: { ...withItems([11, 12, 13]).cut, revision: 4 } })]);
    const seeks = [];
    dock._cutPlayer = { playing: () => false, toggle() {}, exportTime: () => 0, seekExport: (ms) => seeks.push(ms), refresh() {} };
    dock.cutSetShape('9:16');
    dock.cutSelectedKey = 'c:i12';
    dock.cutCropToggle();
    assert.equal(dock.cutCropping(), true);
    assert.deepEqual(seeks, [9000], 'the playhead moves into the selected clip');
    const video = fakeVideo(1);
    dock.cutFrameVideo(video, dock.cutLay().entries.find((e) => e.clip === 1));
    assert.equal(video.dataset.fit, 'whole', 'the whole clip shows under the box');
    assert.deepEqual(dock.cutCropSource, { width: 1920, height: 1080 });
    assert.equal(dock.cutScreenVars()['--cut-screen-ratio'], '1.7778', 'the screen takes the clip\'s shape while cropping');

    const box = Object.assign(dock, CutReframe());
    box.crKey(key('ArrowRight'));
    box.crKey(key('ArrowRight', { shiftKey: true }));
    assert.deepEqual(dock.cutModel[1].frame, { '9:16': { x: 0.62, y: 0.5, scale: 1 } });
    assert.equal(dock.cutAnnounce, 'Crop box at 62 % across, 50 % down');
    box.crKey(key('+'));
    assert.equal(dock.cutModel[1].frame['9:16'].scale, 1.1);
    assert.match(box.crLabel(), /^Crop box for 02 · Arrival in 9:16: 62 % across, 50 % down, 1\.1×\./);
    assert.equal(dock.cutCropHint(), 'Drag the box or use the arrow keys. Home centres it.');
    const undo = key('z', { ctrlKey: true });
    box.crKey(undo);
    assert.ok(!undo.prevented, 'Ctrl+Z goes on to the dock\'s undo');
    await dock.cutUndo();
    assert.equal(dock.cutModel[1].frame['9:16'].scale, 1, 'one undo step per key press');
    box.crKey(key('Home'));
    assert.deepEqual(dock.cutModel[1].frame['9:16'], { x: 0.5, y: 0.5, scale: 1 });
    assert.equal(dock.cutModel[0].frame, undefined, 'other clips untouched');
    await dock.cutSaveNow();
    const put = calls.find((c) => c.method === 'PUT');
    assert.deepEqual(put.body.items[1].frame, { '9:16': { x: 0.5, y: 0.5, scale: 1 } }, 'the box is saved on the item');
    box.crKey(key('Escape'));
    assert.equal(dock.cutCropping(), false);
});

test('Crop: a drag is one undo step, committed on release; a 720p clip warns that the crop is soft', async (t) => {
    const { dock } = ready(t);
    dock._cutPlayer = { playing: () => false, toggle() {}, exportTime: () => 100, seekExport() {}, refresh() {} };
    dock.cutSetShape('9:16');
    dock.cutSelectedKey = 'c:i11';
    dock.cutCropToggle();
    dock.cutCropSource = { width: 1280, height: 720 };
    const box = Object.assign(dock, CutReframe(), { $el: { getBoundingClientRect: () => ({ width: 400, height: 225 }), querySelector: () => null } });
    const target = { setPointerCapture() {} };
    const ev = (x, y) => ({ pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, currentTarget: target, preventDefault() {}, stopPropagation() {} });
    box.crDown(ev(200, 100));
    box.crMove(ev(240, 100));
    box.crMove(ev(300, 100));
    assert.equal(dock.cutModel[0].frame, undefined, 'nothing is committed mid-drag');
    assert.ok(box.crFrame().x > 0.5);
    box.crUp(ev(300, 100));
    assert.ok(dock.cutModel[0].frame['9:16'].x > 0.5);
    assert.equal(box.crLive, null);
    await dock.cutUndo();
    assert.equal(dock.cutModel[0].frame, undefined, 'the whole drag was one step');
    assert.match(dock.cutCropHint(), /^This crop blows the clip up 2\.\d×, so it will look soft\./);
});

test('Captions: the script\'s lines at the measured times, the honest note, and the choice saved in outputs', (t) => {
    const { dock } = ready(t);
    dock.cutCaptionPlan = { default_on: false, why_off: 's11: this clip makes its own sound; its words may not match the script.' };
    assert.equal(dock.cutCaptionsOn(), false, 'off by default when a clip makes its own sound');
    assert.match(dock.cutCaptionWhyOff(), /^s11: this clip makes its own sound/, 'the sheet says why');
    dock.cutCaptionAt(2000);
    assert.deepEqual(dock.cutCaptionLines, []);
    dock.cutCaptionsToggle();
    assert.equal(dock.cutSettings.outputs.captions, 'burned');
    assert.equal(dock.cutSaveState, 'unsaved');
    dock.cutCaptionAt(1100);
    assert.deepEqual(dock.cutCaptionLines, ['The last train leaves at', 'midnight. I am not on it.']);
    dock.cutCaptionAt(4500);
    assert.deepEqual(dock.cutCaptionLines, [], 'nothing after the line');
    assert.match(dock.cutCaptionHint(), /^1 caption from the script\. A clip makes its own sound/);
    assert.equal(dock.cutScreenVars()['--cut-caption-bottom'], '8%');
    dock.cutSetShape('9:16');
    assert.equal(dock.cutScreenVars()['--cut-caption-bottom'], '22%', 'above the platform\'s own buttons');
    dock.cutSetCaptions('off');
    assert.equal(dock.cutSettings.outputs.captions, 'off');
});

test('Captions default on when every captioned clip speaks its own script (the server\'s plan); the choice wins', (t) => {
    const { dock } = ready(t);
    dock.cutApplyMeasure({ speech: [{ item_id: 'i11', from_ms: 1000, to_ms: 4000, text: 'Hi.' }], captions: { default_on: true, why_off: null } });
    assert.equal(dock.cutCaptionsOn(), true, 'on with nothing chosen yet');
    assert.equal(dock.cutCaptionWhyOff(), '');
    assert.equal(dock.cutCaptionHint(), '1 caption from the script.', 'no own-sound caveat for a voiced clip');
    dock.cutSetCaptions('off');
    assert.equal(dock.cutCaptionsOn(), false, 'the person\'s Off wins over the default');
    dock.cutServerCheck = { captions: { default_on: false, why_off: 'x' } };
    dock.cutSetOutput('captions', null);
    assert.equal(dock.cutCaptionsOn(), false, 'the sheet\'s fresh readout wins over the cut\'s');
});

test('the export sheet: platform presets with a length hint, Shapes makes one file each, and the POST carries every choice', async (t) => {
    const { dock, calls } = ready(t, [respond(200, { cut: { ...withItems([11, 12, 13]).cut, revision: 4 } }),
        respond(202, { export: { id: 60, status: 'queued', group_id: 'g1', variant: '9:16' }, exports: [{ id: 60, group_id: 'g1', variant: '9:16' }, { id: 61, group_id: 'g1', variant: '16:9' }] })]);
    assert.deepEqual(dock.cutPresets.map((p) => p.id), ['master', 'youtube', 'tiktok', 'reels', 'shorts']);
    assert.equal(dock.cutPresets.find((p) => p.id === 'reels').note, '9:16 for Instagram Reels.');
    dock.cutPickPreset('tiktok');
    assert.equal(dock.cutSettings.outputs.preset, 'tiktok', 'the last preset per space');
    assert.deepEqual(dock.cutShapesChosen(), ['9:16']);
    assert.equal(dock.cutLengthHint(), '', '18 s fits TikTok');
    dock.cutToggleExportShape('16:9');
    assert.deepEqual(dock.cutExportFiles().map((f) => f.text), ['TikTok · 1080 × 1920', 'Master · 1920 × 1080'], 'the cut\'s own shape is the Master');
    dock.cutToggleExportShape('16:9');
    dock.cutToggleExportShape('9:16');
    assert.equal(dock.cutAnnounce, 'Keep at least one shape: there is always one file.');
    dock.cutToggleExportShape('16:9');
    assert.ok(dock.cutSoftBarsOffered());
    dock.cutLearnSize('s/11.mp4', 864, 480);
    assert.match(dock.cutSoftBarsNote(), /^A crop blows a clip up 4\.\d×/);
    dock.cutToggleGif();
    dock.cutCaptionsToggle();
    globalThis.document.createElement = () => ({
        width: 0, height: 0, toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=',
        getContext: () => ({ measureText: (s) => ({ width: s.length * 26 }), fillRect() {}, fillText() {}, font: '', fillStyle: '' }),
    });
    t.after(() => { delete globalThis.document.createElement; });
    await dock.cutExportStart();
    const post = calls.find((c) => c.url.endsWith('/cut/exports'));
    const images = post.body.captions.images;
    assert.deepEqual({ ...post.body, captions: { ...post.body.captions, images: images.length } }, {
        preset: 'tiktok', revision: 4, shapes: ['16:9', '9:16'], captions: { mode: 'burned', images: 1 }, gif: false, soft_bars: false,
    });
    assert.deepEqual(Object.keys(images[0]), ['id', 'png', 'width', 'height']);
    assert.equal(images[0].id, 'c1', 'one PNG per cue id, as the server makes the cues');
    assert.equal(images[0].png, 'iVBORw0KGgo=', 'base64 without the data: prefix');
    dock.cutLay = () => ({ entries: [], export_ms: 200_000, total_ms: 200_000 });
    dock.cutPreset = 'reels';
    assert.match(dock.cutLengthHint(), /^Reels takes up to 3:00; this cut is 3:20\. It still exports/);
});

test('one press, several files: the sheet stays on the job until the last file, then lists each file', async (t) => {
    const { dock } = ready(t, [respond(200, { cut: { ...withItems([11, 12, 13]).cut, revision: 4 } }),
        respond(202, { export: { id: 70, status: 'queued', group_id: 'g7', variant: '16:9' }, exports: [{ id: 70, group_id: 'g7', variant: '16:9' }, { id: 71, group_id: 'g7', variant: '9:16' }] })]);
    dock.cutSetOutput('shapes', ['16:9', '9:16']);
    await dock.cutExportStart();
    dock.onCutExport({ space_id: 7, export_id: 70, group_id: 'g7', variant: '16:9', status: 'running', progress: 0.5, step: 'Joining clip 2 of 3' });
    assert.equal(dock.cutExportText(), 'File 1 of 2 · 16:9 · Joining clip 2 of 3');
    assert.equal(dock.cutExportPercent(), 25);
    dock.onCutExport({ space_id: 7, export_id: 70, group_id: 'g7', variant: '16:9', status: 'done', progress: 1, media_path: 'spaces/7/cuts/a-master-r4.mp4', bytes: 9_000_000 });
    await flush();
    assert.equal(dock.cutExportState(), 'running', 'one more file to go');
    assert.equal(dock.cutExportPercent(), 50);
    dock.onCutExport({ space_id: 7, export_id: 71, group_id: 'g7', variant: '9:16', status: 'running', progress: 0.2 });
    assert.equal(dock.cutExportText(), 'File 2 of 2 · 9:16');
    dock.onCutExport({ space_id: 7, export_id: 71, group_id: 'g7', variant: '9:16', status: 'done', progress: 1, media_path: 'spaces/7/cuts/a-master-9x16-r4.mp4', bytes: 9_500_000 });
    await flush();
    assert.equal(dock.cutExportState(), 'done');
    assert.match(dock.cutExportText(), /^Your 2 files are ready · 0:\d\d, saved to your media folder$/);
    assert.deepEqual(dock.cutGroupFiles().map((f) => `${f.variant} ${f.media_path} ${f.size}`), [
        '16:9 spaces/7/cuts/a-master-r4.mp4 9 MB', '9:16 spaces/7/cuts/a-master-9x16-r4.mp4 10 MB',
    ]);
});

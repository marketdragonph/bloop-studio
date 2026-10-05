// P6 outputs with a FAKE ffmpeg (05-irresistible.md §5.1–§5.5): one press, one row per shape; the exact crop,
// soft-bars, caption and GIF arguments; the .srt and the GIF beside the file; idempotent presses; Cancel takes the
// whole group; caption pictures refused at the press. Never a real encoder, never the GPU, never a GPL filter.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { toolsFixture } from './cut-tools-fixture.js';
import { ALL_EXPORT_FILTERS, NEVER_FILTERS } from '../src/shared/export-recipes.js';
import { CutEdits } from '../src/server/cut/cut-edits.js';
import { CutInvalidError } from '../src/server/cut/validate-cut.js';
import { outputsReady } from '../src/server/media/video-tools.js';
import { Hono } from 'hono';
import { cutRoutes } from '../src/server/routes/cut.js';

const P6 = 'crop,split,gblur,colorchannelmixer,overlay,palettegen,paletteuse';
const speech = new Map();
const analysis = { cached: (paths) => new Map(paths.filter((p) => speech.has(p)).map((p) => [p, speech.get(p)])) };
let fx;
before(async () => {
    fx = await toolsFixture('bloop-shapes-', { p6: P6, analysis });
    fx.env.encoders = 'h264_mf,aac_mf,aac,gif,mjpeg';
});
after(() => fx.close());

/** A PNG header only (the fake ffmpeg never decodes it): IHDR says width × height. */
const png = (width, height) => {
    const b = Buffer.alloc(33);
    Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(b, 0);
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return `data:image/png;base64,${b.toString('base64')}`;
};
const runs = async (from = 0) => (await fx.calls()).slice(from).filter((c) => !/ffprobe/.test(c.bin) && c.args.includes('-progress'));
/** Filter names in a graph, quote-aware (an enable='between(t,a,b)' holds commas). */
const filterNames = (graph) => graph.replace(/'[^']*'/g, '').split(/[;,]/).map((f) => f.replace(/\[[^\]]*\]/g, '').split('=')[0].trim()).filter(Boolean);
const graphOf = (c) => c.args[c.args.indexOf('-filter_complex') + 1];
/** GET /spaces/:id/cut as the dock reads it (the cut routes on the fixture's repositories). */
const cutGet = async (spaceId) => {
    const app = new Hono();
    app.route('/', cutRoutes({ db: fx.db, spaces: fx.spaces, cuts: fx.cuts, boardCut: fx.boardCut, events: fx.events, analysis, plans: fx.plans }));
    return (await app.request(`/spaces/${spaceId}/cut`)).json();
};
const tmpLeft = async () => (existsSync(join(fx.mediaRoot, '.cut-tmp')) ? readdir(join(fx.mediaRoot, '.cut-tmp')) : []);

/** Two 4 s clips with script cards and measured lines; `voiced`: voice + script wired into each clip. */
async function spoken(name, { voiced = true } = {}) {
    const b = await fx.board(name, ['s1-open', 's2-cup'], { music: false });
    const lines = { 's1-open': '[VO] Here we are.', 's2-cup': '[@ren] Two cups, please.' };
    const spans = { 's1-open': [[500, 2500]], 's2-cup': [[1000, 3000]] };
    for (const [i, item] of b.items.entries()) {
        speech.set(item.media_path, { speech: spans[item.beat_tag] });
        const script = fx.spaces.createNode(b.space.id, { type: 'text', label: `${item.beat_tag} · script`, text_content: lines[item.beat_tag] });
        if (!voiced) continue;
        const voice = fx.spaces.createNode(b.space.id, { type: 'audio', label: `voice ${i}` });
        fx.spaces.connect(b.space.id, script.id, item.node_id);
        fx.spaces.connect(b.space.id, voice.id, item.node_id);
    }
    return b;
}

test('readout: files per shape with hints, captions and why they are off, the soft-bars offer, what the tools make', async () => {
    const b = await spoken('Quiet Market', { voiced: false });
    const res = await fx.send('GET', `/spaces/${b.space.id}/cut/preflight?preset=tiktok&shapes=16:9,9:16,1:1`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.files.map((f) => [f.preset, f.variant, f.label, f.width, f.height]), [
        ['tiktok', '9:16', 'TikTok', 1080, 1920], ['master', '16:9', 'Master', 1920, 1080], ['master', '1:1', 'Master 1:1', 1080, 1080],
    ]);
    assert.equal(body.files[0].line, '1080 × 1920 · 30 fps · about 8 MB · −14 LUFS');
    assert.equal(body.captions.cues.length, 2);
    assert.deepEqual(body.captions.cues.map((c) => [c.id, c.from_ms, c.to_ms, c.lines]), [['c1', 500, 2500, ['Here we are.']], ['c2', 5000, 7000, ['Two cups, please.']]]);
    assert.equal(body.captions.default_on, false);
    assert.equal(body.captions.mode, 'off');
    assert.equal(body.captions.why_off, 's1-open: this clip makes its own sound; its words may not match the script.');
    const cut = await cutGet(b.space.id);
    assert.deepEqual(cut.captions, { default_on: false, why_off: body.captions.why_off }, 'the dock gets the same default before the sheet opens');
    assert.equal(body.soft_bars.offer, true);
    assert.deepEqual(body.soft_bars.clips.map((c) => [c.beat_tag, c.variant, c.upscale]), [['s1-open', '9:16', 2.67], ['s2-cup', '9:16', 2.67]]);
    assert.deepEqual(Object.fromEntries(Object.entries(body.ready_for).map(([k, v]) => [k, v.ready])), { shapes: true, soft_bars: true, captions: true, gif: true, poster: true });
    assert.equal(fx.exportsRepo.list(b.space.id).length, 0, 'the readout makes no row');
});

test('one press, three shapes: 3 × 7 capped steps, the exact crop and caption args, .srt and GIF beside each file', async () => {
    const b = await spoken('Night Market');
    const pre = await (await fx.send('GET', `/spaces/${b.space.id}/cut/preflight?preset=tiktok&shapes=16:9,9:16,1:1`)).json();
    assert.equal(pre.captions.default_on, true, 'voice and script wired into each clip, lines measured');
    assert.equal(pre.captions.mode, 'burned');
    assert.deepEqual((await cutGet(b.space.id)).captions, { default_on: true, why_off: null });
    const from = (await fx.calls()).length;
    const press = { preset: 'tiktok', shapes: ['16:9', '9:16', '1:1'], revision: 1, captions: { mode: 'burned', images: [{ id: 'c1', png: png(900, 160) }, { id: 'c2', png: png(900, 160) }] } };
    const res = await fx.send('POST', `/spaces/${b.space.id}/cut/exports`, press);
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.deepEqual(body.exports.map((e) => [e.preset, e.variant]), [['tiktok', '9:16'], ['master', '16:9'], ['master', '1:1']]);
    assert.ok(body.group_id && body.exports.every((e) => e.group_id === body.group_id));
    assert.equal(body.export.id, body.exports[0].id);
    const rows = [];
    for (const e of body.exports) rows.push(await fx.settle(e.id));
    for (const row of rows) assert.equal(row.status, 'done', row.error);

    const all = await runs(from);
    assert.equal(all.length, 3 * 7, 'per shape: 2 parts, concat, measure, finish, GIF, poster');
    for (const c of all) {
        assert.ok(c.args.includes('-t') && c.args.includes('-fs'), `capped: ${c.args.at(-1)}`);
        for (const flag of ['-vf', '-af', '-filter_complex']) {
            const i = c.args.indexOf(flag);
            if (i < 0) continue;
            for (const f of filterNames(c.args[i + 1])) {
                assert.ok(ALL_EXPORT_FILTERS.includes(f), `filter ${f} is on the licence-safe list`);
                assert.ok(!NEVER_FILTERS.includes(f), `${f} never appears`);
            }
        }
    }
    const [tiktok, master, square] = [0, 1, 2].map((r) => all.slice(r * 7, r * 7 + 7));
    // 9:16 from 1280 × 720: the centred box 404 × 718 at (438, 1), scaled to 1080 × 1920; the caption at the safe line.
    assert.deepEqual(tiktok[0].args.slice(tiktok[0].args.indexOf('-i'), tiktok[0].args.indexOf('-filter_complex')).filter((a, i, l) => l[i - 1] === '-i'), [fx.media.resolve(b.items[0].media_path), join(fx.mediaRoot, '.cut-tmp', `captions-${body.group_id}`, 'c1.png')]);
    assert.equal(graphOf(tiktok[0]), "[0:v]crop=404:718:438:1,scale=1080:1920,setsar=1,fps=30:start_time=0[b0];[1:v]scale=900:160[c0];[b0][c0]overlay=90:1338:enable='between(t,0.500,2.500)'[b1];[b1]format=yuv420p[v]");
    assert.deepEqual(tiktok[0].args.slice(tiktok[0].args.indexOf('-map'), tiktok[0].args.indexOf('-map') + 4), ['-map', '[v]', '-map', '0:a:0']);
    assert.match(graphOf(tiktok[1]), /overlay=90:1338:enable='between\(t,1\.000,3\.000\)'/, 'clip 2: its line at 1–3 s of the part');
    // 16:9 is the cut's own shape: the P3 fit, plus the caption.
    assert.equal(graphOf(master[0]), "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30:start_time=0[b0];[1:v]scale=900:160[c0];[b0][c0]overlay=510:834:enable='between(t,0.500,2.500)'[b1];[b1]format=yuv420p[v]");
    assert.match(graphOf(square[0]), /^\[0:v\]crop=720:720:280:0,scale=1080:1080,.*overlay=90:812:/);
    // The GIF: 6 s from the poster (the middle of the first clip, 2 s), 480 px on the long side, 12 fps, one palette, ≤ 8 MB.
    const gif = tiktok[5];
    assert.equal(gif.args.at(-1).split(/[\\/]/).pop(), 'preview.gif');
    const y = gif.args.indexOf('-y');
    assert.deepEqual(gif.args.slice(y, y + 7), ['-y', '-ss', '2.000', '-t', '6.000', '-i', gif.args[y + 6]]);
    assert.equal(graphOf(gif), '[0:v]fps=12,scale=-2:480:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4[g]');
    assert.equal(gif.args[gif.args.indexOf('-fs') + 1], String(8 * 1024 * 1024));
    assert.ok(gif.args.includes('gif'));
    assert.match(graphOf(master[5]), /scale=480:-2:/, 'landscape GIF: 480 wide');

    // Files: names carry the shape when it is not the preset's own; the .srt and the GIF sit beside each.
    const dir = `spaces/${b.space.id}/cuts`;
    assert.deepEqual(rows.map((r) => r.media_path), [`${dir}/night-market-tiktok-r1.mp4`, `${dir}/night-market-master-r1.mp4`, `${dir}/night-market-master-1x1-r1.mp4`]);
    assert.equal(rows[0].report.srt_path, `${dir}/night-market-tiktok-r1.srt`);
    assert.equal(rows[0].report.gif_path, `${dir}/night-market-tiktok-r1-preview.gif`);
    assert.equal(readFileSync(join(fx.mediaRoot, rows[2].report.srt_path), 'utf8'),
        '1\r\n00:00:00,500 --> 00:00:02,500\r\nHere we are.\r\n\r\n2\r\n00:00:05,000 --> 00:00:07,000\r\nTwo cups, please.\r\n');
    assert.ok(existsSync(join(fx.mediaRoot, rows[1].report.gif_path)));
    assert.deepEqual(rows[0].report.files.map((f) => f.path.split('/').pop()), ['night-market-tiktok-r1.mp4', 'night-market-tiktok-r1-poster.jpg', 'night-market-tiktok-r1.srt', 'night-market-tiktok-r1-preview.gif']);
    assert.deepEqual(rows[0].report.captions, { burned: true, count: 2 });
    assert.equal(rows[0].report.gif.made, true);
    assert.deepEqual(rows.map((r) => fx.spaces.findNode(b.space.id, r.node_id).label), ['Cut · r1 · TikTok', 'Cut · r1 · Master', 'Cut · r1 · Master 1:1']);
    assert.deepEqual(await tmpLeft(), [], 'job folders and the group’s caption pictures are gone');

    // The same press again: the three files, no new process.
    const spawned = fx.spawns();
    const again = await fx.send('POST', `/spaces/${b.space.id}/cut/exports`, press);
    assert.equal(again.status, 200);
    assert.deepEqual((await again.json()).exports.map((e) => e.id), body.exports.map((e) => e.id));
    assert.equal(fx.spawns(), spawned);
    // Captions off is another file: the 9:16 row is made again, without overlays.
    const off = await fx.send('POST', `/spaces/${b.space.id}/cut/exports`, { ...press, shapes: ['9:16'], captions: { mode: 'off' } });
    assert.equal(off.status, 202);
    const [offRow] = (await off.json()).exports;
    assert.equal((await fx.settle(offRow.id)).status, 'done');
    const offRuns = (await runs()).slice(-7);
    assert.ok(!graphOf(offRuns[0]).includes('overlay'), 'no caption overlay');
    assert.ok(existsSync(join(fx.mediaRoot, fx.exportsRepo.find(offRow.id).report.srt_path)), 'the .srt is written every time');
});

test('soft bars: the fit over a blurred, dimmed quarter-size copy (gblur, never boxblur); the person’s box wins', async () => {
    const b = await fx.board('Bars', ['a1', 'a2'], { music: false });
    const cut = fx.cuts.current(b.space.id);
    const items = cut.items.map((i, k) => (k === 1 ? { ...i, frame: { '9:16': { x: 0 } } } : i));
    fx.cuts.save(b.space.id, { items, revision: cut.revision });
    const from = (await fx.calls()).length;
    const res = await fx.send('POST', `/spaces/${b.space.id}/cut/exports`, { preset: 'reels', soft_bars: true, gif: false });
    const { exports } = await res.json();
    assert.deepEqual(exports.map((e) => [e.preset, e.variant]), [['reels', '9:16']]);
    assert.equal((await fx.settle(exports[0].id)).status, 'done');
    const all = await runs(from);
    assert.equal(all.length, 6, 'no GIF asked: 2 parts, concat, measure, finish, poster (no bed: no mix)');
    assert.equal(graphOf(all[0]), '[0:v]split=2[bg][fg];[bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=10,colorchannelmixer=rr=0.55:gg=0.55:bb=0.55,scale=1080:1920[bgd];[fg]scale=1080:1920:force_original_aspect_ratio=decrease[fgs];[bgd][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30:start_time=0[b0];[b0]format=yuv420p[v]');
    assert.match(graphOf(all[1]), /^\[0:v\]crop=404:718:0:1,scale=1080:1920/, 'the box the person moved to the left is kept, no bars');
    assert.ok(!all.some((c) => c.args.some((a) => /boxblur|drawtext|subtitles/.test(a))));
});

test('the press refuses missing or unusable caption pictures with no row and no process', async () => {
    const b = await spoken('Refuse');
    const spawned = fx.spawns();
    const missing = await fx.send('POST', `/spaces/${b.space.id}/cut/exports`, { preset: 'shorts', captions: { mode: 'burned', images: [{ id: 'c1', png: png(900, 160) }] } });
    assert.equal(missing.status, 422);
    assert.deepEqual(await missing.json(), { error: 'The captions were not drawn. Open the export again and press Export.', code: 'captions', beat: null });
    const big = await fx.send('POST', `/spaces/${b.space.id}/cut/exports`, { preset: 'shorts', captions: { mode: 'burned', images: [{ id: 'c1', png: png(900, 160) }, { id: 'c2', png: png(4000, 160) }] } });
    assert.equal(big.status, 422);
    assert.match((await big.json()).error, /Caption c2 is not a picture/);
    const notPng = await fx.send('POST', `/spaces/${b.space.id}/cut/exports`, { preset: 'shorts', captions: { mode: 'burned', images: [{ id: 'c1', png: 'aGVsbG8=' }, { id: 'c2', png: png(9, 9) }] } });
    assert.equal(notPng.status, 422);
    const shapes = await fx.send('POST', `/spaces/${b.space.id}/cut/exports`, { preset: 'master', shapes: ['4:3'] });
    assert.equal(shapes.status, 422);
    assert.equal(fx.exportsRepo.list(b.space.id).length, 0);
    assert.equal(fx.spawns(), spawned);
    assert.deepEqual(await tmpLeft(), []);
});

test('Cancel takes the whole group: the running row is killed, the waiting ones dropped, the pictures swept', async () => {
    const b = await spoken('Cancel Group');
    fx.env.mode = 'hang';
    try {
        const res = await fx.send('POST', `/spaces/${b.space.id}/cut/exports`, {
            preset: 'master', shapes: ['16:9', '9:16', '1:1'], captions: { mode: 'burned', images: [{ id: 'c1', png: png(900, 160) }, { id: 'c2', png: png(900, 160) }] },
        });
        const { exports, group_id: group } = await res.json();
        assert.equal(exports.length, 3);
        assert.ok((await tmpLeft()).includes(`captions-${group}`));
        for (let i = 0; i < 100 && fx.exportsRepo.find(exports[0].id).status !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
        const cancel = await fx.send('DELETE', `/spaces/${b.space.id}/cut/exports/${exports[1].id}`);
        assert.equal(cancel.status, 200);
        const ended = [];
        for (const e of exports) ended.push((await fx.settle(e.id)).status);
        assert.deepEqual(ended, ['cancelled', 'cancelled', 'cancelled']);
        assert.deepEqual(await tmpLeft(), []);
    } finally {
        fx.env.mode = 'ok';
    }
});

test('the cut keeps crop boxes and outputs through a save; a bad box is refused in plain words', async () => {
    const b = await fx.board('Keep', ['k1'], { music: false });
    const edits = new CutEdits({ db: fx.db, cuts: fx.cuts });
    const cut = fx.cuts.current(b.space.id);
    const saved = edits.save(b.space.id, {
        items: [{ ...cut.items[0], frame: { '9:16': { x: 0.12345, fit: 'bars' } } }],
        settings: { outputs: { preset: 'tiktok', shapes: ['9:16', '16:9'], captions: 'burned', caption_text: { k1: ' Fixed words. ' } } }, revision: cut.revision,
    });
    assert.deepEqual(saved.items[0].frame, { '9:16': { x: 0.123, fit: 'bars' } });
    assert.deepEqual(saved.settings.outputs, { preset: 'tiktok', shapes: ['9:16', '16:9'], captions: 'burned', caption_text: { k1: 'Fixed words.' } });
    assert.equal(saved.items[0].person_rev, cut.items[0].person_rev, 'moving a crop box is not an edit of the clip (the lock reads timing only)');
    assert.throws(() => edits.save(b.space.id, { items: [{ ...saved.items[0], frame: { '9:16': { x: 2 } } }], revision: saved.revision }), (e) => e instanceof CutInvalidError && /crop box sits inside the clip/.test(e.message));
    const kept = edits.save(b.space.id, { items: saved.items, settings: { resolution: 1080 }, revision: saved.revision });
    assert.deepEqual(kept.settings.outputs, saved.settings.outputs, 'a save without outputs keeps them');
});

test('outputsReady: a build without palettegen skips only the GIF, in plain words', () => {
    const filters = new Set(['crop', 'split', 'gblur', 'colorchannelmixer', 'overlay', 'paletteuse']);
    const ready = outputsReady(filters, new Set(['gif', 'mjpeg']));
    assert.equal(ready.gif.ready, false);
    assert.equal(ready.gif.reason, 'This build of the video tools has no palettegen, so the GIF is skipped.');
    assert.equal(ready.captions.ready, true);
    assert.equal(outputsReady(new Set(), new Set()).soft_bars.reason, 'This build of the video tools has no split, gblur, colorchannelmixer, overlay, crop, so soft bars are skipped.');
});

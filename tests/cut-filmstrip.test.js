// Filmstrips on the Video lane (2026-10-06): the sheet layout, which frame each tile shows (trims and zoom), the
// windowing, the capped ffmpeg call, and ClipStrips making each sheet once on the tools queue (a fake ffmpeg: no
// real encoder), telling the board when it is made and never retrying a file that failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STRIP, frameAt, sheetSize, stripLayout, stripTiles } from '../src/shared/cut-strips.js';
import { ClipStrips, sheetArgs, stripKey } from '../src/server/cut/clip-strips.js';
import { assertCapped } from '../src/server/media/capped-ffmpeg.js';
import { ToolsQueue } from '../src/server/media/tools-queue.js';

test('the sheet: a frame every 100 ms for short clips, at most 300 frames, 16 to a row', () => {
    assert.deepEqual(stripLayout(5167), { duration_ms: 5167, every_ms: 100, frames: 52, cols: 16, rows: 4, tile_w: 160, tile_h: 90 });
    const long = stripLayout(600_000);
    assert.equal(long.every_ms, 2000);
    assert.ok(long.frames <= STRIP.maxFrames);
    assert.equal(stripLayout(250).cols, 3, 'a short file: one row of what it has');
    assert.equal(frameAt(long, 599_999), long.frames - 1);
});

test('each tile shows the frame under its middle, trims included; only tiles in the window', () => {
    const strip = stripLayout(10_000); // 100 frames
    const h = 90; // a tile is 160 px wide on screen
    const item = { x: 1000, w: 1600, in_ms: 2000, out_ms: 6000 }; // 4 s of the file over 1600 px: 400 px a second
    const tiles = stripTiles(item, strip, { height: h });
    assert.equal(tiles.length, 10);
    // Tile 0's middle is 80 px in: 0.2 s after the in point, 2.2 s into the file: frame 22 (row 1, col 6).
    assert.deepEqual(tiles[0], { k: 0, x: 0, w: 160, bx: -960, by: -90 });
    assert.equal(-tiles[9].bx / 160 + 16 * (-tiles[9].by / 90), frameAt(strip, 2000 + (1520 / 1600) * 4000));
    const windowed = stripTiles(item, strip, { height: h, from: 1500, to: 1900 });
    assert.deepEqual(windowed.map((t) => t.k), [3, 4, 5], 'only the tiles over 1500–1900 px');
    const ragged = stripTiles({ ...item, w: 250 }, strip, { height: h });
    assert.equal(ragged.at(-1).w, 90, 'the last tile is cut to the clip');
    assert.deepEqual(sheetSize(strip, h), { w: 2560, h: 630 });
});

test('the sheet call is capped like every ffmpeg call: an output -t, one image, inside the strips folder', () => {
    const args = sheetArgs('C:/m/clip.mp4', stripLayout(9960), 'C:/m/.bloop-cache/strips/x.part.jpg');
    assert.doesNotThrow(() => assertCapped(args));
    assert.ok(args.includes('fps=1000/100,scale=160:90:force_original_aspect_ratio=increase,crop=160:90,tile=16x7'));
    assert.deepEqual(args.slice(-6), ['-q:v', '5', '-t', '11', '-y', 'C:/m/.bloop-cache/strips/x.part.jpg']);
});

test('ClipStrips: made once on the tools queue, one cut event, read back; a failed file is not tried again', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'bloop-strips-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'spaces'), { recursive: true });
    await writeFile(join(root, 'spaces', 'a.mp4'), 'x');
    const media = { resolve: (p) => join(root, p) };
    const calls = { probe: 0, run: [] };
    const ffmpeg = {
        probe: async (file) => {
            calls.probe += 1;
            if (file.endsWith('bad.mp4')) return { streams: [{ codec_type: 'audio' }], format: { duration: '3' } };
            return { streams: [{ codec_type: 'video' }], format: { duration: '5.2' } };
        },
        run: async (args, options) => {
            assertCapped(args);
            calls.run.push({ args, options });
            await writeFile(args.at(-1), 'jpeg');
            return { stderr: '' };
        },
    };
    const sent = [];
    const strips = new ClipStrips({ ffmpeg, media, queue: new ToolsQueue(), events: { emit: (name, e) => sent.push([name, e]) }, log: { warn() {} } });

    assert.equal((await strips.many(['spaces/a.mp4'])).size, 0);
    assert.equal(await strips.ensureAll(7, ['spaces/a.mp4', 'spaces/a.mp4', 'spaces/bad.mp4'], 4), 1);
    assert.equal(calls.run.length, 1, 'one sheet, one ffmpeg call');
    assert.equal(calls.run[0].options.outputDir, join(root, STRIP.dir));
    assert.deepEqual(sent.map(([name, e]) => [name, e.spaceId, e.by, e.strips]), [['cut', 7, 'analysis', 1]]);
    const key = stripKey('spaces/a.mp4');
    assert.equal(await readFile(join(root, STRIP.dir, `${key}.jpg`), 'utf8'), 'jpeg');

    const fresh = new ClipStrips({ ffmpeg, media, queue: new ToolsQueue(), log: { warn() {} } });
    const sheet = (await fresh.many(['spaces/a.mp4'])).get('spaces/a.mp4');
    assert.equal(sheet.url, `/media/.bloop-cache/strips/${key}.jpg`, 'read back from disk by a new session');
    assert.equal(sheet.frames, 52);

    const probes = calls.probe;
    assert.equal(await strips.ensureAll(7, ['spaces/a.mp4', 'spaces/bad.mp4']), 0);
    assert.equal(calls.probe, probes, 'made and failed files are not probed again');
});

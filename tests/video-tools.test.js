// Settings › Video tools (01-core.md §9) and the media-tools queue, with the fake ffmpeg (never a real encoder).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { toolsFixture, TOKEN } from './cut-tools-fixture.js';
import { VideoTools, licenceOf, ENCODER_MISSING } from '../src/server/media/video-tools.js';
import { ToolsQueue } from '../src/server/media/tools-queue.js';
import { csrf } from '../src/server/middleware/csrf.js';
import { videoToolsRoutes } from '../src/server/routes/video-tools.js';
import { parseCodecList } from '../src/shared/export-recipes.js';

let fx;
before(async () => { fx = await toolsFixture('bloop-vtools-'); });
after(() => fx.close());

test('the licence comes from the configure line', () => {
    assert.equal(licenceOf('configuration: --enable-version3 --disable-libx264'), 'LGPL-3.0-or-later');
    assert.equal(licenceOf('configuration: --disable-debug'), 'LGPL-2.1-or-later');
    assert.equal(licenceOf('configuration: --enable-gpl --enable-version3'), 'GPL-3.0-or-later');
    assert.equal(licenceOf('configuration: --enable-nonfree'), 'nonfree');
    const names = parseCodecList(' V..... = Video\n ------\n V....D h264_mf   H264 via MediaFoundation\n A....D aac_mf  AAC\n');
    assert.deepEqual([...names], ['h264_mf', 'aac_mf']);
});

test('state: found, version, LGPL, the encoders in use; cached until Check again', async () => {
    const state = await fx.videoTools.check();
    assert.equal(state.found, true);
    assert.equal(state.ready, true, state.reason);
    assert.equal(state.licence, 'LGPL-3.0-or-later');
    assert.equal(state.version, 'ffmpeg version n7.1.5-12');
    assert.deepEqual(state.encoders.video, 'h264_mf');
    assert.deepEqual(state.encoders.audio, 'aac_mf');
    const spawned = fx.spawns();
    await fx.videoTools.state();
    assert.equal(fx.spawns(), spawned, 'cached: no new process');
    fx.env.encoders = 'aac';
    const n = await fx.videoTools.check();
    assert.equal(n.ready, false);
    assert.equal(n.reason, ENCODER_MISSING);
    fx.env.encoders = 'h264_mf,aac_mf,aac';
    await fx.videoTools.check();
});

test('missing tools: a plain reason, never stderr', async () => {
    const tools = new VideoTools({ ffmpeg: { locate: () => ({ ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe', source: 'path' }), info: async () => { throw Object.assign(new Error('spawn ffmpeg.exe ENOENT'), { code: 'ENOENT' }); } } });
    const state = await tools.state();
    assert.equal(state.found, false);
    assert.match(state.reason, /video tools are missing/);
    assert.ok(!/ENOENT/.test(JSON.stringify(state)));
});

test('Choose ffmpeg.exe…: needs ffprobe beside it, saves only a path that works; HTMX gets the row', async () => {
    const saved = { ffmpegPath: '' };
    const settings = { get: (k) => saved[k], update: (v) => Object.assign(saved, v) };
    const tools = new VideoTools({ ffmpeg: fx.ffmpeg, settings });
    const folder = join(fx.dir, 'picked');
    await mkdir(folder, { recursive: true });
    const exe = process.platform === 'win32' ? '.exe' : '';
    await writeFile(join(folder, `ffmpeg${exe}`), '');
    assert.equal((await tools.choose(join(folder, 'notffmpeg.exe'))).ok, false);
    const noProbe = await tools.choose(join(folder, `ffmpeg${exe}`));
    assert.match(noProbe.error, /ffprobe/);
    assert.equal(saved.ffmpegPath, '');
    await writeFile(join(folder, `ffprobe${exe}`), '');
    const ok = await tools.choose(join(folder, `ffmpeg${exe}`));
    assert.equal(ok.ok, true);
    assert.equal(saved.ffmpegPath, join(folder, `ffmpeg${exe}`));

    const rendered = [];
    const views = { render: async (name, locals) => { rendered.push({ name, locals }); return `<div>${locals.tools.ready}</div>`; } };
    let picked = 0;
    const app = new Hono();
    app.use('*', csrf(TOKEN));
    app.route('/settings/video-tools', videoToolsRoutes({ videoTools: tools, views, pickFile: async () => { picked += 1; return null; } }));
    const json = await (await app.request('/settings/video-tools')).json();
    assert.equal(json.tools.found, true);
    const html = await app.request('/settings/video-tools/check', { method: 'POST', headers: { 'HX-Request': 'true', 'x-csrf-token': TOKEN } });
    assert.equal(await html.text(), '<div>true</div>');
    assert.equal(rendered.at(-1).name, 'partials/video-tools');
    assert.equal(rendered.at(-1).locals.checked, true);
    const cancelled = await app.request('/settings/video-tools/choose', { method: 'POST', headers: { 'HX-Request': 'true', 'x-csrf-token': TOKEN } });
    assert.equal(cancelled.status, 200);
    assert.equal(picked, 1);
    assert.equal((await app.request('/settings/video-tools/check', { method: 'POST' })).status, 403);
});

test('the media-tools queue: one at a time, exports ahead of analysis, cancel drops or aborts', async () => {
    const queue = new ToolsQueue();
    const order = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const first = queue.add({ key: 'a1', kind: 'analysis', run: async () => { order.push('a1'); await gate; } });
    const second = queue.add({ key: 'a2', kind: 'analysis', run: async () => order.push('a2') });
    const exp = queue.add({ key: 'e1', kind: 'export', run: async () => order.push('e1') });
    const dropped = queue.add({ key: 'p1', kind: 'pack', run: async () => order.push('p1') });
    assert.equal(queue.position('a1'), 0);
    assert.equal(queue.position('e1'), 1);
    assert.equal(queue.position('p1'), 2);
    assert.equal(queue.cancel('p1'), 'dropped');
    await assert.rejects(dropped, (e) => e.name === 'AbortError');
    release();
    await Promise.all([first, second, exp]);
    assert.deepEqual(order, ['a1', 'e1', 'a2']);

    const running = queue.add({ key: 'r', kind: 'export', run: (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })))) });
    await new Promise((r) => setImmediate(r));
    assert.equal(queue.cancel('r'), 'aborted');
    await assert.rejects(running, (e) => e.name === 'AbortError');
    await queue.drain();
    assert.equal(queue.busy, false);
});

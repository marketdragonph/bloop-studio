// The Mini Katana export (01-core.md §6) with a FAKE ffmpeg: never a real encoder, never the GPU.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toolsFixture } from './cut-tools-fixture.js';
import { recoverToolsJobs, endFor, JobProgress, TIMED_OUT, CLOSED_MESSAGE } from '../src/server/cut/tools-jobs.js';
import { EXPORT_FILTERS } from '../src/shared/export-recipes.js';
import { cutClock } from '../src/shared/cut-clock.js';

let fx;
before(async () => { fx = await toolsFixture('bloop-export-'); });
after(() => fx.close());

/** Every ffmpeg run (not ffprobe, not info) the fake saw, since `from`. */
const runs = async (from = 0) => (await fx.calls()).slice(from).filter((c) => !/ffprobe/.test(c.bin) && c.args.includes('-progress'));
const filterNames = (graph) => graph.split(/[;,]/).map((f) => f.replace(/\[[^\]]*\]/g, '').split('=')[0].trim()).filter(Boolean);
const tmpLeft = async () => (existsSync(join(fx.mediaRoot, '.cut-tmp')) ? readdir(join(fx.mediaRoot, '.cut-tmp')) : []);

test('done: parts, dissolve junctions, concat, mix, loudness, one AAC encode, poster, a new card', async () => {
    const { space, items } = await fx.board('Night Market!', ['s1-open', 's2-turn', 's3-close'], {
        joins: [null, { type: 'dissolve', ms: 750 }, { type: 'dissolve', ms: 500 }],
    });
    const sent = [];
    fx.events.on('cut_export', (u) => sent.push(u));
    const before = (await fx.calls()).length;
    const res = await fx.send('POST', `/spaces/${space.id}/cut/exports`, { preset: 'youtube', revision: 1 });
    assert.equal(res.status, 202);
    const { export: job } = await res.json();
    assert.equal(job.status, 'queued');
    const row = await fx.settle(job.id);
    assert.equal(row.status, 'done', row.error);
    assert.equal(row.media_path, `spaces/${space.id}/cuts/night-market-youtube-r1.mp4`);
    assert.ok(existsSync(join(fx.mediaRoot, row.media_path)));
    assert.equal(row.report.poster_path, `spaces/${space.id}/cuts/night-market-youtube-r1-poster.jpg`);
    assert.ok(existsSync(join(fx.mediaRoot, row.report.poster_path)));
    assert.deepEqual(row.report.skipped, []);
    assert.equal(row.report.loudness.gain_db, 6); // −20 LUFS measured → −14 target; peak −9 + 6 stays under −1.5

    // The card: "Cut · r1 · YouTube", a take with preset 'cut' (never a clip of the next cut).
    const node = fx.spaces.findNode(space.id, row.node_id);
    assert.equal(node.label, 'Cut · r1 · YouTube');
    assert.equal(node.type, 'video');
    const take = fx.db.prepare('SELECT * FROM takes WHERE node_id = ?').get(node.id);
    assert.equal(take.preset, 'cut');
    assert.ok(!fx.boardCut.read(space.id).slots.some((s) => s.node_id === node.id));

    // The steps: 3 bodies + 2 tails + 2 heads, 2 junctions, concat, mix, measure, finish, poster.
    const all = await runs(before);
    const outs = all.map((c) => c.args.at(-1).split(/[\\/]/).pop());
    assert.deepEqual(outs, [
        '01-body.mov', '01-tail.mov', '02-head.mov', '02-body.mov', '02-tail.mov', '03-head.mov', '03-body.mov',
        '01-02-join.mov', '02-03-join.mov', 'joined.mov', 'mixed.mov', 'NUL', 'final.mp4', 'poster.jpg',
    ]);
    for (const c of all) {
        const a = c.args;
        assert.ok(a.includes('-t') && a.includes('-fs'), `capped: ${a.at(-1)}`);
        assert.ok(!a.some((x) => /acrossfade|loudnorm|libx264|aloop|stream_loop/.test(x)), 'no planned-but-broken or GPL filter');
        for (const flag of ['-vf', '-af', '-filter_complex']) {
            const i = a.indexOf(flag);
            if (i >= 0) for (const f of filterNames(a[i + 1])) assert.ok(EXPORT_FILTERS.includes(f), `filter ${f} is on the licence-safe list`);
        }
    }
    const [body] = all;
    assert.ok(body.args.includes('h264_mf') && body.args.includes('pcm_s16le'));
    assert.match(body.args[body.args.indexOf('-vf') + 1], /scale=1920:1080.*fps=30:start_time=0/);
    const junction = all.find((c) => c.args.at(-1).endsWith('01-02-join.mov'));
    assert.equal(junction.args[junction.args.lastIndexOf('-t') + 1], '0.766667'); // 0.75 s on the 30 fps grid
    assert.match(junction.args[junction.args.indexOf('-filter_complex') + 1], /afade=t=out.*afade=t=in.*amix=inputs=2.*apad=whole_dur=0\.766667/);
    const finish = all.find((c) => c.args.at(-1).endsWith('final.mp4'));
    assert.ok(finish.args.includes('aac_mf') && finish.args.includes('volume=6dB'));
    assert.equal(finish.args[finish.args.indexOf('-fs') + 1], String(1536 * 1024 * 1024));
    const total = cutClock(items).total_ms;
    assert.ok(Math.abs(Number(finish.args[finish.args.lastIndexOf('-t') + 1]) * 1000 - total) <= 17, 'total on the clock within half a frame');
    assert.ok(all.find((c) => c.args.at(-1) === 'NUL').args.includes('ebur128=peak=true'));

    // Events: running frames then done with the card; progress never runs backwards.
    const mine = sent.filter((u) => u.exportId === job.id);
    assert.equal(mine.at(-1).status, 'done');
    assert.equal(mine.at(-1).nodeId, node.id);
    const progress = mine.map((u) => u.progress);
    assert.deepEqual(progress, [...progress].sort((a, b) => a - b));
    assert.deepEqual(await tmpLeft(), []);

    // Idempotent: the same revision and preset returns the done export, no new process.
    const spawned = fx.spawns();
    const again = await fx.send('POST', `/spaces/${space.id}/cut/exports`, { preset: 'youtube' });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).export.id, job.id);
    assert.equal(fx.spawns(), spawned);

    // Stale: an edit after the export.
    const cut = fx.cuts.current(space.id);
    fx.cuts.save(space.id, { items: cut.items.slice(0, 2), revision: cut.revision });
    const status = await (await fx.send('GET', `/spaces/${space.id}/cut/exports/${job.id}`)).json();
    assert.equal(status.export.stale, true);
    assert.match(status.export.stale_text, /older version/);
});

test('limits refuse with no row and zero processes', async () => {
    const space = fx.spaces.create({ name: 'Empty' });
    const spawned = fx.spawns();
    const empty = await fx.send('POST', `/spaces/${space.id}/cut/exports`, { preset: 'master' });
    assert.equal(empty.status, 422);
    assert.match((await empty.json()).error, /no clips/);

    const { space: long, items } = await fx.board('Long', ['a'], { music: false, lengths: { a: 590_000 } });
    const two = [...items, { ...items[0], id: 'i2' }];
    fx.cuts.save(long.id, { items: two, revision: 1 });
    const over = await fx.send('POST', `/spaces/${long.id}/cut/exports`, { preset: 'master' });
    assert.equal(over.status, 422);
    const body = await over.json();
    assert.equal(body.code, 'limits');
    assert.match(body.error, /limit is 10:00/);
    assert.equal(fx.spawns(), spawned);
    assert.equal(fx.exportsRepo.list(long.id).length, 0);

    const stale = await fx.send('POST', `/spaces/${long.id}/cut/exports`, { preset: 'master', revision: 1 });
    assert.equal(stale.status, 409);
    const bad = await fx.send('POST', `/spaces/${long.id}/cut/exports`, { preset: 'tiktok' });
    assert.equal(bad.status, 422);
    const noCsrf = await fx.send('POST', `/spaces/${long.id}/cut/exports`, { preset: 'master' }, { token: null });
    assert.equal(noCsrf.status, 403);
});

test('a clip that cannot be read stops the export at that beat; nothing is saved', async () => {
    const { space } = await fx.board('Broken', ['s1-open', 's2-flashback', 's3-close'], { specs: { 's2-flashback': { broken: 'decode' } } });
    const cards = fx.db.prepare('SELECT COUNT(*) AS n FROM space_nodes WHERE space_id = ?').get(space.id).n;
    const { export: job } = await (await fx.send('POST', `/spaces/${space.id}/cut/exports`, { preset: 'master' })).json();
    const row = await fx.settle(job.id);
    assert.equal(row.status, 'failed');
    assert.equal(row.error, 'The export stopped at 02 · Flashback. That clip could not be read.');
    assert.equal(row.error_beat, 's2-flashback');
    assert.equal(row.error_code, 'clip');
    assert.equal(fx.db.prepare('SELECT COUNT(*) AS n FROM space_nodes WHERE space_id = ?').get(space.id).n, cards);
    assert.equal(existsSync(join(fx.mediaRoot, `spaces/${space.id}/cuts`)), false);
    assert.deepEqual(await tmpLeft(), []);

    // A file that ffprobe cannot read stops at ProbeSources the same way.
    const probe = await fx.board('Unreadable', ['s1-open', 's2-gone'], { specs: { 's2-gone': { broken: 'probe' } } });
    const second = await (await fx.send('POST', `/spaces/${probe.space.id}/cut/exports`, { preset: 'master' })).json();
    const end = await fx.settle(second.export.id);
    assert.equal(end.error_beat, 's2-gone');
});

test('cancel kills the running child; the temp folder goes', async () => {
    const { space } = await fx.board('Cancel me', ['a', 'b'], { music: false });
    fx.env.mode = 'hang';
    try {
        const { export: job } = await (await fx.send('POST', `/spaces/${space.id}/cut/exports`, { preset: 'master' })).json();
        for (let i = 0; i < 200 && fx.exportsRepo.find(job.id).status !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
        await new Promise((r) => setTimeout(r, 200)); // inside the hanging ffmpeg now
        const started = Date.now();
        const res = await fx.send('DELETE', `/spaces/${space.id}/cut/exports/${job.id}`);
        assert.equal(res.status, 200);
        const row = await fx.settle(job.id);
        assert.equal(row.status, 'cancelled');
        assert.ok(row.cancel_requested_at);
        assert.ok(Date.now() - started < 5000);
        assert.deepEqual(await tmpLeft(), []);
    } finally {
        fx.env.mode = 'ok';
    }
});

test('a space deleted mid-export stops the job and sweeps', async () => {
    const { space } = await fx.board('Delete me', ['a'], { music: false });
    fx.env.mode = 'hang';
    try {
        const { export: job } = await (await fx.send('POST', `/spaces/${space.id}/cut/exports`, { preset: 'master' })).json();
        for (let i = 0; i < 200 && fx.exportsRepo.find(job.id)?.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
        await new Promise((r) => setTimeout(r, 200));
        fx.spaces.delete(space.id);
        const until = Date.now() + 5000;
        while (fx.queue.busy && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
        assert.equal(fx.queue.busy, false);
        assert.equal(fx.exportsRepo.find(job.id), null);
        assert.deepEqual(await tmpLeft(), []);
    } finally {
        fx.env.mode = 'ok';
    }
});

test('no aac_mf on this PC: native aac is the fallback; no h264_mf: a plain refusal', async () => {
    const { space } = await fx.board('Windows N', ['a'], { music: false });
    fx.env.encoders = 'h264_mf,aac';
    await fx.videoTools.check();
    const before = (await fx.calls()).length;
    const { export: job } = await (await fx.send('POST', `/spaces/${space.id}/cut/exports`, { preset: 'master' })).json();
    assert.equal((await fx.settle(job.id)).status, 'done');
    const finish = (await runs(before)).find((c) => c.args.at(-1).endsWith('final.mp4'));
    assert.ok(finish.args.includes('aac') && !finish.args.includes('aac_mf'));

    fx.env.encoders = 'aac_mf';
    await fx.videoTools.check();
    const other = await fx.board('No h264', ['a'], { music: false });
    const res = await fx.send('POST', `/spaces/${other.space.id}/cut/exports`, { preset: 'master' });
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /Media Feature Pack/);
    fx.env.encoders = 'h264_mf,aac_mf,aac';
    await fx.videoTools.check();
});

test('free disk under 3 × the estimate refuses in plain words', async () => {
    const { space } = await fx.board('Full disk', ['a'], { music: false });
    fx.env.freeBytes = 1000;
    try {
        const res = await fx.send('POST', `/spaces/${space.id}/cut/exports`, { preset: 'master' });
        assert.equal(res.status, 422);
        const body = await res.json();
        assert.equal(body.code, 'disk');
        assert.match(body.error, /needs about .* GB free/);
    } finally {
        delete fx.env.freeBytes;
    }
});

test('app start: jobs left running fail with a plain message, the temp root is swept', async () => {
    const space = fx.spaces.create({ name: 'Crashed' });
    const row = fx.exportsRepo.create(space.id, { kind: 'export', revision: 0, preset: 'master' });
    fx.exportsRepo.update(row.id, { status: 'running' });
    const pack = fx.exportsRepo.create(space.id, { kind: 'pack', revision: 0 });
    await mkdir(join(fx.mediaRoot, '.cut-tmp', `export-${row.id}`), { recursive: true });
    await writeFile(join(fx.mediaRoot, '.cut-tmp', `export-${row.id}`, '01-body.mov'), 'x');
    const ended = await recoverToolsJobs({ exportsRepo: fx.exportsRepo, media: fx.media });
    assert.deepEqual(ended.map((r) => r.id).sort(), [row.id, pack.id].sort());
    assert.equal(fx.exportsRepo.find(row.id).error, CLOSED_MESSAGE.export);
    assert.equal(fx.exportsRepo.find(row.id).status, 'failed');
    assert.equal(fx.exportsRepo.find(pack.id).error, CLOSED_MESSAGE.pack);
    assert.equal(existsSync(join(fx.mediaRoot, '.cut-tmp')), false);
});

test('end states read in plain words', () => {
    assert.equal(endFor(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), 'export').error, TIMED_OUT);
    assert.equal(endFor(Object.assign(new Error('x'), { name: 'AbortError' }), 'export').status, 'cancelled');
    assert.equal(endFor(Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT', syscall: 'spawn ffmpeg' }), 'export').error_code, 'tools');
    assert.equal(endFor(new Error('boom'), 'export').error, 'The export stopped. Nothing was saved.');
    assert.equal(endFor(new Error('boom'), 'export', { gone: true }).error_code, 'gone');
});

// ── The recipe on its own (pure) ──

test('parts sit on the 30 fps grid and add up to the clock total within half a frame', async () => {
    const { layoutParts, secs } = await import('../src/server/cut/export/recipe.js');
    const item = (id, ms, join) => ({ id, in_ms: 0, out_ms: ms, join });
    const cases = [
        [item('a', 4000), item('b', 4000, { type: 'dissolve', ms: 750 }), item('c', 3333, { type: 'dissolve', ms: 500 })],
        [item('a', 1234), item('b', 987), item('c', 2001, { type: 'dissolve', ms: 400 }), item('d', 555, { type: 'dissolve', ms: 1000 })],
        Array.from({ length: 50 }, (_, i) => item(`x${i}`, 1017 + i * 13, i % 3 ? { type: 'dissolve', ms: 333 } : { type: 'cut' })),
    ];
    for (const items of cases) {
        const lay = layoutParts(items);
        const frames = Object.fromEntries([...lay.parts, ...lay.junctions].map((p) => [p.name, p.frames]));
        const sum = lay.order.reduce((a, name) => a + frames[name], 0);
        assert.equal(sum, lay.totalFrames, 'the concat order covers the cut once');
        assert.ok(Math.abs((lay.totalFrames * 1000) / 30 - cutClock(items).total_ms) <= 1000 / 60, 'within half a frame of the clock');
        for (const j of lay.junctions) assert.deepEqual([frames[j.tail], frames[j.head]], [j.frames, j.frames]);
        assert.ok(lay.parts.every((p) => p.frames > 0));
    }
    assert.equal(secs(23), '0.766667');
});

test('the duck envelope: export expression and preview gain agree every 50 ms', async () => {
    const { duckExpr, duckGain, voiceDuckWindows } = await import('../src/shared/cut-sound.js');
    const sound = { music: { node_id: 1, duck: { depth_db: -10 } }, voice: { node_id: 2, start_ms: 2000 } };
    const windows = [...voiceDuckWindows(sound, 3000, 20_000), { from_ms: 50, to_ms: 400 }, { from_ms: 9000, to_ms: 9300 }];
    const expr = duckExpr(windows, -10);
    const evaluate = new Function('t', 'clip', 'max', `return ${expr};`);
    const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    for (let ms = 0; ms <= 12_000; ms += 50) {
        assert.ok(Math.abs(evaluate(ms / 1000, clip, Math.max) - duckGain(windows, -10, ms)) < 1e-3, `at ${ms} ms`);
    }
    assert.ok(Math.abs(duckGain(windows, -10, 3000) - 10 ** (-10 / 20)) < 1e-12);
    assert.equal(duckExpr([], -10), '1');
    assert.deepEqual(voiceDuckWindows({ voice: { start_ms: 0 } }, 3000, 9000), [], 'no duck setting, no duck');
});

test('loudness: one gain, capped by the true-peak ceiling; silence or no summary means not measured', async () => {
    const { parseLoudness, loudnessGain } = await import('../src/server/cut/export/recipe.js');
    const summary = (i, tp) => `x\n[Parsed_ebur128_0 @ 1] Summary:\n  I:  ${i} LUFS\n  Peak: ${tp} dBFS\n`;
    assert.deepEqual(parseLoudness(summary(-20.5, -3.2)), { i: -20.5, tp: -3.2 });
    assert.equal(parseLoudness(summary(-70.0, -90)), null);
    assert.equal(parseLoudness('no summary'), null);
    assert.equal(loudnessGain({ i: -20, tp: -9 }, -14, -1.5).gain_db, 6);
    const capped = loudnessGain({ i: -20, tp: -3 }, -14, -1.5);
    assert.equal(capped.gain_db, 1.5);
    assert.equal(capped.capped, true);
    assert.equal(capped.reached_lufs, -18.5);
    assert.equal(loudnessGain(null, -14, -1.5), null);
});

test('nothing under src/server/cut spawns a process: CappedFfmpeg is the only door', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const walk = async (dir) => (await Promise.all((await readdir(dir, { withFileTypes: true }))
        .map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])))).flat();
    for (const file of await walk(new URL('../src/server/cut', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
        const text = await readFile(file, 'utf8');
        assert.ok(!/child_process|\bspawn\(|execFile/.test(text), `${file} must not spawn`);
    }
});

test('progress frames: at most 4 a second even when every report is a new step; none after close', async () => {
    const frames = [];
    const rows = [];
    const progress = new JobProgress({ row: { id: 9, space_id: 1, kind: 'export' }, exportsRepo: { update: (id, v) => rows.push(v) },
        events: { cutExport: (u) => frames.push({ at: Date.now(), ...u }) } });
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) {
        progress.report(i / 50, `Preparing clip ${i + 1} of 50`);
        await new Promise((r) => setTimeout(r, 20));
    }
    const span = (Date.now() - t0) / 1000;
    for (const f of frames) assert.ok(frames.filter((g) => g.at >= f.at && g.at < f.at + 1000).length <= 4, 'over 4 frames in one second');
    assert.ok(frames.length >= Math.floor(span * 4) - 1, `frames keep flowing (${frames.length} in ${span} s)`);
    progress.report(0.99, 'Last words');
    progress.close();
    const n = frames.length;
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(frames.length, n, 'a closed reporter sends nothing late');
    assert.equal(rows.length, frames.length);
});

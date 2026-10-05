import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CappedFfmpeg, FfmpegRefused, assertCapped, capForSeconds, locateFfmpeg, outputSeconds } from '../src/server/media/capped-ffmpeg.js';

// A fake ffmpeg/ffprobe: a Node script. Never a real encoder. FAKE_MODE picks what it does.
const FAKE = `
const [bin, ...args] = process.argv.slice(2);
const mode = process.env.FAKE_MODE;
if (bin.includes('ffprobe')) {
    if (mode === 'hang') setInterval(() => {}, 1000);
    else process.stdout.write(JSON.stringify({ format: { duration: '4.0' }, streams: [{ codec_type: 'video' }], args }));
} else if (mode === 'hang') {
    process.stdout.write('out_time_us=1000000\\n');
    setInterval(() => {}, 1000);
} else if (mode === 'fail') {
    process.stderr.write('Invalid data found when processing input');
    process.exit(1);
} else {
    process.stdout.write(JSON.stringify(args) + '\\n');
    process.stdout.write('out_time_us=1000000\\nprogress=continue\\nout_time_us=2000000\\n');
    process.stdout.write('out_time_us=4000000\\nprogress=end\\n');
}
`;

let dir;
let fake;
before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bloop-ffmpeg-'));
    fake = join(dir, 'fake-ffmpeg.cjs');
    await writeFile(fake, FAKE);
});
after(() => rm(dir, { recursive: true, force: true }));

/** A runner whose spawn starts the fake script with the binary name it was asked for. */
function runner(mode = 'ok', calls = []) {
    return new CappedFfmpeg({
        getSettingsPath: () => join('C:', 'tools', 'ffmpeg.exe'),
        spawn: (bin, args, opts) => {
            calls.push({ bin, args });
            return spawn(process.execPath, [fake, bin, ...args], { ...opts, env: { ...process.env, FAKE_MODE: mode } });
        },
    });
}

const ok = ['-y', '-i', 'in.mp4', '-c:v', 'libx264', '-t', '4', 'out.mp4'];

test('refuses a call with no output -t', () => {
    assert.throws(() => assertCapped(['-i', 'in.mp4', 'out.mp4']), FfmpegRefused);
    // An input -t (before -i) does not cap the output.
    assert.throws(() => assertCapped(['-t', '4', '-i', 'in.mp4', 'out.mp4']), FfmpegRefused);
    assert.throws(() => assertCapped(['-i', 'in.mp4', '-t', '0', 'out.mp4']), FfmpegRefused);
    assert.throws(() => assertCapped(['-i', 'in.mp4', '-t', 'abc', 'out.mp4']), FfmpegRefused);
    assert.throws(() => assertCapped(['-t', '4', 'out.mp4']), FfmpegRefused); // no input at all
    assert.doesNotThrow(() => assertCapped(ok));
    assert.equal(outputSeconds(ok), 4);
});

test('refuses aloop, -stream_loop and an open apad', () => {
    assert.throws(() => assertCapped(['-stream_loop', '-1', '-i', 'a.mp3', '-t', '9', 'o.m4a']), /stream_loop/);
    assert.throws(() => assertCapped(['-i', 'a.mp3', '-af', 'aloop=loop=-1:size=2e9', '-t', '9', 'o.m4a']), /aloop/);
    assert.throws(() => assertCapped(['-i', 'a.mp3', '-af', 'apad', '-t', '9', 'o.m4a']), /apad/);
    assert.throws(() => assertCapped(['-i', 'a.mp3', '-filter_complex', '[0]apad=packet_size=4096[a]', '-t', '9', 'o.m4a']), /apad/);
    assert.doesNotThrow(() => assertCapped(['-i', 'a.mp3', '-af', 'apad=whole_dur=9', '-t', '9', 'o.m4a']));
    assert.doesNotThrow(() => assertCapped(['-i', 'a.mp3', '-filter_complex', '[0]apad=pad_dur=2,volume=0.5[a]', '-t', '9', 'o.m4a']));
});

test('run throws before spawning anything', () => {
    const calls = [];
    assert.throws(() => runner('ok', calls).run(['-i', 'in.mp4', 'out.mp4']), FfmpegRefused);
    assert.equal(calls.length, 0);
});

test('always adds the caps and reports progress 0..1', async () => {
    const calls = [];
    const seen = [];
    await runner('ok', calls).run(ok, { onProgress: (r) => seen.push(r) });
    const { bin, args } = calls[0];
    assert.match(bin, /ffmpeg\.exe$/);
    assert.deepEqual(args.slice(0, 6), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1']);
    // The caller's args stay in order; -fs and -threads go right before the output file.
    assert.deepEqual(args.slice(6), ['-y', '-i', 'in.mp4', '-c:v', 'libx264', '-t', '4', '-fs', String(capForSeconds(4)), '-threads', '2', 'out.mp4']);
    assert.deepEqual(seen, [0.25, 0.5, 1]);
});

test('an explicit cap wins', async () => {
    const calls = [];
    await runner('ok', calls).run(ok, { capBytes: 12345 });
    const args = calls[0].args;
    assert.equal(args[args.indexOf('-fs') + 1], '12345');
});

test('a timeout kills the process', async () => {
    const started = Date.now();
    await assert.rejects(runner('hang').run(ok, { timeoutMs: 300 }), (e) => e.code === 'ETIMEDOUT');
    assert.ok(Date.now() - started < 5000);
});

test('an AbortSignal cancels the run', async () => {
    const controller = new AbortController();
    const run = runner('hang').run(ok, { timeoutMs: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(run, (e) => e.name === 'AbortError');
    await assert.rejects(runner('ok').run(ok, { signal: AbortSignal.abort() }), (e) => e.name === 'AbortError');
});

test('a failing ffmpeg rejects with its message', async () => {
    await assert.rejects(runner('fail').run(ok), /Invalid data found/);
});

test('probe reads ffprobe JSON from beside ffmpeg', async () => {
    const calls = [];
    const info = await runner('ok', calls).probe('clip.mp4');
    assert.equal(info.format.duration, '4.0');
    assert.match(calls[0].bin, /ffprobe(\.exe)?$/);
    assert.deepEqual(info.args, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', 'clip.mp4']);
});

test('locate: settings, then BLOOP_FFMPEG, then bundled, then the dev vendor copy, then PATH', () => {
    const exe = process.platform === 'win32' ? '.exe' : '';
    const fromSettings = locateFfmpeg({ settingsPath: join('/opt', 'ff', 'ffmpeg'), env: { BLOOP_FFMPEG: '/x/ffmpeg' } });
    assert.equal(fromSettings.source, 'settings');
    assert.equal(fromSettings.ffprobe, join('/opt', 'ff', `ffprobe${exe}`));

    assert.equal(locateFfmpeg({ env: { BLOOP_FFMPEG: '/x/ffmpeg' }, resourcesPath: '/r', exists: () => true }).source, 'env');

    const bundled = locateFfmpeg({ env: {}, resourcesPath: '/r', exists: () => true });
    assert.equal(bundled.source, 'bundled');
    assert.equal(bundled.ffmpeg, join('/r', 'ffmpeg', `ffmpeg${exe}`));

    // The dev app (npm start, scripts/dev-web.mjs): Electron's own resources have no ffmpeg, so the copy
    // npm run fetch:ffmpeg left in <repo>/vendor/ffmpeg is found with no BLOOP_FFMPEG.
    const dev = locateFfmpeg({ env: {}, resourcesPath: '/electron/resources', appRoot: '/repo', exists: (p) => p === join('/repo', 'vendor', 'ffmpeg', `ffmpeg${exe}`) });
    assert.deepEqual([dev.source, dev.ffprobe], ['vendor', join('/repo', 'vendor', 'ffmpeg', `ffprobe${exe}`)]);
    assert.equal(locateFfmpeg({ env: {}, appRoot: '/repo', resourcesPath: '/r', exists: () => true }).source, 'bundled', 'the installed copy wins');

    const path = locateFfmpeg({ env: {}, resourcesPath: '/r', appRoot: '/repo', exists: () => false });
    assert.deepEqual([path.source, path.ffmpeg], ['path', `ffmpeg${exe}`]);
});

// ── P3: temp-dir outputs, the null muxer for analysis, info calls ──

test('an export step may only write inside its temp folder; the null muxer writes nothing', async () => {
    const calls = [];
    const tmp = join(dir, 'job');
    assert.throws(() => runner('ok', calls).run(['-i', 'in.mp4', '-t', '4', join(dir, 'elsewhere.mp4')], { outputDir: tmp }), /temp folder/);
    assert.throws(() => runner('ok', calls).run(['-i', 'in.mp4', '-t', '4', join(tmp, '..', 'escape.mp4')], { outputDir: tmp }), /temp folder/);
    assert.equal(calls.length, 0);
    await runner('ok', calls).run(['-i', 'in.mp4', '-t', '4', join(tmp, 'part.mov')], { outputDir: tmp });
    await runner('ok', calls).run(['-i', 'in.mp4', '-af', 'ebur128=peak=true', '-t', '4', '-f', 'null', 'NUL'], { outputDir: tmp, analysis: true });
    assert.equal(calls.length, 2);
    const analysis = calls[1].args;
    assert.equal(analysis[analysis.indexOf('-loglevel') + 1], 'info');
    assert.ok(analysis.includes('-nostats'));
    // Analysis still needs its output -t, and may not write a file.
    assert.throws(() => runner('ok', calls).run(['-i', 'in.mp4', '-f', 'null', 'NUL'], { analysis: true }), FfmpegRefused);
    assert.throws(() => runner('ok', calls).run(['-i', 'in.mp4', '-t', '4', join(tmp, 'x.wav')], { analysis: true }), /writes no file/);
});

test('info calls: no input allowed, stdout returned', async () => {
    const calls = [];
    await assert.rejects(runner('ok', calls).info(['-i', 'anullsrc', '-version']), FfmpegRefused);
    const out = await runner('ok', calls).info(['-encoders']);
    assert.match(out, /-encoders/);
    assert.deepEqual(calls.at(-1).args, ['-hide_banner', '-encoders']);
    await runner('ok', calls).info(['-version'], { tool: 'ffprobe' });
    assert.match(calls.at(-1).bin, /ffprobe(\.exe)?$/);
});

test('locate: the dev copy in vendor/ffmpeg after the bundled one, never the engine folder', () => {
    const exe = process.platform === 'win32' ? '.exe' : '';
    const dev = locateFfmpeg({ env: {}, resourcesPath: '/r', appRoot: '/app', exists: (p) => p.includes('vendor') });
    assert.equal(dev.source, 'vendor');
    assert.equal(dev.ffmpeg, join('/app', 'vendor', 'ffmpeg', `ffmpeg${exe}`));
    const seen = [];
    locateFfmpeg({ env: {}, resourcesPath: '/r', appRoot: '/app', exists: (p) => { seen.push(p); return false; } });
    assert.ok(seen.every((p) => !/comfy|engine/i.test(p)));
});

test('P6: an input -loop only as -loop 1 on an image with its own -t; the GIF muxer -loop is an output flag', () => {
    const out = ['-t', '2', 'out.mov'];
    assert.doesNotThrow(() => assertCapped(['-i', 'clip.mp4', '-loop', '1', '-t', '2', '-i', 'c1.png', ...out]));
    assert.doesNotThrow(() => assertCapped(['-i', 'final.mp4', '-c:v', 'gif', '-loop', '0', '-t', '6', 'preview.gif']));
    assert.throws(() => assertCapped(['-loop', '1', '-i', 'c1.png', ...out]), /own -t/);
    assert.throws(() => assertCapped(['-loop', '1', '-t', '2', '-i', 'clip.mp4', ...out]), /image input/);
    assert.throws(() => assertCapped(['-loop', '0', '-t', '2', '-i', 'c1.png', ...out]), /-loop 1/);
    assert.throws(() => assertCapped(['-i', 'a.mp4', '-loop', '1', '-i', 'c1.png', ...out]), FfmpegRefused);
});

test('P6 gate fix: a step cap is never under 16 MB (a 0.5 s 1080p junction is ~1.4 MB; -fs used to cut it short)', () => {
    assert.equal(capForSeconds(0.5), 16 * 1024 * 1024);
    assert.equal(capForSeconds(4), 16 * 1024 * 1024);
    assert.equal(capForSeconds(60), 120 * 1024 * 1024);
});

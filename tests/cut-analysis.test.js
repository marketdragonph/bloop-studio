// AnalyzeMedia (03-director.md §5): ffmpeg's stderr parsed into spans, music beats from PCM within ±0.1 s, the
// stages on the media-tools queue through the capped runner with a FAKE ffmpeg (a Node script, never a real
// encoder), the cache keyed by path/size/mtime/version, the tools missing, only what a cut holds is measured, and
// GET /spaces/:id/cut returning the ducks, beats and spoken lines from the same cache. Real ffmpeg: p4 gate only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { headTail, mergeSpans, parseMotion, parseSilence, parseSpeech, PCM_RATE } from '../src/server/analysis/parse.js';
import { analyzeBeats, peaksOf } from '../src/server/analysis/onsets.js';
import { AnalyzeMedia, CutAnalysis, mediaOfCut } from '../src/server/analysis/analyze-media.js';
import { MediaAnalysisRepository } from '../src/server/repositories/media-analysis.js';
import { CappedFfmpeg } from '../src/server/media/capped-ffmpeg.js';
import { ToolsQueue } from '../src/server/media/tools-queue.js';
import { MediaStore } from '../src/server/generation/media-store.js';
import { openDatabase } from '../src/server/db/database.js';
import { cutFixture, TOKEN } from './cut-fixture.js';
import { cutRoutes } from '../src/server/routes/cut.js';
import { csrf } from '../src/server/middleware/csrf.js';

/** 11 kHz mono clicks at `bpm`, every 4th one louder (the downbeat), as s16le. */
function clickTrack(seconds, bpm = 120, offset = 0.25) {
    const n = Math.round(seconds * PCM_RATE);
    const buf = Buffer.alloc(n * 2);
    const period = 60 / bpm;
    for (let k = 0; offset + k * period < seconds; k++) {
        const at = Math.round((offset + k * period) * PCM_RATE);
        const amp = k % 4 === 0 ? 0.9 : 0.4;
        for (let i = 0; i < 220 && at + i < n; i++) buf.writeInt16LE(Math.round(amp * 32767 * Math.sin(i * 0.9) * Math.exp(-i / 60)), (at + i) * 2);
    }
    return buf;
}
const samples = (buf) => Float32Array.from({ length: buf.length / 2 }, (_, i) => buf.readInt16LE(i * 2) / 32768);

test('stderr parsers: silence, spoken lines, still frames, scene changes (the formats real ffmpeg 7.1 prints)', () => {
    const silence = '[silencedetect @ 0000] silence_start: 0\n[silencedetect @ 0000] silence_end: 1.000023 | silence_duration: 1.000023\n[silencedetect @ 0000] silence_start: 3\n';
    assert.deepEqual(parseSilence(silence, 5000), [[0, 1000], [3000, 5000]], 'a start with no end runs to the end');
    const speech = '[silencedetect @ 1] silence_start: 0\n[silencedetect @ 1] silence_end: 1.2\n[silencedetect @ 1] silence_start: 2.0\n[silencedetect @ 1] silence_end: 2.15\n[silencedetect @ 1] silence_start: 3.4\n[silencedetect @ 1] silence_end: 4.8\n';
    assert.deepEqual(parseSpeech(speech, 5000), [[1200, 3400]], 'a breath of 150 ms is one line; the 0.2 s blip at the end is dropped');
    const motion = '[freezedetect @ 2] lavfi.freezedetect.freeze_start: 4\n[freezedetect @ 2] lavfi.freezedetect.freeze_duration: 0.4\n[freezedetect @ 2] lavfi.freezedetect.freeze_end: 4.4\n[freezedetect @ 2] lavfi.freezedetect.freeze_start: 4.4\n[scdet @ 3] lavfi.scd.score: 20.281, lavfi.scd.time: 2\n';
    const parsed = parseMotion(motion, 5000);
    assert.deepEqual(parsed, { still: [[4000, 5000]], scenes: [2000] }, 'a freeze split at EOF is one span');
    assert.deepEqual(headTail([[0, 600], [4400, 5000]], 5000), { still_head: [0, 600], still_tail: [4400, 5000] });
    assert.deepEqual(headTail([[0, 5000]], 5000), { still_head: [0, 5000], still_tail: [0, 5000] }, 'a still clip is both');
    assert.deepEqual(mergeSpans([[0, 100], [150, 300], [900, 950]], { gap: 60, min: 100 }), [[0, 300]]);
});

test('music beats: a 120 BPM click track gives ~120 BPM, beats and downbeats within ±0.1 s, labelled bars', async () => {
    const buf = clickTrack(12);
    const beats = await analyzeBeats(samples(buf));
    assert.ok(Math.abs(beats.bpm - 120) <= 3, `bpm ${beats.bpm}`);
    const expected = Array.from({ length: 23 }, (_, k) => 250 + k * 500);
    for (const ms of beats.beats_ms.slice(1, -1)) assert.ok(expected.some((e) => Math.abs(e - ms) <= 100), `beat at ${ms} ms`);
    assert.ok(beats.beats_ms.length >= 20, `${beats.beats_ms.length} beats`);
    const downs = Array.from({ length: 6 }, (_, k) => 250 + k * 2000);
    for (const ms of beats.downbeats_ms) assert.ok(downs.some((e) => Math.abs(e - ms) <= 100), `downbeat at ${ms} ms`);
    assert.deepEqual(await analyzeBeats(new Float32Array(PCM_RATE * 3)), { bpm: null, beats_ms: [], downbeats_ms: [], onsets_ms: [] }, 'silence: no pulse, no guess');
    // A beatless pad whose chord changes every 2.3 s: without the on-beat share the tracker invented 116 BPM.
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const pad = Float32Array.from({ length: PCM_RATE * 20 }, (_, i) => {
        const t = i / PCM_RATE;
        return 0.3 * Math.sin(2 * Math.PI * (220 + 110 * Math.floor((t / 2.3) % 3)) * t) + 0.02 * noise();
    });
    const still = await analyzeBeats(pad);
    assert.ok(still.onsets_ms.length >= 4, 'the chord changes are onsets');
    assert.deepEqual([still.bpm, still.beats_ms, still.downbeats_ms], [null, [], []], 'no steady beat: no grid, no guess');
    const bars = peaksOf(samples(buf), 12_000);
    assert.equal(bars.bars, 120);
    assert.ok(Math.max(...bars.values) >= 80 && Math.min(...bars.values) === 0);
});

// ── The job, through the capped runner and a fake ffmpeg ──

const FAKE = String.raw`
const fs = require('fs');
const [bin, ...args] = process.argv.slice(2);
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin, args }) + '\n');
const at = args.indexOf('-i');
const input = at >= 0 ? args[at + 1] : args.at(-1);
let spec = {};
try { spec = JSON.parse(fs.readFileSync(input, 'utf8')); } catch {}
if (/ffprobe/.test(bin)) {
    const streams = [];
    if (spec.video !== false) streams.push({ codec_type: 'video', codec_name: 'h264' });
    if (spec.audio !== false) streams.push({ codec_type: 'audio' });
    process.stdout.write(JSON.stringify({ format: { duration: String(spec.duration) }, streams }));
    process.exit(0);
}
const filters = args.join(' ');
const out = args.at(-1);
if (args.includes('s16le')) {
    const n = Math.round(spec.duration * 11025);
    const buf = Buffer.alloc(n * 2);
    for (let k = 0; 0.25 + k * 0.5 < spec.duration; k++) {
        const at = Math.round((0.25 + k * 0.5) * 11025);
        for (let i = 0; i < 220 && at + i < n; i++) buf.writeInt16LE(Math.round((k % 4 ? 0.4 : 0.9) * 32767 * Math.sin(i * 0.9) * Math.exp(-i / 60)), (at + i) * 2);
    }
    fs.writeFileSync(out, buf);
} else if (filters.includes('ebur128')) {
    process.stderr.write('[silencedetect @ 1] silence_start: 3.4\n[Parsed_ebur128_0 @ 0] Summary:\n  Integrated loudness:\n    I:         -19.8 LUFS\n  True peak:\n    Peak:      -3.1 dBFS\n[silencedetect @ 1] silence_end: 5 | silence_duration: 1.6\n');
} else if (filters.includes('highpass')) {
    process.stderr.write('[silencedetect @ 2] silence_start: 0\n[silencedetect @ 2] silence_end: 1.2\n[silencedetect @ 2] silence_start: 3.4\n');
} else if (filters.includes('freezedetect')) {
    process.stderr.write('[freezedetect @ 3] lavfi.freezedetect.freeze_start: 0\n[freezedetect @ 3] lavfi.freezedetect.freeze_end: 0.6\n[freezedetect @ 3] lavfi.freezedetect.freeze_start: 4.4\n[scdet @ 4] lavfi.scd.score: 30, lavfi.scd.time: 2.7\n');
}
process.stdout.write('progress=end\n');
`;

const dirs = [];
after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

async function jobFixture({ missing = false } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'bloop-analysis-'));
    dirs.push(dir);
    const mediaRoot = join(dir, 'media');
    await mkdir(join(mediaRoot, 'clips'), { recursive: true });
    const fake = join(dir, 'fake.cjs');
    await writeFile(fake, FAKE);
    const log = join(dir, 'calls.jsonl');
    let spawns = 0;
    const ffmpeg = new CappedFfmpeg({
        getSettingsPath: () => join(dir, 'tools', 'ffmpeg.exe'),
        spawn: (bin, args, opts) => {
            spawns += 1;
            if (missing) throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT', syscall: 'spawn ffmpeg' });
            return spawn(process.execPath, [fake, bin, ...args], { ...opts, env: { ...process.env, FAKE_LOG: log } });
        },
    });
    const db = openDatabase(':memory:');
    const media = new MediaStore(() => mediaRoot);
    const queue = new ToolsQueue();
    const repo = new MediaAnalysisRepository(db);
    const analysis = new AnalyzeMedia({ ffmpeg, media, repo, queue, log: { warn() {} } });
    const file = (rel, spec) => writeFile(join(mediaRoot, rel), JSON.stringify(spec));
    const calls = async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { dir, mediaRoot, analysis, repo, queue, file, calls, spawns: () => spawns, db };
}

test('a clip: probe → loudness + silence → speech → motion → store, every call capped and writing nothing', async () => {
    const j = await jobFixture();
    await j.file('clips/a.mp4', { duration: 5 });
    const row = await j.analysis.ensure('clips/a.mp4', 'clip');
    assert.equal(row.status, 'done');
    const d = row.data;
    assert.deepEqual([d.duration_ms, d.has_audio, d.has_video], [5000, true, true]);
    assert.deepEqual(d.loudness, { i: -19.8, tp: -3.1 });
    assert.deepEqual([d.silence, d.speech], [[[3400, 5000]], [[1200, 3400]]]);
    assert.deepEqual([d.still, d.still_head, d.still_tail, d.scenes], [[[0, 600], [4400, 5000]], [0, 600], [4400, 5000], [2700]]);
    assert.equal(d.bpm, undefined, 'a clip gets no beats');
    const calls = (await j.calls()).filter((c) => !/ffprobe/.test(c.bin));
    assert.equal(calls.length, 3);
    for (const { args } of calls) {
        assert.ok(args.includes('-t') && args.includes('-fs'), 'output -t and -fs on every call');
        assert.deepEqual(args.slice(-3), ['-threads', '2', 'NUL']);
        assert.equal(args[args.indexOf('-f', args.lastIndexOf('-i')) + 1], 'null');
    }
    // The cache: the same file again runs nothing; a changed file is measured again.
    const before = j.spawns();
    assert.equal((await j.analysis.ensure('clips/a.mp4', 'clip')).id, row.id);
    assert.equal(j.spawns(), before, 'cache hit: no process');
    await j.file('clips/a.mp4', { duration: 5, changed: 'yes, bigger now' });
    await j.analysis.ensure('clips/a.mp4', 'clip');
    assert.equal(j.spawns(), before + 4, 'a changed file: measured again');
});

test('the music bed: one PCM decode in the job folder gives estimated beats and waveform bars; no speech pass', async () => {
    const j = await jobFixture();
    await j.file('clips/bed.mp3', { duration: 12, video: false });
    const { data } = await j.analysis.ensure('clips/bed.mp3', 'music');
    assert.ok(Math.abs(data.bpm - 120) <= 3, `bpm ${data.bpm}`);
    assert.ok(data.downbeats.length >= 5 && data.downbeats.every((ms) => [250, 2250, 4250, 6250, 8250, 10_250].some((e) => Math.abs(e - ms) <= 100)), data.downbeats.join(' '));
    assert.equal(data.peaks.bars, 120);
    assert.deepEqual(data.speech, [], 'a bed\'s "speech" would be the song: not measured');
    const calls = await j.calls();
    assert.equal(calls.filter((c) => c.args.join(' ').includes('highpass')).length, 0);
    const pcm = calls.find((c) => c.args.includes('s16le'));
    assert.match(pcm.args.at(-1).replace(/\\/g, '/'), /\/\.cut-tmp\/analysis-[^/]+\/bed\.pcm$/);
    assert.deepEqual(await readdir(join(j.mediaRoot, '.cut-tmp')), [], 'the job folder is gone after');
});

test('no video tools: nothing is cached, inspect can say so, and a later run with the tools works', async () => {
    const j = await jobFixture({ missing: true });
    await j.file('clips/a.mp4', { duration: 5 });
    assert.equal(await j.analysis.ensure('clips/a.mp4', 'clip'), null);
    assert.equal(j.analysis.toolsMissing, true);
    assert.equal(j.repo.find('clips/a.mp4'), null);
    const map = await j.analysis.waitFor([{ path: 'clips/a.mp4', role: 'clip' }], 100);
    assert.equal(map.size, 0);
});

test('only what a cut holds is measured: the clips, the music and the voice bed, once each, after the cut settles', async () => {
    assert.deepEqual(mediaOfCut({ items: [{ media_path: 'a' }, { media_path: 'a' }, { media_path: 'b' }], sound: { music: { media_path: 'm' }, voice: { media_path: 'v' } } }),
        [{ path: 'a', role: 'clip' }, { path: 'b', role: 'clip' }, { path: 'm', role: 'music' }, { path: 'v', role: 'voice' }]);
    const asked = [];
    const { EventEmitter } = await import('node:events');
    const events = new EventEmitter();
    const cuts = { find: () => ({ items: [{ media_path: 'x.mp4' }], sound: null }) };
    const listener = new CutAnalysis({ events, cuts, analysis: { ensure: (p, r) => asked.push([p, r]) }, debounceMs: 10 }).start();
    events.emit('cut', { spaceId: 1 });
    events.emit('cut', { spaceId: 1 });
    await new Promise((r) => setTimeout(r, 40));
    listener.stop();
    assert.deepEqual(asked, [['x.mp4', 'clip']], 'two saves in a row: one pass');
});

test('GET /spaces/:id/cut: ducks under the measured lines, beat ticks and spoken lines from the same cache', async () => {
    const f = await cutFixture('bloop-analysis-route-');
    try {
        const { space, clips, bed } = f.board('route', ['s1', 's2']);
        const repo = new MediaAnalysisRepository(f.db);
        const analysis = { cached: (paths) => new Map([...repo.many(paths)].map(([p, r]) => [p, r.data])), measuring: () => false, toolsMissing: false };
        const app = new Hono();
        app.use('*', csrf(TOKEN));
        app.route('/', cutRoutes({ ...f, analysis }));
        await app.request(`/spaces/${space.id}/cut/draft`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': TOKEN }, body: '{"mode":"fill"}' });
        const save = (path, data) => repo.save(path, { size: 1, mtimeMs: 1, version: 1, status: 'done', data });
        save(clips.s2.take.media_path, { duration_ms: 4000, speech: [[1000, 2000]] });
        save(bed.take.media_path, { duration_ms: 60_000, bpm: 120, beats: [0, 500, 1000, 1500, 2000, 9000], downbeats: [0, 2000, 9000], peaks: { bars: 2, ms_per_bar: 100, values: [3, 90] } });
        let cut = f.cuts.current(space.id);
        f.cuts.save(space.id, { items: cut.items, sound: { music: { ...cut.sound.music, duck: { depth_db: -10, attack_ms: 120, release_ms: 400 } } }, revision: cut.revision });
        const body = await (await app.request(`/spaces/${space.id}/cut`)).json();
        assert.deepEqual(body.ducks, [{ from_ms: 4000, to_ms: 5000 }], 's2 starts at 3.0 s: its line plays 4.0–5.0 s');
        assert.deepEqual(body.speech, [{ item_id: body.cut.items[1].id, from_ms: 4000, to_ms: 5000, beat_tag: 's2', text: null }]);
        assert.deepEqual([body.beats_ms, body.downbeats_ms, body.bpm], [[0, 500, 1000, 1500, 2000], [0, 2000], 120], 'only beats inside the 7 s cut');
        assert.deepEqual(body.music_peaks.values, [3, 90]);
        assert.deepEqual(body.analysis.unmeasured.map((m) => m.role), ['clip']);
        cut = f.cuts.current(space.id);
        assert.equal(body.turn, null);
        assert.equal(body.analysis.state, 'idle');
    } finally {
        await f.close();
    }
});

test('the dock hears about measuring: a cut event when files start measuring and one when they are done', async () => {
    const { EventEmitter } = await import('node:events');
    const events = new EventEmitter();
    const heard = [];
    events.on('cut', (u) => heard.push(u));
    const waiting = [];
    const finish = () => { pending.clear(); for (const resolve of waiting) resolve(null); };
    const pending = new Set(['a.mp4', 'b.mp4']);
    const analysis = {
        toolsMissing: false,
        measuring: (p) => pending.has(p),
        ensure: () => new Promise((resolve) => waiting.push(resolve)),
    };
    const cuts = { find: () => ({ revision: 7, items: [{ media_path: 'a.mp4' }, { media_path: 'b.mp4' }], sound: null }) };
    const listener = new CutAnalysis({ events, cuts, analysis, debounceMs: 5 }).start();
    events.emit('cut', { spaceId: 3, by: 'person' });
    await new Promise((r) => setTimeout(r, 30));
    finish();
    await new Promise((r) => setTimeout(r, 10));
    listener.stop();
    assert.deepEqual(heard.filter((u) => u.by === 'analysis').map((u) => [u.spaceId, u.revision, u.analysis]), [
        [3, 7, { state: 'measuring', pending: 2 }],
        [3, 7, { state: 'done', pending: 0 }],
    ]);
});

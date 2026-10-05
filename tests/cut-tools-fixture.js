// A board with real files in a temp media folder, the Export and Pack services on the media-tools queue, and a
// FAKE ffmpeg/ffprobe (a Node script, never a real encoder): it writes the output file, prints -progress lines,
// answers -version/-encoders/-filters, prints an ebur128 summary for the null muxer, and logs every call.
// Clip files hold JSON ({duration, audio, video}) that the fake ffprobe reads back.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { JobsRepository } from '../src/server/repositories/jobs.js';
import { DirectorPlans } from '../src/server/repositories/director-plans.js';
import { CutsRepository } from '../src/server/repositories/cuts.js';
import { CutExportsRepository } from '../src/server/repositories/cut-exports.js';
import { BoardCut } from '../src/server/cut/board-cut.js';
import { BoardEvents } from '../src/server/generation/events.js';
import { MediaStore } from '../src/server/generation/media-store.js';
import { CappedFfmpeg } from '../src/server/media/capped-ffmpeg.js';
import { ToolsQueue } from '../src/server/media/tools-queue.js';
import { VideoTools } from '../src/server/media/video-tools.js';
import { CutExporter } from '../src/server/cut/export/index.js';
import { Packer } from '../src/server/cut/pack/index.js';
import { csrf } from '../src/server/middleware/csrf.js';
import { cutExportRoutes } from '../src/server/routes/cut-exports.js';

export const TOKEN = 'c'.repeat(64);

const FAKE = String.raw`
const fs = require('fs');
const [bin, ...args] = process.argv.slice(2);
const mode = process.env.FAKE_MODE || 'ok';
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin, args }) + '\n');
const enc = (process.env.FAKE_ENCODERS || 'h264_mf,aac_mf,aac').split(',').filter(Boolean);
if (/ffprobe/.test(bin)) {
    if (args.includes('-version')) { process.stdout.write('ffprobe version n7.1.5\n'); process.exit(0); }
    const file = args.at(-1);
    let spec;
    try { spec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { process.stderr.write('Invalid data found'); process.exit(1); }
    if (spec.broken === 'probe') { process.stderr.write('moov atom not found'); process.exit(1); }
    const streams = [];
    if (spec.video !== false) streams.push({ codec_type: 'video', width: 1280, height: 720 });
    if (spec.audio !== false) streams.push({ codec_type: 'audio' });
    process.stdout.write(JSON.stringify({ format: { duration: String(spec.duration) }, streams }));
    process.exit(0);
}
if (args.includes('-version')) {
    process.stdout.write('ffmpeg version n7.1.5-12 Copyright (c) 2000-2025\nconfiguration: --enable-version3 ' + (process.env.FAKE_GPL ? '--enable-gpl ' : '') + '--disable-libx264\n');
    process.exit(0);
}
if (args.includes('-encoders')) {
    process.stdout.write(' V..... = Video\n ------\n' + enc.map((e) => ' V....D ' + e + '   some encoder').join('\n') + '\n');
    process.exit(0);
}
if (args.includes('-filters')) {
    const all = 'scale pad setsar fps format aresample aformat apad xfade afade amix atrim asetpts volume adelay ebur128'.split(' ');
    process.stdout.write('Filters:\n' + all.map((f) => ' ..C ' + f + '   V->V   x').join('\n') + '\n');
    process.exit(0);
}
const out = args.at(-1);
const ti = args.lastIndexOf('-t');
const t = ti >= 0 ? Number(args[ti + 1]) : 1;
const inputs = args.filter((a, i) => args[i - 1] === '-i');
if (mode === 'hang') { process.stdout.write('out_time_us=1000\n'); setInterval(() => {}, 1000); return; }
if (inputs.some((i) => { try { return JSON.parse(fs.readFileSync(i, 'utf8')).broken === 'decode'; } catch { return false; } })) {
    process.stderr.write('Error while decoding stream #0:0'); process.exit(1);
}
process.stdout.write('out_time_us=' + Math.round(t * 500000) + '\nprogress=continue\n');
if (out === 'NUL') {
    process.stderr.write('[Parsed_ebur128_0 @ 0] Summary:\n\n  Integrated loudness:\n    I:         -20.0 LUFS\n    Threshold: -30.0 LUFS\n\n  True peak:\n    Peak:       -9.0 dBFS\n');
} else {
    fs.writeFileSync(out, JSON.stringify({ made_by: 'fake', duration: t, video: true, audio: true }));
}
process.stdout.write('out_time_us=' + Math.round(t * 1000000) + '\nprogress=end\n');
`;

export async function toolsFixture(prefix, { zip64 = 'auto' } = {}) {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    const mediaRoot = join(dir, 'media');
    await mkdir(mediaRoot, { recursive: true });
    const fake = join(dir, 'fake-ffmpeg.cjs');
    await writeFile(fake, FAKE);
    const log = join(dir, 'calls.jsonl');
    const env = { mode: 'ok', encoders: 'h264_mf,aac_mf,aac' };
    const db = openDatabase(join(dir, 'test.db'));
    const spaces = new SpacesRepository(db);
    const jobs = new JobsRepository(db);
    const plans = new DirectorPlans(db);
    const cuts = new CutsRepository(db);
    const exportsRepo = new CutExportsRepository(db);
    const events = new BoardEvents();
    const media = new MediaStore(() => mediaRoot);
    const boardCut = new BoardCut({ db });
    let spawns = 0;
    const ffmpeg = new CappedFfmpeg({
        getSettingsPath: () => join(dir, 'tools', 'ffmpeg.exe'),
        spawn: (bin, args, opts) => {
            spawns += 1;
            return spawn(process.execPath, [fake, bin, ...args], {
                ...opts, env: { ...process.env, FAKE_MODE: env.mode, FAKE_LOG: log, FAKE_ENCODERS: env.encoders },
            });
        },
    });
    const videoTools = new VideoTools({ ffmpeg });
    const queue = new ToolsQueue();
    const quiet = { warn() {}, error() {} };
    const statfs = async () => ({ bavail: env.freeBytes ?? 1e12, bsize: 1 });
    const exporter = new CutExporter({ db, cuts, exportsRepo, boardCut, spaces, media, ffmpeg, tools: videoTools, events, queue, statfs, log: quiet });
    const packer = new Packer({ db, cuts, exportsRepo, media, events, queue, statfs, appVersion: '9.9.9', log: quiet, zip64 });
    const app = new Hono();
    app.use('*', csrf(TOKEN));
    app.route('/', cutExportRoutes({ spaces, exporter, packer, exportsRepo }));

    /** A file in the media folder; JSON spec for the fake ffprobe unless `bytes` is given. */
    const file = async (rel, spec = { duration: 4 }, bytes = null) => {
        const full = join(mediaRoot, rel);
        await mkdir(join(full, '..'), { recursive: true });
        await writeFile(full, bytes ?? JSON.stringify(spec));
        return rel;
    };

    /** A rendered card with a measured take whose file exists. */
    const clip = async (spaceId, label, ms = 4000, { type = 'video', mime = 'video/mp4', spec = {}, seed = 7, params = {} } = {}) => {
        const node = spaces.createNode(spaceId, { type, label });
        spaces.updateNode(spaceId, node.id, { settings: { duration: ms / 1000 } });
        const ext = mime.split('/')[1] === 'mpeg' ? 'mp3' : mime.split('/')[1];
        const path = await file(`spaces/${spaceId}/card-${node.id}/take-${Date.now()}.${ext}`, { duration: ms / 1000, ...spec });
        jobs.addTake({ nodeId: node.id, mediaPath: path, mime, preset: 'wan5b', seed, params });
        const take = cuts.takeFor(node.id, path);
        cuts.setTakeDuration(take.id, ms);
        spaces.setNodeResult(node.id, { status: 'done', media_path: path, media_mime: mime });
        return { node, take: cuts.takeFor(node.id, path), path };
    };

    /** A planned board with `tags` beats, each with a clip; the cut holds them all, joined as `joins` says. */
    const board = async (name, tags, { joins = [], music = true, specs = {}, lengths = {} } = {}) => {
        const space = spaces.create({ name });
        const plan = plans.create(space.id, { aspect: '16:9' });
        plans.saveBeats(plan.id, tags.map((tag, i) => ({ tag, lane: i + 1, brief: `brief ${tag}` })));
        const clips = [];
        for (const tag of tags) clips.push(await clip(space.id, tag, lengths[tag] ?? 4000, { spec: specs[tag] ?? {}, params: { prompt: `a shot of ${tag}`, model: 'wan', api_key: 'sk-secret' } }));
        const bed = music ? await clip(space.id, 'music bed', 60_000, { type: 'audio', mime: 'audio/mpeg', spec: { video: false } }) : null;
        const items = clips.map(({ node, take, path }, i) => ({
            id: `i${i + 1}`, node_id: node.id, take_id: take.id, beat_tag: tags[i], media_path: path, seconds_ms: lengths[tags[i]] ?? 4000,
            in_ms: 0, out_ms: lengths[tags[i]] ?? 4000, sound: true, join: joins[i] ?? { type: 'cut' }, placed_by: 'person', person_rev: 0,
        }));
        const sound = bed ? { music: { node_id: bed.node.id, take_id: bed.take.id, media_path: bed.path, gain_db: -12, fade_out_ms: 1500 } } : null;
        cuts.save(space.id, { items, sound, revision: 0 });
        return { space, plan, clips, bed, items };
    };

    const send = (method, path, payload, { token = TOKEN } = {}) => app.request(path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
        body: payload === undefined ? undefined : JSON.stringify(payload),
    });

    /** Every logged fake call: [{bin, args}]. */
    const calls = async () => {
        try {
            return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
        } catch {
            return [];
        }
    };

    /** Resolves with the job row once it ended. */
    const settle = async (id, ms = 15_000) => {
        const until = Date.now() + ms;
        for (;;) {
            const row = exportsRepo.find(id);
            if (!row || ['done', 'failed', 'cancelled'].includes(row.status)) {
                await queue.drain();
                return exportsRepo.find(id);
            }
            if (Date.now() > until) throw new Error(`job ${id} still ${row.status}`);
            await new Promise((r) => setTimeout(r, 20));
        }
    };

    const close = async () => {
        await queue.drain().catch(() => {});
        db.close();
        await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    };

    return {
        dir, mediaRoot, db, spaces, jobs, plans, cuts, exportsRepo, events, media, boardCut, ffmpeg, videoTools, queue,
        exporter, packer, app, env, file, clip, board, send, calls, settle, close, spawns: () => spawns,
    };
}

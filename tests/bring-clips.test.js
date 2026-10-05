// Bring my clips (05-irresistible.md §2.5): uploads are STREAMED to the media folder (never held whole in memory), a
// clip or a sound is a measured take, the single song is the music bed, and the dropped files become the cut in drop
// order with zero renders. Temp media folder and SQLite, fake measurer, no ffmpeg, no GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { cutFixture, TOKEN } from './cut-fixture.js';
import { csrf } from '../src/server/middleware/csrf.js';
import { MediaStore, UploadTooLargeError } from '../src/server/generation/media-store.js';
import { uploadRoutes, fileName } from '../src/server/routes/uploads.js';
import { fakeDock, respond } from './cut-dock-fakes.js';

const { bringOrder, bringRow } = await import('../public/js/components/cut-bring.js');

async function mediaDir(t) {
    const dir = await mkdtemp(join(tmpdir(), 'bloop-bring-media-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
}

test('saveUploadStream writes chunk by chunk to a .part file, renames it when complete, and keeps nothing past the cap', async (t) => {
    const root = await mediaDir(t);
    const media = new MediaStore(() => root);
    let pulled = 0;
    const chunks = async function* () {
        for (let i = 0; i < 64; i++) { pulled += 1; yield Buffer.alloc(16 * 1024, i); }
    };
    const saved = await media.saveUploadStream({ spaceId: 3, nodeId: 9, mime: 'video/mp4', body: Readable.toWeb(Readable.from(chunks())) });
    assert.equal(saved.bytes, 64 * 16 * 1024);
    assert.equal(pulled, 64);
    assert.match(saved.mediaPath, /^spaces\/3\/card-9\/upload-.*\.mp4$/);
    assert.equal((await readFile(join(root, saved.mediaPath))).length, saved.bytes);

    await assert.rejects(media.saveUploadStream({ spaceId: 3, nodeId: 10, mime: 'video/mp4', body: Readable.from(chunks()), maxBytes: 100_000 }), UploadTooLargeError);
    assert.deepEqual(await readdir(join(root, 'spaces', '3', 'card-10')), [], 'no .part and no file left behind');
});

async function uploadFixture(t) {
    const f = await cutFixture('bloop-bring-');
    t.after(() => f.close());
    const root = await mediaDir(t);
    const media = new MediaStore(() => root);
    const measured = [];
    const measurer = { measure: async (take) => { measured.push(take); const ms = take.mediaPath.endsWith('.mp3') ? 52_000 : 4_500; f.cuts.setTakeDuration(f.cuts.takeFor(take.nodeId, take.mediaPath).id, ms); return ms; } };
    const app = new Hono();
    app.use('*', csrf(TOKEN));
    app.route('/', uploadRoutes({ ...f, media, measurer, maxBytes: 1024 * 1024 }));
    const upload = (spaceId, nodeId, { type = 'video/mp4', name = 'clip.mp4', body = new Uint8Array(2048), headers = {} } = {}) => app.request(`/spaces/${spaceId}/nodes/${nodeId}/upload`, {
        method: 'POST', body, headers: { 'x-csrf-token': TOKEN, 'content-type': type, 'x-file-name': encodeURIComponent(name), ...headers },
    });
    return { ...f, root, media, measured, uploadApp: app, upload };
}

test('the upload route: the body is the file, a clip is a measured take, plain refusals', async (t) => {
    const f = await uploadFixture(t);
    const space = f.spaces.create({ name: 'mine' });
    const card = f.spaces.createNode(space.id, { type: 'upload' });
    const res = await f.upload(space.id, card.id, { name: 'C:\\fakepath\\Beach day.mp4' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.label, 'Beach day.mp4');
    assert.equal(body.duration_ms, 4500);
    assert.equal(body.bytes, 2048);
    const take = f.jobs.takes(card.id)[0];
    assert.deepEqual([take.preset, take.media_path, take.duration_ms], ['upload', body.media_path, 4500]);

    const form = new FormData();
    form.append('file', new File([new Uint8Array(3)], 'x.mp4', { type: 'video/mp4' }));
    assert.equal((await f.uploadApp.request(`/spaces/${space.id}/nodes/${card.id}/upload`, { method: 'POST', body: form, headers: { 'x-csrf-token': TOKEN } })).status, 415);
    assert.equal((await f.upload(space.id, card.id, { type: 'application/zip' })).status, 422);
    assert.equal((await f.upload(space.id, card.id, { body: new Uint8Array(0) })).status, 422);
    const big = await f.upload(space.id, card.id, { body: new Uint8Array(1024 * 1024 + 1) });
    assert.equal(big.status, 422);
    assert.match((await big.json()).error, /over 1 MB/);
    assert.equal((await f.upload(space.id, card.id, { headers: { 'x-csrf-token': '' } })).status, 403);
    assert.equal(fileName('..%2F..%2Fsecret%00.mp4'), 'secret .mp4');
});

test('dropped clips and one song: the cut is the clips in drop order at their measured lengths, the song under them', async (t) => {
    const f = await uploadFixture(t);
    const space = f.spaces.create({ name: 'drop' });
    const row = bringRow([], 3);
    const files = [['b.mp4', 'video/mp4'], ['a.webm', 'video/webm'], ['song.mp3', 'audio/mpeg']];
    for (const [i, [name, type]] of files.entries()) {
        const card = f.spaces.createNode(space.id, { type: 'upload', position_x: row[i].x, position_y: row[i].y });
        assert.equal((await f.upload(space.id, card.id, { name, type })).status, 200);
        if (type.startsWith('audio/')) f.spaces.updateNode(space.id, card.id, { label: 'music bed' });
    }
    const read = f.boardCut.read(space.id);
    assert.equal(read.guessed, true);
    assert.deepEqual(read.slots.map((s) => [s.beat_tag, s.seconds]), [['b.mp4', 4.5], ['a.webm', 4.5]], 'drop order, measured');
    assert.deepEqual(read.beds.map((b) => [b.kind, b.seconds]), [['music', 52]]);

    // Fill runs because the cut is empty and the person dropped the files.
    const res = await f.send('POST', `/spaces/${space.id}/cut/draft`, { mode: 'fill', revision: 0 });
    const { cut } = await res.json();
    assert.deepEqual(cut.items.map((i) => [i.beat_tag, i.out_ms]), [['b.mp4', 4500], ['a.webm', 4500]]);
    assert.equal(cut.sound.music.node_id, read.beds[0].node_id);
});

test('bringOrder and bringRow: clips in drop order then the song, one row below the board', () => {
    const file = (name, type) => ({ name, type });
    assert.deepEqual(bringOrder([file('s.mp3', 'audio/mpeg'), file('2.mp4', 'video/mp4'), file('x.zip', 'application/zip'), file('1.webm', 'video/webm')]).map((x) => x.name), ['2.mp4', '1.webm', 's.mp3']);
    assert.deepEqual(bringRow([], 3), [{ x: 0, y: 0 }, { x: 340, y: 0 }, { x: 680, y: 0 }]);
    assert.deepEqual(bringRow([{ position_x: 100, position_y: 200 }], 1), [{ x: 100, y: 800 }]);
});

test('the dock brings the files: one Upload card each, the file as the body, the song labelled, then Fill', async (t) => {
    const { dock } = fakeDock(t);
    const calls = [];
    let next = 50;
    globalThis.fetch = async (url, options = {}) => {
        const method = options.method ?? 'GET';
        calls.push({ url, method, headers: options.headers ?? {}, body: options.body });
        if (method === 'GET') return respond(200, { cut: { revision: 0, items: [], sound: null, settings: {} }, slots: [{ index: 1, beat_tag: 'b.mp4', label: '01 · b.mp4', node_id: 50, take_id: 1, state: 'ready', seconds: 4.5, media_url: '/media/b.mp4' }], beds: [] });
        if (url.endsWith('/nodes') && method === 'POST') return respond(201, { id: next++, ...JSON.parse(options.body) });
        if (url.endsWith('/upload')) return respond(200, { media_path: 'm', media_mime: options.headers['Content-Type'], label: decodeURIComponent(options.headers['X-File-Name']) });
        if (method === 'PATCH') return respond(200, {});
        if (url.endsWith('/cut/draft')) return respond(200, { drafted: true, cut: { revision: 1, items: [{ id: 'x', node_id: 50, take_id: 1, in_ms: 0, out_ms: 4500, seconds_ms: 4500 }], sound: null } });
        return respond(500, {});
    };
    const toasts = [];
    Object.assign(dock, { nodes: [], base: '/spaces/7', toast: (m) => toasts.push(m) });
    const clip = new File([new Uint8Array(4)], 'b.mp4', { type: 'video/mp4' });
    const song = new File([new Uint8Array(4)], 'my song.mp3', { type: 'audio/mpeg' });
    await dock.cutBring([song, clip]);

    const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
    assert.deepEqual(writes, [
        'POST /spaces/7/nodes', 'POST /spaces/7/nodes/50/upload',
        'POST /spaces/7/nodes', 'POST /spaces/7/nodes/51/upload', 'PATCH /spaces/7/nodes/51',
        'POST /spaces/7/cut/draft',
    ]);
    const upload = calls.find((c) => c.url.endsWith('/50/upload'));
    assert.equal(upload.body, clip, 'the File itself is the body: the browser streams it');
    assert.equal(upload.headers['X-File-Name'], 'b.mp4');
    assert.equal(upload.headers['X-CSRF-Token'], 'csrf-test');
    assert.deepEqual(JSON.parse(calls.find((c) => c.method === 'PATCH').body), { label: 'music bed' });
    assert.deepEqual(dock.nodes.map((n) => [n.id, n.label, n.position_x]), [[50, 'b.mp4', 0], [51, 'music bed', 340]]);
    assert.equal(dock.cutOpen, true, 'the dock opens with the cut built');
    assert.equal(dock.cutBringing, null);
    assert.equal(toasts.at(-1), 'Your clips are in the cut · 0:04 · with your song');

    calls.length = 0;
    await dock.cutBring([song]);
    assert.equal(calls.length, 0, 'a song alone makes nothing');
    assert.match(dock.cutAnnounce, /Drop video files/);
});

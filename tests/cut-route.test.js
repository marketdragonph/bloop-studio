import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { JobsRepository } from '../src/server/repositories/jobs.js';
import { DirectorPlans } from '../src/server/repositories/director-plans.js';
import { CutsRepository } from '../src/server/repositories/cuts.js';
import { BoardCut } from '../src/server/cut/board-cut.js';
import { BoardEvents } from '../src/server/generation/events.js';
import { csrf } from '../src/server/middleware/csrf.js';
import { cutRoutes } from '../src/server/routes/cut.js';
import { spacesRoutes } from '../src/server/routes/spaces.js';
import { generationRoutes } from '../src/server/routes/generation.js';
import { uploadRoutes } from '../src/server/routes/uploads.js';

const TOKEN = 'a'.repeat(64);
let dir;
let db;
let app;
let deps;
let space;
let clip;

before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bloop-cut-route-'));
    db = openDatabase(join(dir, 'test.db'));
    const spaces = new SpacesRepository(db);
    const jobs = new JobsRepository(db);
    const plans = new DirectorPlans(db);
    const cuts = new CutsRepository(db);
    const events = new BoardEvents();
    // The upload is streamed: the fake reads the body chunk by chunk, as the media store does.
    const media = {
        saveUploadStream: async ({ spaceId, nodeId, mime, body }) => {
            let bytes = 0;
            for await (const chunk of body) bytes += chunk.length;
            return { mediaPath: `spaces/${spaceId}/card-${nodeId}/upload.${mime.split('/')[1]}`, bytes };
        },
    };
    deps = { spaces, jobs, plans, cuts, events, media, boardCut: new BoardCut({ db }) };

    space = spaces.create({ name: 'film' });
    const plan = plans.create(space.id, { aspect: '16:9' });
    plans.saveBeats(plan.id, [{ tag: 's1-open', lane: 1, brief: 'b' }, { tag: 's2-turn', lane: 2, brief: 'b' }]);
    clip = spaces.createNode(space.id, { type: 'video', label: 's1-open' });
    spaces.updateNode(space.id, clip.id, { settings: { duration: 4 } });
    jobs.addTake({ nodeId: clip.id, mediaPath: 'spaces/1/card-1/a.mp4', mime: 'video/mp4', preset: 'wan5b', seed: 1, params: {} });
    cuts.setTakeDuration(cuts.takeFor(clip.id, 'spaces/1/card-1/a.mp4').id, 4100);
    spaces.setNodeResult(clip.id, { status: 'done', media_path: 'spaces/1/card-1/a.mp4', media_mime: 'video/mp4' });
    const music = spaces.createNode(space.id, { type: 'audio', label: 'music bed' });
    jobs.addTake({ nodeId: music.id, mediaPath: 'spaces/1/card-3/m.mp3', mime: 'audio/mpeg', preset: 'acestep', seed: 1, params: {} });

    app = new Hono();
    app.use('*', csrf(TOKEN));
    app.route('/spaces', spacesRoutes({ ...deps, views: null }));
    app.route('/', generationRoutes(deps));
    app.route('/', uploadRoutes(deps));
    app.route('/', cutRoutes(deps));
});

after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
});

test('GET /spaces/:id/cut: the stored cut, the slots, the beds and the clock', async () => {
    const res = await app.request(`/spaces/${space.id}/cut`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.cut, { revision: 0, items: [], sound: null, settings: { resolution: 1080, fps: 30 }, auto: true, can_undo_draft: false, updated_by: 'person' });
    assert.deepEqual(body.slots.map((s) => [s.beat_tag, s.state, s.node_id]), [['s1-open', 'ready', clip.id], ['s2-turn', 'missing', null]]);
    const [first] = body.slots;
    assert.equal(first.seconds, 4.1);
    assert.equal(first.lane, 1);
    assert.equal(first.label, '01 · Open');
    assert.equal(first.media_url, '/media/spaces/1/card-1/a.mp4');
    assert.ok('poster_url' in first);
    assert.deepEqual(body.beds.map((b) => [b.kind, b.label, b.media_url]), [['music', 'music bed', '/media/spaces/1/card-3/m.mp3']]);
    assert.deepEqual(body.clock, { total_ms: 4100, gaps_ms: 0 });
    assert.equal(body.total_ms, 4100);
    assert.deepEqual(body.ducks, []);
    assert.deepEqual(body.beats_ms, []);
    assert.ok(body.findings.some((f) => f.code === 'GAP' && f.beat_tag === 's2-turn'));
});

test('GET /spaces/:id/cut for a space that is gone is a 404 with a plain reason', async () => {
    const res = await app.request('/spaces/9999/cut');
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /no longer exists/);
});

test('the cut route reads only: it writes no cut row', async () => {
    await app.request(`/spaces/${space.id}/cut`);
    assert.equal(deps.cuts.find(space.id), null);
});

test('deleting a clip card needs the CSRF header, then sends a cut event for that space', async () => {
    const extra = deps.spaces.createNode(space.id, { type: 'video', label: 'spare' });
    const sent = [];
    const listen = (u) => sent.push(u);
    deps.events.on('cut', listen);
    try {
        const refused = await app.request(`/spaces/${space.id}/nodes/${extra.id}`, { method: 'DELETE' });
        assert.equal(refused.status, 403);
        assert.equal(sent.length, 0);
        const res = await app.request(`/spaces/${space.id}/nodes/${extra.id}`, { method: 'DELETE', headers: { 'x-csrf-token': TOKEN } });
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { takes: [] }, 'the takes ride on the answer, for the undo of the board');
        assert.deepEqual(sent, [{ spaceId: space.id, revision: 0, by: 'card_deleted', changed: [extra.id] }]);

        // A text card is not in the cut: no event.
        const note = deps.spaces.createNode(space.id, { type: 'note' });
        await app.request(`/spaces/${space.id}/nodes/${note.id}`, { method: 'DELETE', headers: { 'x-csrf-token': TOKEN } });
        assert.equal(sent.length, 1);
    } finally {
        deps.events.off('cut', listen);
    }
});

test('a clip or sound uploaded onto an Upload card sends a cut event; a picture does not', async () => {
    const upload = deps.spaces.createNode(space.id, { type: 'upload' });
    const sent = [];
    const listen = (u) => sent.push(u);
    deps.events.on('cut', listen);
    // The file is the body itself (streamed), its name in X-File-Name.
    const send = (name, type) => app.request(`/spaces/${space.id}/nodes/${upload.id}/upload`, {
        method: 'POST', body: new Uint8Array([1, 2, 3]),
        headers: { 'x-csrf-token': TOKEN, 'content-type': type, 'x-file-name': encodeURIComponent(name) },
    });
    try {
        assert.equal((await send('still.png', 'image/png')).status, 200);
        assert.equal(sent.length, 0);
        assert.equal((await send('my clip.mp4', 'video/mp4')).status, 200);
        assert.deepEqual(sent, [{ spaceId: space.id, revision: 0, by: 'upload', changed: [upload.id] }]);
    } finally {
        deps.events.off('cut', listen);
    }
});

test('the board stream carries `cut` events for its own space only, and lets go of the listener on close', async () => {
    const controller = new AbortController();
    const res = await app.request(`/spaces/${space.id}/events`, { signal: controller.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle) => {
        while (!text.includes(needle)) {
            const { value, done } = await reader.read();
            if (done) break;
            text += decoder.decode(value);
        }
    };
    await readUntil('event: queue'); // the stream is open
    assert.equal(deps.events.listenerCount('cut'), 1);
    deps.events.cut({ spaceId: space.id + 1, revision: 9, by: 'take' }); // another board
    deps.events.cut({ spaceId: space.id, revision: 3, by: 'take', added: [clip.id] });
    await readUntil('event: cut');
    const line = text.split('\n').find((l, i, all) => all[i - 1] === 'event: cut');
    assert.deepEqual(JSON.parse(line.replace(/^data: /, '')), { space_id: space.id, spaceId: space.id, revision: 3, by: 'take', added: [clip.id] });
    assert.ok(!text.includes('"revision":9'));
    controller.abort();
    await reader.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(deps.events.listenerCount('cut'), 0);
});

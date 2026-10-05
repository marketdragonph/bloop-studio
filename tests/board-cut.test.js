import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { JobsRepository } from '../src/server/repositories/jobs.js';
import { DirectorPlans } from '../src/server/repositories/director-plans.js';
import { CutsRepository } from '../src/server/repositories/cuts.js';
import { BoardCut, beatTitle, mediaUrl } from '../src/server/cut/board-cut.js';
import { TakeMeasurer, durationMs, measureTake } from '../src/server/generation/measure-take.js';
import { BoardEvents } from '../src/server/generation/events.js';

let dir;
let db;
let spaces;
let jobs;
let plans;
let cuts;
let space;
let missing; // media paths the fake media folder does not have
let reader;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bloop-boardcut-'));
    db = openDatabase(join(dir, 'test.db'));
    spaces = new SpacesRepository(db);
    jobs = new JobsRepository(db);
    plans = new DirectorPlans(db);
    cuts = new CutsRepository(db);
    space = spaces.create({ name: 'film' });
    missing = new Set();
    reader = new BoardCut({ db, exists: (path) => !missing.has(path) });
});
afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
});

/** A card with optional takes; `takes` are media paths, newest last. */
function card(type, label, { takes = [], x = 0, y = 0, duration, preset = 'wan5b', durationMs: measured } = {}) {
    const node = spaces.createNode(space.id, { type, label, position_x: x, position_y: y });
    if (duration) spaces.updateNode(space.id, node.id, { settings: { duration } });
    const mime = type === 'audio' ? 'audio/mpeg' : 'video/mp4';
    for (const path of takes) {
        jobs.addTake({ nodeId: node.id, mediaPath: path, mime, preset, seed: 1, params: {} });
        if (measured) cuts.setTakeDuration(cuts.takeFor(node.id, path).id, measured);
    }
    if (takes.length) spaces.setNodeResult(node.id, { status: 'done', media_path: takes.at(-1), media_mime: mime });
    return node;
}

function plan(beats, { runtimeSeconds = null } = {}) {
    const p = plans.create(space.id, { runtimeSeconds, aspect: '16:9' });
    plans.saveBeats(p.id, beats.map(([tag, lane]) => ({ tag, lane, brief: `${tag} brief` })));
    return p;
}

const read = () => reader.read(space.id);

test('plan order: beats by lane then id, one slot each, newest take, labels from the tag', () => {
    plan([['s2-chase', 2], ['s1-open', 1], ['s3-close', 3]]);
    card('video', 's1-open', { takes: ['a/1-old.mp4', 'a/1-new.mp4'], duration: 4 });
    card('video', 's2-chase', { takes: ['a/2.mp4'], duration: 6 });
    const { slots, guessed } = read();
    assert.equal(guessed, false);
    assert.deepEqual(slots.map((s) => s.beat_tag), ['s1-open', 's2-chase', 's3-close']);
    assert.equal(slots[0].label, '01 · Open');
    assert.equal(slots[0].media_url, '/media/a/1-new.mp4');
    assert.equal(slots[0].takes, 2);
    assert.deepEqual(slots.map((s) => s.state), ['ready', 'ready', 'missing']);
    assert.equal(slots[2].reason, 'never_rendered');
    assert.equal(slots[2].node_id, null);
});

test('a renamed label still matches through the beat node_ids; a voice wired in (lip sync) wins', () => {
    const p = plan([['s1-open', 1]]);
    const renamed = card('video', 'my favourite shot', { takes: ['a/r.mp4'] });
    const [beat] = plans.beats(p.id);
    plans.setBeat(beat.id, { node_ids: [renamed.id] });
    assert.equal(read().slots[0].node_id, renamed.id);

    // A newer card with the tag label and a voice wired in beats the planned one.
    const lip = card('video', 's1-open', { takes: ['a/lip.mp4'] });
    const voice = card('audio', 'voice: mara', { takes: ['a/v.mp3'] });
    spaces.connect(space.id, voice.id, lip.id, 'audio');
    assert.equal(read().slots[0].node_id, lip.id);
});

test('measured vs asked length: seconds only when measured, the asked length kept as planned_seconds', () => {
    plan([['s1-a', 1], ['s2-b', 2]]);
    card('video', 's1-a', { takes: ['a/1.mp4'], duration: 4, durationMs: 4040 });
    card('video', 's2-b', { takes: ['a/2.mp4'], duration: 6 });
    const { slots, findings, clock } = read();
    assert.equal(slots[0].seconds, 4.04);
    assert.equal(slots[0].measured, true);
    assert.equal(slots[1].seconds, null);
    assert.equal(slots[1].planned_seconds, 6);
    assert.equal(slots[1].measured, false);
    assert.deepEqual(findings.filter((f) => f.code === 'UNMEASURED').map((f) => f.beat_tag), ['s2-b']);
    assert.equal(clock.total_ms, 4040 + 6000);
});

test('a deleted card leaves a deleted slot; a missing file is MISSING_FILE, not playable', () => {
    const p = plan([['s1-a', 1], ['s2-b', 2]]);
    const gone = card('video', 's1-a', { takes: ['a/1.mp4'] });
    card('video', 's2-b', { takes: ['a/2.mp4'] });
    const [first] = plans.beats(p.id);
    plans.setBeat(first.id, { node_ids: [gone.id] });
    spaces.deleteNode(space.id, gone.id);
    missing.add('a/2.mp4');
    const { slots, findings } = read();
    assert.equal(slots[0].state, 'deleted');
    assert.equal(slots[0].reason, 'card_deleted');
    assert.equal(slots[1].state, 'missing');
    assert.equal(slots[1].reason, 'file_missing');
    assert.equal(slots[1].media_url, null);
    assert.ok(findings.some((f) => f.code === 'MISSING_FILE' && f.beat_tag === 's2-b'));
    assert.ok(findings.some((f) => f.code === 'GAP' && f.beat_tag === 's1-a'));
});

test('a laid lane whose cards are all still there but hold no video card is not rendered, not deleted', () => {
    const p = plan([['s1-a', 1]]);
    const still = card('image', 's1-a still');
    const [first] = plans.beats(p.id);
    plans.setBeat(first.id, { node_ids: [still.id] });
    const [slot] = read().slots;
    assert.equal(slot.state, 'missing');
    assert.equal(slot.reason, 'never_rendered');
});

test('rendering and failed cards show their state', () => {
    plan([['s1-a', 1], ['s2-b', 2]]);
    const a = card('video', 's1-a');
    const b = card('video', 's2-b');
    spaces.setNodeResult(a.id, { status: 'generating' });
    spaces.setNodeResult(b.id, { status: 'failed', error: 'Out of memory' });
    const { slots } = read();
    assert.equal(slots[0].state, 'rendering');
    assert.equal(slots[1].state, 'failed');
    assert.equal(slots[1].error, 'Out of memory');
});

test('no plan: board order top to bottom, then left to right, with ORDER_GUESSED', () => {
    const low = card('video', 'B', { takes: ['a/b.mp4'], x: 0, y: 500 });
    const right = card('video', 'A2', { takes: ['a/a2.mp4'], x: 400, y: 0 });
    const left = card('video', 'A1', { takes: ['a/a1.mp4'], x: 0, y: 0 });
    card('image', 'still');
    const { slots, findings, guessed } = read();
    assert.equal(guessed, true);
    assert.deepEqual(slots.map((s) => s.node_id), [left.id, right.id, low.id]);
    assert.ok(findings.some((f) => f.code === 'ORDER_GUESSED'));
});

test('never a cut of the cut: our own exported card is not a clip, with or without a plan', () => {
    card('video', 'A', { takes: ['a/a.mp4'] });
    const exported = card('video', 'Cut · r12', { takes: ['spaces/1/cuts/x-cut-r12.mp4'], preset: 'cut', y: 900 });
    assert.ok(!read().slots.some((s) => s.node_id === exported.id));

    plan([['Cut · r12', 1]]); // even a beat with the same label does not pick it
    const { slots } = read();
    assert.equal(slots[0].node_id, null);
    assert.equal(slots[0].state, 'missing');
});

test('beds: the newest music bed or song, and a voice bed, with their measured seconds', () => {
    card('audio', 'music bed', { takes: ['a/m-old.mp3'] });
    const song = card('audio', 'Song', { takes: ['a/song.mp3'], durationMs: 61000 });
    const voice = card('audio', 'voice over', { takes: ['a/vo.mp3'] });
    card('audio', 'sfx', { takes: ['a/sfx.mp3'] });
    const { beds } = read();
    assert.deepEqual(beds.map((b) => [b.kind, b.node_id]), [['music', song.id], ['voice', voice.id]]);
    assert.equal(beds[0].seconds, 61);
    assert.equal(beds[1].seconds, null);
    assert.equal(beds[0].media_url, '/media/a/song.mp3');
});

test('RUNTIME_OFF when the cut is more than 15% off the plan; STALE when a pinned take is older', () => {
    plan([['s1-a', 1]], { runtimeSeconds: 20 });
    const node = card('video', 's1-a', { takes: ['a/1.mp4', 'a/2.mp4'], durationMs: 5000 });
    const oldTake = jobs.takes(node.id).at(-1).id;
    const cut = { items: [{ node_id: node.id, take_id: oldTake, beat_tag: 's1-a', in_ms: 0, out_ms: 5000 }] };
    const { findings, clock } = reader.read(space.id, { cut });
    assert.equal(clock.total_ms, 5000);
    assert.ok(findings.some((f) => f.code === 'RUNTIME_OFF' && f.text.includes('0:05') && f.text.includes('0:20')));
    assert.ok(findings.some((f) => f.code === 'STALE' && f.node_id === node.id));
});

test('helpers: media urls are encoded per segment; tags read as titles', () => {
    assert.equal(mediaUrl('spaces/1/card 2/a#b.mp4'), '/media/spaces/1/card%202/a%23b.mp4');
    assert.equal(mediaUrl(null), null);
    assert.equal(beatTitle('s4-flashback'), 'Flashback');
    assert.equal(beatTitle('roof_top-chase'), 'Roof top chase');
});

// ── MeasureTake ──

const fakeMedia = () => ({ resolve: (path) => join(dir, path) });

test('MeasureTake writes the measured length and sends a cut event; the slot turns measured', async () => {
    plan([['s1-a', 1]]);
    const node = card('video', 's1-a', { takes: ['a/1.mp4'], duration: 4 });
    const events = new BoardEvents();
    const sent = [];
    events.on('cut', (u) => sent.push(u));
    const probed = [];
    const ffmpeg = { probe: async (file) => { probed.push(file); return { format: { duration: '4.033' } }; } };
    const measurer = new TakeMeasurer({ ffmpeg, cuts, media: fakeMedia(), events, log: { warn() {} } });
    assert.equal(await measurer.measure({ spaceId: space.id, nodeId: node.id, mediaPath: 'a/1.mp4' }), 4033);
    assert.equal(probed[0], join(dir, 'a/1.mp4'));
    assert.deepEqual(sent.map((u) => [u.spaceId, u.by, u.changed]), [[space.id, 'measure', [node.id]]]);
    assert.equal(read().slots[0].seconds, 4.033);
});

test('MeasureTake with no video tools: the length stays null, one plain log line, nothing throws', async () => {
    const node = card('video', 'A', { takes: ['a/1.mp4'] });
    const warnings = [];
    const enoent = Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' });
    const ffmpeg = { probe: async () => { throw enoent; } };
    const measurer = new TakeMeasurer({ ffmpeg, cuts, media: fakeMedia(), events: new BoardEvents(), log: { warn: (m) => warnings.push(m) } });
    assert.equal(await measurer.measure({ spaceId: space.id, nodeId: node.id, mediaPath: 'a/1.mp4' }), null);
    assert.equal(await measurer.measure({ spaceId: space.id, nodeId: node.id, mediaPath: 'a/1.mp4' }), null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /not measured/);
    const [slot] = read().slots;
    assert.equal(slot.seconds, null);
    assert.equal(slot.measured, false);
});

test('the MeasureTake stage never waits for the probe: the pipeline moves on, the take-landed event goes first', async () => {
    const node = card('video', 'A', { takes: ['a/1.mp4'] });
    const events = new BoardEvents();
    const sent = [];
    events.on('cut', (u) => sent.push(u.by));
    let release;
    const ffmpeg = { probe: () => new Promise((resolve) => { release = () => resolve({ format: { duration: '2' } }); }) };
    const measurer = new TakeMeasurer({ ffmpeg, cuts, media: fakeMedia(), events, log: { warn() {} } });
    let nextRan = false;
    const ctx = { node, result: { media_path: 'a/1.mp4' }, deps: { measurer, cuts, events } };
    await measureTake(ctx, async () => { nextRan = true; });
    assert.equal(nextRan, true);
    assert.deepEqual(sent, ['take']);
    await new Promise((r) => setImmediate(r));
    release();
    await measurer.chain;
    assert.deepEqual(sent, ['take', 'measure']);

    // A picture is not a clip: no event, no probe.
    await measureTake({ node: { ...node, type: 'image' }, result: { media_path: 'a/i.png' }, deps: { measurer, cuts, events } }, async () => {});
    assert.equal(sent.length, 2);
});

test('durationMs reads the container first, else the longest stream', () => {
    assert.equal(durationMs({ format: { duration: '3.5' } }), 3500);
    assert.equal(durationMs({ format: {}, streams: [{ duration: '2.0' }, { duration: '2.5' }] }), 2500);
    assert.equal(durationMs({ format: { duration: 'N/A' }, streams: [] }), null);
});

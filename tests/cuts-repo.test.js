import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { JobsRepository } from '../src/server/repositories/jobs.js';
import { CutConflictError, CutsRepository } from '../src/server/repositories/cuts.js';

let dir;
let db;
let spaces;
let cuts;
let jobs;
before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bloop-cuts-'));
    db = openDatabase(join(dir, 'test.db'));
    spaces = new SpacesRepository(db);
    cuts = new CutsRepository(db);
    jobs = new JobsRepository(db);
});
after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
});

const item = (id) => ({ id: `i${id}`, node_id: id, take_id: null, beat_tag: `s${id}`, media_path: `a/${id}.mp4`, seconds_ms: 4000, in_ms: 0, out_ms: 4000 });

test('a space with no saved cut reads as an empty cut at revision 0, and reading writes nothing', () => {
    const space = spaces.create({ name: 'empty' });
    const cut = cuts.current(space.id);
    assert.equal(cut.revision, 0);
    assert.deepEqual(cut.items, []);
    assert.deepEqual(cut.settings, { resolution: 1080, fps: 30 });
    assert.equal(cut.auto, true);
    assert.equal(cuts.find(space.id), null);
    assert.equal(cuts.revision(space.id), 0);
});

test('a stale save is a conflict carrying the server copy; the save with the new revision succeeds', () => {
    const space = spaces.create({ name: 'conflict' });
    const first = cuts.save(space.id, { items: [item(1)], revision: 0 });
    assert.equal(first.revision, 1);

    // Another window still holds revision 0.
    const stale = () => cuts.save(space.id, { items: [item(2)], revision: 0 });
    assert.throws(stale, (error) => error instanceof CutConflictError && error.cut.revision === 1 && error.cut.items[0].node_id === 1);

    // It adopts the server revision and saves again: no 409 loop.
    const second = cuts.save(space.id, { items: [item(2)], revision: 1, by: 'director' });
    assert.equal(second.revision, 2);
    assert.equal(second.updated_by, 'director');
    assert.deepEqual(second.items.map((i) => i.node_id), [2]);
});

test('keepPrevious keeps the replaced items as the one-step undo draft; sound and settings survive a save that omits them', () => {
    const space = spaces.create({ name: 'undo' });
    cuts.save(space.id, { items: [item(1)], sound: { music: { node_id: 9, gain_db: -6 } }, settings: { resolution: 720, fps: 30 }, revision: 0 });
    const next = cuts.save(space.id, { items: [item(2), item(3)], revision: 1, keepPrevious: true });
    assert.deepEqual(next.previous_items.map((i) => i.node_id), [1]);
    assert.deepEqual(next.sound, { music: { node_id: 9, gain_db: -6 } });
    assert.equal(next.settings.resolution, 720);
});

test('auto (live cut) flips without bumping the revision', () => {
    const space = spaces.create({ name: 'auto' });
    cuts.save(space.id, { items: [], revision: 0 });
    const off = cuts.setAuto(space.id, false);
    assert.equal(off.auto, false);
    assert.equal(off.revision, 1);
});

test('measured take length: takes.duration_ms is written alone, found by card and file', () => {
    const space = spaces.create({ name: 'measure' });
    const node = spaces.createNode(space.id, { type: 'video', label: 's1' });
    jobs.addTake({ nodeId: node.id, mediaPath: 'spaces/x/a.mp4', mime: 'video/mp4', preset: 'wan5b', seed: 1, params: { prompt: 'p' } });
    const take = cuts.takeFor(node.id, 'spaces/x/a.mp4');
    assert.equal(take.duration_ms, null);
    assert.equal(cuts.setTakeDuration(take.id, 4012.4), true);
    assert.equal(cuts.setTakeDuration(take.id, 0), false);
    assert.equal(cuts.setTakeDuration(take.id, Number.NaN), false);
    const after = cuts.takeFor(node.id, 'spaces/x/a.mp4');
    assert.equal(after.duration_ms, 4012);
    assert.equal(JSON.parse(after.params).prompt, 'p');
});

test('deleting the space deletes its cut', () => {
    const space = spaces.create({ name: 'gone' });
    cuts.save(space.id, { items: [item(1)], revision: 0 });
    spaces.delete(space.id);
    assert.equal(cuts.find(space.id), null);
});

test('the migration made cut_exports with its kind and status checks', () => {
    const space = spaces.create({ name: 'exports' });
    db.prepare("INSERT INTO cut_exports (space_id, kind) VALUES (?, 'export')").run(space.id);
    assert.throws(() => db.prepare("INSERT INTO cut_exports (space_id, kind) VALUES (?, 'zip')").run(space.id));
    assert.equal(db.prepare('SELECT status FROM cut_exports WHERE space_id = ?').get(space.id).status, 'queued');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { DirectorRepository } from '../src/server/repositories/director.js';
import { BoardActions } from '../src/server/director/tools.js';
import { boardSnapshot } from '../src/server/director/prompt.js';
import { auditBoard } from '../src/server/director/audit.js';
import { DirectorRuns, DirectorBusyError } from '../src/server/director/runs.js';
import { BoardEvents } from '../src/server/generation/events.js';

function fresh() {
    const db = openDatabase(':memory:');
    const spaces = new SpacesRepository(db);
    const space = spaces.create({ name: 'Agent test' });
    return { db, spaces, space, actions: new BoardActions({ spaces, spaceId: space.id, origin: { x: 0, y: 0 } }) };
}

/** A shot whose still names Mira, with Mira's cast card on the board but not wired in. */
function shotWithLooseCast(actions) {
    actions.run('add_card', { ref: 'mira', type: 'text', label: 'Cast · Mira Sen', text: 'Mira Sen, 31, short black hair.' });
    actions.run('add_card', { ref: 'shot', type: 'text', label: 'Shot 1', text: 'Mira runs along the sea wall.', column: 2 });
    actions.run('add_card', { ref: 'still', type: 'image', label: 'Shot 1 still', column: 2, row: 1 });
    actions.run('connect', { from: 'shot', to: 'still' });
}

test('the board check finds a character named in a shot but not wired in, and stops once it is', () => {
    const { spaces, space, actions } = fresh();
    shotWithLooseCast(actions);
    const findings = auditBoard(spaces.board(space.id));
    assert.equal(findings.length, 1);
    assert.match(findings[0], /names Mira Sen but #\d+ text "Cast · Mira Sen" is not wired into it/);

    actions.run('connect', { from: 'mira', to: 'still' }); // a second text card into Words
    assert.deepEqual(auditBoard(spaces.board(space.id)), []);
});

test('the board check flags render cards with no words, unused text, and a last frame without a first', () => {
    const { spaces, space, actions } = fresh();
    actions.run('add_card', { ref: 'clip', type: 'video', label: 'Clip' });
    actions.run('add_card', { ref: 'idea', type: 'text', text: 'An idea nobody wired.' });
    actions.run('add_card', { ref: 'end', type: 'image' });
    actions.run('connect', { from: 'end', to: 'clip', socket: 'last_frame' });
    const text = auditBoard(spaces.board(space.id)).join('\n');
    assert.match(text, /"Clip" has nothing in Words/);
    assert.match(text, /not wired into anything/);
    assert.match(text, /last frame but no first frame/);
});

test('after a round that changed the board, the model gets the check for what it touched', () => {
    const { actions } = fresh();
    shotWithLooseCast(actions);
    assert.match(actions.afterRound(), /Board check found 1 problem/);
    assert.equal(actions.afterRound(), null); // nothing changed since
    assert.match(actions.run('audit_board', {}).content, /Board check found 1 problem/);
});

test('connect can name a socket: lyrics into an audio card, refused where the card has none', () => {
    const { spaces, space, actions } = fresh();
    actions.run('add_card', { ref: 'song', type: 'audio' });
    actions.run('add_card', { ref: 'words', type: 'text', text: '[verse] hello' });
    assert.match(actions.run('connect', { from: 'words', to: 'song', socket: 'lyrics' }).content, /lyrics socket/);
    actions.run('add_card', { ref: 'pic', type: 'image' });
    actions.run('add_card', { ref: 'more', type: 'text', text: 'x' });
    assert.match(actions.run('connect', { from: 'more', to: 'pic', socket: 'lyrics' }).content, /has no "lyrics" socket/);
    assert.equal(spaces.board(space.id).connections.length, 1);
});

test('inspect_cards reads a card in full; update_card sets a duration on render cards only', () => {
    const { spaces, space, actions } = fresh();
    shotWithLooseCast(actions);
    const still = spaces.board(space.id).nodes.find((n) => n.type === 'image');
    const read = actions.run('inspect_cards', { cards: [`#${still.id}`] }).content;
    assert.match(read, /not rendered yet/);
    assert.match(read, /wired in: #\d+ "Shot 1" → prompt/);
    assert.ok(actions.run('update_card', { card: `#${still.id}`, aspect: '9:16' }).ok);
    assert.equal(spaces.findNode(space.id, still.id).settings.aspect, '9:16');
    assert.match(actions.run('update_card', { card: 'shot', duration: 8 }).content, /only image, video and audio/);
    assert.match(boardSnapshot(spaces.board(space.id)), /\[not rendered yet\] \{aspect 9:16\}/);
});

/** A service whose turns wait until the test lets them finish; each can say it ran out of steps. */
function fakeService({ exhaustedTurns = 0, key = true } = {}) {
    const service = {
        requests: [],
        pending: [],
        resolveProvider: () => (key ? { providerId: 'anthropic' } : { missing: true }),
        turn(spaceId, request, emit, signal) {
            service.requests.push(request);
            return new Promise((resolve) => {
                emit('text', { delta: 'Building…' });
                emit('actions', { actions: [{ kind: 'card', nodeId: service.requests.length }] });
                signal.addEventListener('abort', () => resolve({ status: 'stopped', error: 'Stopped.', actions: [] }));
                const exhausted = service.requests.length <= exhaustedTurns;
                service.pending.push(() => resolve({ status: 'done', exhausted, text: 'Done.', actions: [] }));
            });
        },
        async finishAll(runs, spaceId) {
            while (runs.live.has(spaceId)) {
                service.pending.splice(0).forEach((finish) => finish());
                await new Promise((r) => setTimeout(r, 5));
            }
        },
    };
    return service;
}

test('a Director run works in the background, one per board, and streams on the board events', async () => {
    const { db, space } = fresh();
    const director = new DirectorRepository(db);
    const events = new BoardEvents();
    const seen = [];
    events.on('director', (update) => seen.push(update.event));
    const service = fakeService();
    const runs = new DirectorRuns({ director, service, events });

    const runId = runs.start(space.id, 'Make a short film');
    assert.throws(() => runs.start(space.id, 'again'), DirectorBusyError);
    assert.deepEqual(runs.active(space.id), { runId, request: 'Make a short film', text: 'Building…', actions: [{ kind: 'card', nodeId: 1 }], info: null });

    await service.finishAll(runs, space.id);
    assert.equal(runs.active(space.id), null);
    assert.deepEqual(seen, ['text', 'actions', 'done']);
    assert.equal(db.prepare('SELECT status FROM director_runs WHERE id = ?').get(runId).status, 'done');
});

test('out of steps, the run carries on by itself in the same reply, with a ceiling', async () => {
    const { db, space } = fresh();
    const events = new BoardEvents();
    const done = [];
    events.on('director', (u) => u.event === 'done' && done.push(u.data));
    const service = fakeService({ exhaustedTurns: 2 });
    const runs = new DirectorRuns({ director: new DirectorRepository(db), service, events });
    runs.start(space.id, 'A nine-shot film');
    await service.finishAll(runs, space.id);
    assert.equal(service.requests.length, 3); // two turns out of steps, the third finished
    assert.match(service.requests[1], /^Continue where you stopped/);
    assert.equal(done.length, 1); // one reply, no button to press
    assert.equal(done[0].notice, null);

    const endless = fakeService({ exhaustedTurns: 99 });
    const capped = new DirectorRuns({ director: new DirectorRepository(db), service: endless, events });
    capped.start(space.id, 'Never ending');
    await endless.finishAll(capped, space.id);
    assert.equal(endless.requests.length, 4);
    assert.match(done[1].notice, /very long build/);
});

test('Stop ends a run; a run cut off by a closed app resumes by itself when the app starts', async () => {
    const { db, space } = fresh();
    const director = new DirectorRepository(db);
    const service = fakeService();
    const runs = new DirectorRuns({ director, service, events: new BoardEvents() });
    const runId = runs.start(space.id, 'Build');
    const done = runs.live.get(space.id).done;
    assert.ok(runs.stop(space.id));
    await done;
    assert.equal(db.prepare('SELECT status FROM director_runs WHERE id = ?').get(runId).status, 'stopped');

    director.startRun(space.id, 'Cut off'); // the app closed during this one
    const restarted = fakeService();
    const after = new DirectorRuns({ director, service: restarted, events: new BoardEvents() });
    after.recover();
    assert.match(director.log(space.id).at(-1).text, /picking up where it stopped/);
    assert.match(restarted.requests[0], /^Continue where you stopped/);
    assert.equal(after.active(space.id).request, null); // no fake message from the person in the chat
    await restarted.finishAll(after, space.id);
});

test('plan first: on a new empty board the Director may add a few cards, not a whole board', () => {
    const { spaces, space } = fresh();
    const fresher = new BoardActions({ spaces, spaceId: space.id, origin: { x: 0, y: 0 }, planned: false });
    for (const ref of ['a', 'b', 'c']) assert.ok(fresher.run('add_card', { ref, type: 'note' }).ok);
    assert.match(fresher.run('add_card', { ref: 'd', type: 'note' }).content, /^STOP: this is a new board/);
    // Once there is a conversation (or cards), building is free.
    const agreed = new BoardActions({ spaces, spaceId: space.id, origin: { x: 0, y: 0 } });
    for (let i = 0; i < 5; i++) assert.ok(agreed.run('add_card', { ref: `s${i}`, type: 'note' }).ok);
});

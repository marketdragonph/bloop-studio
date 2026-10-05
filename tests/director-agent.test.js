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

/** A service whose turn waits until the test lets it finish. */
function fakeService() {
    let finish;
    return {
        turn: (spaceId, request, emit, signal) => new Promise((resolve) => {
            emit('text', { delta: 'Building…' });
            emit('actions', { actions: [{ kind: 'card', nodeId: 1 }] });
            signal.addEventListener('abort', () => resolve('stopped'));
            finish = () => { emit('done', { text: 'Done.' }); resolve('done'); };
        }),
        finish: () => finish(),
    };
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

    service.finish();
    await runs.live.get(space.id)?.done;
    assert.equal(runs.active(space.id), null);
    assert.deepEqual(seen, ['text', 'actions', 'done']);
    assert.equal(db.prepare('SELECT status FROM director_runs WHERE id = ?').get(runId).status, 'done');
});

test('Stop ends a run; a run cut off by a closed app is offered as Continue', async () => {
    const { db, space } = fresh();
    const director = new DirectorRepository(db);
    const runs = new DirectorRuns({ director, service: fakeService(), events: new BoardEvents() });
    const runId = runs.start(space.id, 'Build');
    const done = runs.live.get(space.id).done;
    assert.ok(runs.stop(space.id));
    await done;
    assert.equal(db.prepare('SELECT status FROM director_runs WHERE id = ?').get(runId).status, 'stopped');

    director.startRun(space.id, 'Cut off'); // the app closed during this one
    new DirectorRuns({ director, service: fakeService(), events: new BoardEvents() }).recover();
    const last = director.log(space.id).at(-1);
    assert.equal(last.role, 'notice');
    assert.equal(last.continuable, true);
});

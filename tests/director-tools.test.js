import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { BoardActions } from '../src/server/director/tools.js';
import { boardSnapshot, turnOrigin } from '../src/server/director/prompt.js';

function fresh() {
    const spaces = new SpacesRepository(openDatabase(':memory:'));
    const space = spaces.create({ name: 'Director test' });
    return { spaces, space, actions: new BoardActions({ spaces, spaceId: space.id, origin: { x: 0, y: 0 } }) };
}

test('adds a text → image → video lane and wires it by ref', () => {
    const { spaces, space, actions } = fresh();
    assert.ok(actions.run('add_card', { ref: 's1', type: 'text', text: 'A pilot walks into a hangar.', column: 0, row: 0 }).ok);
    assert.ok(actions.run('add_card', { ref: 's1-still', type: 'image', column: 0, row: 1 }).ok);
    assert.ok(actions.run('add_card', { ref: 's1-clip', type: 'video', column: 0, row: 2 }).ok);
    assert.match(actions.run('connect', { from: 's1', to: 's1-still' }).content, /prompt socket/);
    assert.match(actions.run('connect', { from: 's1-still', to: 's1-clip' }).content, /first_frame socket/);

    const board = spaces.board(space.id);
    assert.equal(board.nodes.length, 3);
    assert.equal(board.connections.length, 2);
    assert.equal(actions.run('add_card', { ref: 'x', type: 'video', direction: 'pan' }).ok, false); // no prompt box on media cards
    assert.equal(board.nodes.find((n) => n.type === 'image').position_y, 580);
    assert.equal(actions.actions.length, 5);
});

test('rejects invalid input and unknown refs without touching the board', () => {
    const { spaces, space, actions } = fresh();
    assert.equal(actions.run('add_card', { ref: 'x', type: 'upload' }).ok, false);
    assert.equal(actions.run('add_card', { ref: 'x', type: 'text', extra: 1 }).ok, false);
    assert.equal(actions.run('connect', { from: 'nope', to: 'also-nope' }).ok, false);
    assert.equal(actions.run('delete_everything', {}).ok, false);
    assert.equal(spaces.board(space.id).nodes.length, 0);
});

test('caps cards per turn and refuses a reused ref', () => {
    const { actions } = fresh();
    assert.ok(actions.run('add_card', { ref: 'a', type: 'note' }).ok);
    assert.match(actions.run('add_card', { ref: 'a', type: 'note' }).content, /already used/);
    for (let i = 0; i < 59; i++) actions.run('add_card', { ref: `n${i}`, type: 'note' });
    assert.match(actions.run('add_card', { ref: 'one-too-many', type: 'note' }).content, /At most 60/);
});

test('update_card edits existing cards by #id and records the previous text', () => {
    const { spaces, space, actions } = fresh();
    const card = spaces.createNode(space.id, { type: 'text', text_content: 'old' });
    assert.ok(actions.run('update_card', { card: `#${card.id}`, text: 'new' }).ok);
    assert.equal(spaces.findNode(space.id, card.id).text_content, 'new');
    assert.equal(actions.actions[0].before.text_content, 'old');
});

test('snapshot lists cards and wires; new turns start below existing cards', () => {
    const { spaces, space } = fresh();
    spaces.createNode(space.id, { type: 'text', text_content: 'hello', position_x: 100, position_y: 200 });
    const board = spaces.board(space.id);
    assert.match(boardSnapshot(board), /#\d+ text: hello/);
    assert.deepEqual(turnOrigin(board.nodes), { x: 100, y: 820 });
    assert.equal(boardSnapshot({ nodes: [], connections: [] }), 'The board is empty.');
});

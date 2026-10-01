import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository, ValidationError } from '../src/server/repositories/spaces.js';

function fresh() {
    const repo = new SpacesRepository(openDatabase(':memory:'));
    const space = repo.create({ name: 'Test board' });
    return { repo, space };
}

test('creates a space and rejects a blank name', () => {
    const { repo, space } = fresh();
    assert.equal(space.name, 'Test board');
    assert.deepEqual(space.canvas_state, { zoom: 1, panX: 0, panY: 0 });
    assert.throws(() => repo.create({ name: '   ' }), ValidationError);
});

test('wires a text card into an image card on the words socket', () => {
    const { repo, space } = fresh();
    const text = repo.createNode(space.id, { type: 'text', text_content: 'a hangar at dusk' });
    const image = repo.createNode(space.id, { type: 'image', position_x: 400 });
    const wire = repo.connect(space.id, text.id, image.id);
    assert.equal(wire.to_socket, 'prompt');
    assert.equal(repo.upstreamOf(space.id, image.id)[0].text_content, 'a hangar at dusk');
});

test('a Words socket takes several text wires (shot + cast + location); a picture socket takes one', () => {
    const { repo, space } = fresh();
    const shot = repo.createNode(space.id, { type: 'text' });
    const cast = repo.createNode(space.id, { type: 'text' });
    const place = repo.createNode(space.id, { type: 'text' });
    const image = repo.createNode(space.id, { type: 'image' });
    for (const t of [shot, cast, place]) assert.equal(repo.connect(space.id, t.id, image.id).to_socket, 'prompt');
    const a = repo.createNode(space.id, { type: 'image' });
    const b = repo.createNode(space.id, { type: 'image' });
    const clip = repo.createNode(space.id, { type: 'video' });
    repo.connect(space.id, a.id, clip.id);
    assert.throws(() => repo.connect(space.id, b.id, clip.id), /full or do not match/);
});

test('an image card feeds a video card as its first frame', () => {
    const { repo, space } = fresh();
    const still = repo.createNode(space.id, { type: 'image' });
    const clip = repo.createNode(space.id, { type: 'video' });
    assert.equal(repo.connect(space.id, still.id, clip.id).to_socket, 'first_frame');
});

test('refuses loops, duplicates, self-wires and inputs on cards that take none', () => {
    const { repo, space } = fresh();
    const a = repo.createNode(space.id, { type: 'image' });
    const b = repo.createNode(space.id, { type: 'image' });
    const text = repo.createNode(space.id, { type: 'text' });
    repo.connect(space.id, a.id, b.id);
    assert.throws(() => repo.connect(space.id, b.id, a.id), /loop/);
    assert.throws(() => repo.connect(space.id, a.id, b.id), /already connected/);
    assert.throws(() => repo.connect(space.id, a.id, a.id), /itself/);
    assert.throws(() => repo.connect(space.id, a.id, text.id), /do not take inputs/);
});

test('saveCanvas only moves cards of its own space and clamps the view', () => {
    const { repo, space } = fresh();
    const other = repo.create({ name: 'Other' });
    const mine = repo.createNode(space.id, { type: 'note' });
    const theirs = repo.createNode(other.id, { type: 'note' });
    repo.saveCanvas(space.id, {
        canvas_state: { zoom: 99, panX: 10, panY: 20 },
        nodes: [{ id: mine.id, position_x: 140, position_y: 60 }, { id: theirs.id, position_x: 999, position_y: 999 }],
    });
    assert.equal(repo.find(space.id).canvas_state.zoom, 3);
    assert.equal(repo.findNode(space.id, mine.id).position_x, 140);
    assert.equal(repo.findNode(other.id, theirs.id).position_x, 0);
});

test('delete then restore brings the card back with its id and wires', () => {
    const { repo, space } = fresh();
    const text = repo.createNode(space.id, { type: 'text', text_content: 'keep me' });
    const image = repo.createNode(space.id, { type: 'image' });
    const wire = repo.connect(space.id, text.id, image.id);
    const snapshot = repo.findNode(space.id, text.id);
    repo.deleteNode(space.id, text.id);
    assert.equal(repo.board(space.id).connections.length, 0);
    repo.restoreNode(space.id, snapshot, [wire]);
    const board = repo.board(space.id);
    assert.equal(board.nodes.find((n) => n.id === text.id).text_content, 'keep me');
    assert.equal(board.connections[0].id, wire.id);
});

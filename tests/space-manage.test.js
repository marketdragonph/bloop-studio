import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { createViews } from '../src/server/views.js';
import { spaceManageRoutes } from '../src/server/routes/space-manage.js';

const views = createViews({ csrfToken: 't' });

/** The routes over a real in-memory board; `busy` fakes a Director run or renders on it. */
function setup({ directorOn = false, renders = 0 } = {}) {
    const spaces = new SpacesRepository(openDatabase(':memory:'));
    const space = spaces.create({ name: 'Rooftop friends', description: 'Uno and Pip' });
    const shot = spaces.createNode(space.id, { type: 'image', label: 'thumbnail' });
    spaces.setNodeResult(shot.id, { status: 'done', media_path: 'b/thumb.png', media_mime: 'image/png' });
    spaces.createNode(space.id, { type: 'text' });
    const jobs = { activeQueue: () => Array.from({ length: renders }, (_, i) => ({ id: i, spaceId: space.id })) };
    const directorRuns = { active: (id) => (directorOn && id === space.id ? { runId: 1 } : null) };
    const app = new Hono().route('/spaces', spaceManageRoutes({ views, spaces, jobs, directorRuns }));
    const send = (method, path, { body, from = '/spaces?q=roof&page=1' } = {}) => app.request(path, {
        method,
        headers: { 'HX-Request': 'true', 'HX-Current-URL': `http://127.0.0.1:5199${from}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        body: body ? new URLSearchParams(body) : undefined,
    });
    return { spaces, space, send };
}

test('Edit space: the modal is filled in, a blank name is refused, a save reloads the list', async () => {
    const { spaces, space, send } = setup();
    const modal = await (await send('GET', `/spaces/${space.id}/edit`)).text();
    assert.match(modal, /hx-put="\/spaces\/\d+"/);
    assert.match(modal, /value="Rooftop friends"/);
    assert.match(modal, /value="Uno and Pip"/);

    const refused = await send('PUT', `/spaces/${space.id}`, { body: { name: '  ', description: 'x' } });
    assert.equal(refused.status, 422);
    assert.match(await refused.text(), /Give the space a name/);
    assert.equal(spaces.find(space.id).name, 'Rooftop friends');

    const saved = await send('PUT', `/spaces/${space.id}`, { body: { name: 'Rooftop friends, part 2', description: '' } });
    assert.equal(saved.status, 204);
    assert.equal(saved.headers.get('HX-Refresh'), 'true', 'the list reloads, keeping its search and page');
    assert.deepEqual([spaces.find(space.id).name, spaces.find(space.id).description], ['Rooftop friends, part 2', null]);
});

test('Edit space on its own board renames the title in place instead of reloading the board', async () => {
    const { space, send } = setup();
    const res = await send('PUT', `/spaces/${space.id}`, { body: { name: 'New name' }, from: `/spaces/${space.id}` });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('HX-Refresh'), null);
    assert.deepEqual(JSON.parse(res.headers.get('HX-Trigger')), { 'space:updated': { id: space.id, name: 'New name' } });
    assert.equal(await res.text(), '', 'an empty answer closes the modal');
});

test('Delete space says what goes and what stays, then deletes; from the board it goes back to the list', async () => {
    const { spaces, space, send } = setup();
    const modal = await (await send('GET', `/spaces/${space.id}/delete`)).text();
    assert.match(modal, /Delete <strong>Rooftop friends<\/strong>/);
    assert.match(modal, /Its 2 cards/);
    assert.match(modal, /The 1 rendered file stays in your media folder/);
    assert.match(modal, /hx-delete="\/spaces\/\d+"/);

    const res = await send('DELETE', `/spaces/${space.id}`, { from: `/spaces/${space.id}` });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('HX-Redirect'), '/spaces');
    assert.equal(spaces.find(space.id), undefined);
    assert.equal((await send('DELETE', `/spaces/${space.id}`)).status, 404);
});

test('a space the Director or a render is still working on cannot be deleted yet', async () => {
    for (const [busy, reason] of [[{ directorOn: true }, /The Director is working on this space/], [{ renders: 2 }, /2 renders are queued or running/]]) {
        const { spaces, space, send } = setup(busy);
        const modal = await (await send('GET', `/spaces/${space.id}/delete`)).text();
        assert.match(modal, reason);
        assert.match(modal, /<button[^>]*hx-delete[^>]*disabled/);
        const res = await send('DELETE', `/spaces/${space.id}`);
        assert.equal(res.status, 422);
        assert.ok(spaces.find(space.id), 'still there');
    }
});

test('an empty space says it has no cards, not "0 cards"', async () => {
    const { spaces, send } = setup();
    const empty = spaces.create({ name: 'Blank' });
    const modal = await (await send('GET', `/spaces/${empty.id}/delete`)).text();
    assert.match(modal, /It has no cards yet/);
    assert.doesNotMatch(modal, /0 cards|rendered file/);
});

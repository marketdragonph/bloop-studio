import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeRoutes } from '../src/server/routes/home.js';

function app({ signedIn = false } = {}) {
    const routes = homeRoutes({
        views: { render: async (name, data) => `${name}:${data.recent.length}` },
        account: { signedIn },
        spaces: { list: ({ limit = -1 } = {}) => [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }].slice(0, limit < 0 ? undefined : limit) },
    });
    return { routes };
}

const form = (fields) => ({ method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

test('signed out, the app opens on the launch screen every time, with the four latest boards', async () => {
    const { routes } = app();
    const res = await routes.request('/');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'pages/launch:4');
});

test('signed in, the app opens straight on Spaces', async () => {
    assert.equal((await app({ signedIn: true }).routes.request('/')).headers.get('location'), '/spaces');
});

test('continuing goes to Spaces, or to the recent board picked', async () => {
    const { routes } = app();
    const res = await routes.request('/launch/continue', form({}));
    assert.equal(res.headers.get('hx-redirect'), '/spaces');

    assert.equal((await routes.request('/launch/continue', form({ to: '/spaces/2' }))).headers.get('hx-redirect'), '/spaces/2');
    // Never an address outside the app.
    assert.equal((await routes.request('/launch/continue', form({ to: 'https://evil.test' }))).headers.get('hx-redirect'), '/spaces');
});

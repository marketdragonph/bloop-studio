// The top bar's update notice (2026-10-06): a release made after launch was unseen for hours (checks every 4 h,
// and the bar showed nothing until the download was done). Now: checks every 30 min and when Settings opens, and
// the bar shows the download with its progress, then Restart to update.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { createViews } from '../src/server/views.js';
import { appUpdateRoutes } from '../src/server/routes/app-update.js';

const views = createViews({ csrfToken: 't' });
const bar = (update) => views.render('partials/update-key', { update: { version: '2026.1006.800', available: '2026.1006.810', progress: 0, error: null, ...update } });

test('the top bar: nothing while up to date, the download with its progress, then Restart to update', async () => {
    assert.equal((await bar({ status: 'current' })).trim(), '');
    const down = await bar({ status: 'downloading', progress: 0.42 });
    assert.match(down, /Update 2026\.1006\.810 · 42%/);
    assert.match(down, /status-light--busy/);
    assert.match(down, /hx-get="\/app\/update" hx-trigger="load delay:3s"/, 'polls itself while downloading');
    assert.match(await bar({ status: 'ready' }), /Restart to update/);
});

test('opening Settings checks again when the last check is old; the updater checks every 30 minutes', async () => {
    let asked = 0;
    const updates = { state: () => ({ version: '1', status: 'current', available: null, progress: 0, error: null }), check() {}, checkIfStale() { asked += 1; }, install() {} };
    const app = new Hono().route('/app/update', appUpdateRoutes({ views, updates }));
    await app.request('/app/update/about');
    assert.equal(asked, 1);
    await app.request('/app/update');
    assert.equal(asked, 1, 'the top bar poll does not check');
    const source = readFileSync(new URL('../src/main/updater.js', import.meta.url), 'utf8');
    assert.match(source, /const CHECK_EVERY_MS = 30 \* 60 \* 1000;/);
});

test('a downloaded update keeps its Restart key through later checks, re-checks and errors', async () => {
    const { applyUpdateEvent } = await import('../src/main/update-events.js');
    let s = { version: '1', status: 'idle', available: null, progress: 0, error: null };
    for (const [event, payload] of [['checking'], ['available', { version: '2' }], ['progress', { percent: 50 }]]) s = applyUpdateEvent(s, event, payload);
    assert.deepEqual([s.status, s.available, s.progress], ['downloading', '2', 0.5]);
    s = applyUpdateEvent(s, 'downloaded', { version: '2' });
    assert.equal(s.status, 'ready');
    // The 30-minute re-check: checking, the same version again, then GitHub's 500 or no network.
    for (const [event, payload] of [['checking'], ['available', { version: '2' }], ['progress', { percent: 10 }], ['error', { message: 'HttpError: 500' }], ['current']]) {
        s = applyUpdateEvent(s, event, payload);
        assert.equal(s.status, 'ready', `still ready after ${event}`);
    }
    assert.equal(s.available, '2');
    // A newer release than the one downloaded starts a new download.
    assert.equal(applyUpdateEvent(s, 'available', { version: '3' }).status, 'downloading');
    // Without a download in hand an error is shown, and a check after it clears it.
    const failed = applyUpdateEvent({ version: '1', status: 'checking', available: null, progress: 0, error: null }, 'error', { message: 'offline' });
    assert.equal(failed.status, 'error');
    assert.equal(applyUpdateEvent(failed, 'checking').error, null);
});

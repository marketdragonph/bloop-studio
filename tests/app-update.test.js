import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server/server.js';
import { productionPackages, renderNotices } from '../scripts/third-party-notices.mjs';

const settings = {
    all: () => ({ comfyUrl: 'http://127.0.0.1:9', mediaDir: tmpdir(), llmProvider: 'anthropic', configured: {} }),
    get: (key) => ({ comfyUrl: 'http://127.0.0.1:9', mediaDir: tmpdir() })[key],
    update() {},
    clearSecret() {},
};

/** A server whose updater is a stub the test controls. */
async function serverWith(updateState) {
    const dataDir = mkdtempSync(join(tmpdir(), 'bloop-update-'));
    const installs = [];
    const updates = { state: () => ({ ...updateState }), check: async () => {}, install: () => installs.push(updateState.available) };
    // In-memory database: Windows cannot delete the temp folder while a SQLite file in it is open.
    const { server, url } = await createServer({ settings, dataDir, dbPath: ':memory:', startWorker: false, updates });
    const page = await (await fetch(`${url}/settings`)).text();
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const post = (path) => fetch(url + path, { method: 'POST', headers: { 'X-CSRF-Token': token } });
    const close = () => {
        server.close();
        rmSync(dataDir, { recursive: true, force: true });
    };
    return { url, post, installs, close };
}

test('the top bar shows Restart to update only once a new version has downloaded', async () => {
    const idle = await serverWith({ version: '2026.1004.502', status: 'downloading', available: '2026.1005.900', progress: 0.4 });
    try {
        assert.doesNotMatch(await (await fetch(`${idle.url}/app/update`)).text(), /Restart to update/);
        assert.match(await (await fetch(`${idle.url}/app/update/about`)).text(), /Downloading version 2026\.1005\.900 \(40%\)/);
        assert.equal((await idle.post('/app/update/install')).status, 409);
        assert.deepEqual(idle.installs, []);
    } finally {
        idle.close();
    }

    const ready = await serverWith({ version: '2026.1004.502', status: 'ready', available: '2026.1005.900', progress: 1 });
    try {
        assert.match(await (await fetch(`${ready.url}/app/update`)).text(), /Restart to update/);
        assert.equal((await ready.post('/app/update/install')).status, 200);
        assert.deepEqual(ready.installs, ['2026.1005.900']);
    } finally {
        ready.close();
    }
});

test('installing needs the CSRF token like every other change', async () => {
    const ready = await serverWith({ version: '1', status: 'ready', available: '2', progress: 1 });
    try {
        assert.equal((await fetch(`${ready.url}/app/update/install`, { method: 'POST' })).status, 403);
        assert.deepEqual(ready.installs, []);
    } finally {
        ready.close();
    }
});

test('third-party notices cover every shipped package with its license', () => {
    const packages = productionPackages();
    const names = packages.map((p) => p.name);
    for (const name of ['hono', 'htmx.org', 'openai', 'electron-updater', '@fontsource/inter']) assert.ok(names.includes(name), name);
    assert.ok(!names.includes('electron-builder')); // dev-only tools are not shipped
    const text = renderNotices(packages);
    assert.match(text, /proprietary software, \(c\) MarketDragon/);
    assert.match(text, /openai@[\d.]+ - Apache-2\.0/);
    assert.ok(packages.every((p) => p.license && p.license !== 'UNKNOWN'), 'every package declares a license');
});

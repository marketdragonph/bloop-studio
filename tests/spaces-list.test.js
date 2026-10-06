import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server/server.js';
import { pageNumbers } from '../src/server/routes/spaces.js';

const settings = {
    all: () => ({ comfyUrl: 'http://127.0.0.1:9', mediaDir: tmpdir(), llmProvider: 'anthropic', configured: {} }),
    get: (key) => ({ comfyUrl: 'http://127.0.0.1:9', mediaDir: tmpdir() })[key],
    update() {},
    clearSecret() {},
};

/** A server with `names` as its spaces (the last one is the newest). */
async function serverWith(names) {
    const dataDir = mkdtempSync(join(tmpdir(), 'bloop-spaces-list-'));
    const { server, url } = await createServer({ settings, dataDir, dbPath: ':memory:', startWorker: false });
    const page = await (await fetch(`${url}/settings`)).text();
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    for (const name of names) {
        await fetch(`${url}/spaces`, { method: 'POST', redirect: 'manual', headers: { 'X-CSRF-Token': token }, body: new URLSearchParams({ name }) });
    }
    const get = async (path, headers = {}) => (await fetch(url + path, { headers })).text();
    return { get, close: () => { server.close(); rmSync(dataDir, { recursive: true, force: true }); } };
}

const names = (html) => [...html.matchAll(/class="tile__name">([^<]+)</g)].map((m) => m[1]);

test('the pager shows the first, the last and two either side, with gaps', () => {
    assert.deepEqual(pageNumbers(1, 1), [1]);
    assert.deepEqual(pageNumbers(5, 9), [1, null, 3, 4, 5, 6, 7, null, 9]);
    assert.deepEqual(pageNumbers(9, 9), [1, null, 7, 8, 9]);
});

test('the space list has the hangar hero, pages of 12 and a search that swaps only the results', async () => {
    const all = Array.from({ length: 14 }, (_, i) => `Board ${String(i + 1).padStart(2, '0')}`);
    const s = await serverWith([...all, 'Uno and the Lighthouse']);
    try {
        const first = await s.get('/spaces');
        assert.match(first, /class="spaces-hero"/);
        assert.match(first, /spaces-hero-2400\.webp/);
        assert.match(first, /id="space-search"/);
        assert.equal(names(first).length, 12);
        assert.equal(names(first)[0], 'Uno and the Lighthouse', 'newest first');
        assert.match(first, /15 spaces · page 1 of 2/);
        assert.match(first, /href="\/spaces\?page=2"[^>]*rel="next"/);

        const second = await s.get('/spaces?page=2');
        assert.deepEqual(names(second), ['Board 03', 'Board 02', 'Board 01']);
        assert.match(second, /rel="prev"/);
        assert.equal(names(await s.get('/spaces?page=99')).length, 3, 'a page past the end shows the last page');

        // The search box asks for the results only; a history restore gets the whole page.
        const found = await s.get('/spaces?q=uno%20light', { 'HX-Request': 'true', 'HX-Target': 'space-results' });
        assert.doesNotMatch(found, /spaces-hero|<html/);
        assert.deepEqual(names(found), ['Uno and the Lighthouse']);
        assert.match(found, /1 space match “uno light”/);
        assert.match(await s.get('/spaces?q=uno', { 'HX-Request': 'true', 'HX-Target': 'space-results', 'HX-History-Restore-Request': 'true' }), /spaces-hero/);

        const none = await s.get('/spaces?q=50%25_off');
        assert.match(none, /No space matches “50%_off”/, '% and _ are matched as themselves');
        assert.match(none, /id="space-search"[^>]*value="50%_off"|value="50%_off"[^>]*/);
    } finally {
        s.close();
    }
});

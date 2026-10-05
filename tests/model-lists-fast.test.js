// The cards' Model and Length lists never wait (2026-10-06): bloop's model list is kept on this PC per sign-in and
// answered at once (an older one is checked again in the background), signing out forgets it, a slow bloop gives
// up after 10 s; the engine's profile is answered at once while a re-check runs, and a failed check is remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BloopAccount } from '../src/server/services/bloop-account.js';
import { BloopClient } from '../src/server/services/bloop-client.js';
import { EngineProfile } from '../src/server/services/engine-profile.js';

const LIST = { video: [{ key: 'kling/v2-1-pro', name: 'Kling 2.1 Pro', params: { duration: { options: [5, 10] } } }] };

function memorySettings(initial = {}) {
    const store = { bloopAccount: null, bloopToken: null, bloopModels: null, ...initial };
    return { store, get: (k) => store[k], update: (v) => Object.assign(store, v), clearSecret: (k) => { store[k] = null; } };
}

/** A bloop whose /models answers when `release()` is called (or at once with `instant`). */
function slowBloop({ instant = false } = {}) {
    const calls = { models: 0 };
    let release;
    const clientFor = () => ({
        models: () => {
            calls.models += 1;
            return instant ? Promise.resolve(LIST) : new Promise((resolve) => { release = () => resolve(LIST); });
        },
        me: async () => ({ name: 'Jo', paid: true }),
        signOut: async () => null,
    });
    return { calls, clientFor, release: () => release?.() };
}

test('a launch answers with the list kept for this sign-in, at once; a stale one is re-checked in the background', async () => {
    let clock = 1_000_000;
    const first = memorySettings({ bloopToken: 'tok-1' });
    const fresh = slowBloop({ instant: true });
    await new BloopAccount({ settings: first, openExternal() {}, clientFor: fresh.clientFor, now: () => clock }).models();
    assert.deepEqual(first.store.bloopModels.data, LIST, 'kept in settings');
    assert.equal(first.store.bloopModels.who.length, 16);
    assert.ok(!JSON.stringify(first.store.bloopModels).includes('tok-1'), 'never the token itself');

    // The next launch: bloop is slow, the list is 10 minutes old. The answer does not wait for bloop.
    clock += 10 * 60_000;
    const slow = slowBloop();
    const account = new BloopAccount({ settings: first, openExternal() {}, clientFor: slow.clientFor, now: () => clock });
    assert.deepEqual(await account.models(), LIST);
    assert.equal(slow.calls.models, 1, 're-checked in the background');
    assert.deepEqual(await account.models(), LIST);
    assert.equal(slow.calls.models, 1, 'one request at a time');
    slow.release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(first.store.bloopModels.at, clock, 'the new answer is kept');
});

test('another sign-in never sees the kept list, and signing out forgets it', async () => {
    const settings = memorySettings({ bloopToken: 'tok-1' });
    const bloop = slowBloop({ instant: true });
    const account = new BloopAccount({ settings, openExternal() {}, clientFor: bloop.clientFor });
    await account.models();
    settings.store.bloopToken = 'tok-2';
    const other = slowBloop();
    const second = new BloopAccount({ settings, openExternal() {}, clientFor: other.clientFor });
    const answer = second.models();
    assert.equal(other.calls.models, 1, 'a different sign-in asks bloop');
    other.release();
    assert.deepEqual(await answer, LIST);
    await second.signOut();
    assert.equal(settings.store.bloopModels, null);
});

test('the list and the account ask bloop for at most 10 s; a render keeps its long wait', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
        seen.push(init.signal);
        return new Response('{}', { status: 200 });
    };
    const client = new BloopClient('http://bloop.test', 'tok', fetchImpl);
    await client.models();
    await client.me();
    assert.equal(seen.length, 2);
    const source = readFileSync(new URL('../src/server/services/bloop-client.js', import.meta.url), 'utf8');
    assert.match(source, /const QUICK_MS = 10_000;/);
    assert.match(source, /models\(\) \{\n\s+return this\.#request\('GET', '\/models', \{ timeoutMs: QUICK_MS \}\);/);
    assert.match(source, /timeoutMs = 120_000/);
});

test('the engine: a known profile is answered at once while a re-check runs; a failed first check is remembered', async () => {
    let clock = 0;
    let busy = null; // a pending /object_info while ComfyUI renders
    const state = { offline: false, reads: 0 };
    const comfy = () => ({
        baseUrl: 'http://a',
        hardware: async () => {
            if (state.offline) throw new Error('connect ECONNREFUSED');
            return { vramTotalGb: 24 };
        },
        objectInfo: () => {
            state.reads += 1;
            if (state.offline) return Promise.reject(new Error('connect ECONNREFUSED'));
            return busy ? new Promise((resolve) => { busy = resolve; }) : Promise.resolve({});
        },
    });
    const engine = new EngineProfile({ catalog: new Map(), comfy, maxAgeMs: 1000, now: () => clock });
    const known = await engine.current();
    clock = 5000;
    busy = true;
    const started = Date.now();
    assert.equal(await engine.current(), known, 'answered with the profile it has');
    assert.ok(Date.now() - started < 50);
    assert.equal(state.reads, 2, 'and checked again in the background');
    busy({});

    const down = new EngineProfile({ catalog: new Map(), comfy, now: () => clock });
    state.offline = true;
    const reads = state.reads;
    assert.equal((await down.current()).detected, false);
    await down.current();
    assert.equal(state.reads, reads + 1, 'not asked again within 30 s');
});

test('the board loads its three Model lists at once', () => {
    const source = readFileSync(new URL('../public/js/board/generation.js', import.meta.url), 'utf8');
    assert.match(source, /await Promise\.all\(\['image', 'video', 'audio'\]\.map\(/);
});

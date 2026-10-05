import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineProfile } from '../src/server/services/engine-profile.js';

const preset = (variant, unet) => ({
    id: 'zimage-t2i', variant, card: 'image', label: 'Z-Image Turbo', bindings: {},
    graph: { 1: { class_type: 'UNETLoader', _meta: { title: '@model' }, inputs: { unet_name: unet } } },
});
const catalog = new Map([['zimage-t2i', [preset('bf16', 'big.safetensors'), preset('int8', 'small.safetensors')]]]);
const infoWith = (...files) => ({ UNETLoader: { input: { required: { unet_name: [files] } } } });
const hardware = { gpu: 'Fake GPU', backend: 'CUDA', vramTotalGb: 12, vramFreeGb: 11, version: 'fake' };

/** A fake engine: tests change `state` to install files, take it offline or move it. */
function fakeEngine(state) {
    let reads = 0;
    const comfy = () => ({
        baseUrl: state.url,
        hardware: async () => {
            if (state.offline) throw new Error('connect ECONNREFUSED');
            return hardware;
        },
        objectInfo: async () => {
            if (state.offline) throw new Error('connect ECONNREFUSED');
            reads += 1;
            return infoWith(...state.files);
        },
    });
    return { comfy, reads: () => reads };
}

test('detects once, serves the cache, and re-detects on demand', async () => {
    const state = { url: 'http://a', files: ['small.safetensors'] };
    const fake = fakeEngine(state);
    const engine = new EngineProfile({ catalog, comfy: fake.comfy });

    const first = await engine.current();
    assert.equal(first.detected, true);
    assert.equal(first.presets.get('zimage-t2i').variant, 'int8');
    assert.equal(first.hardware.gpu, 'Fake GPU');

    state.files.push('big.safetensors');
    assert.equal((await engine.current()).presets.get('zimage-t2i').variant, 'int8'); // cached
    assert.equal(fake.reads(), 1);
    assert.equal((await engine.current({ refresh: true })).presets.get('zimage-t2i').variant, 'bf16');
    assert.equal(fake.reads(), 2);
});

test('the cache expires, and a different engine address is detected afresh', async () => {
    let clock = 0;
    const state = { url: 'http://a', files: ['small.safetensors'] };
    const fake = fakeEngine(state);
    const engine = new EngineProfile({ catalog, comfy: fake.comfy, maxAgeMs: 1000, now: () => clock });
    await engine.current();
    clock = 500;
    await engine.current();
    assert.equal(fake.reads(), 1);
    clock = 1500;
    await engine.current();
    assert.equal(fake.reads(), 2);
    state.url = 'http://b';
    assert.equal((await engine.current()).url, 'http://b');
    assert.equal(fake.reads(), 3);
});

test('offline: keeps the last profile of that engine, else offers best variants unchecked', async () => {
    let clock = 0;
    const state = { url: 'http://a', files: ['small.safetensors'], offline: true };
    const fake = fakeEngine(state);
    const engine = new EngineProfile({ catalog, comfy: fake.comfy, maxAgeMs: 0, now: () => clock });

    const unseen = await engine.current();
    assert.equal(unseen.detected, false);
    assert.match(unseen.error, /ECONNREFUSED/);
    assert.equal(unseen.presets.get('zimage-t2i').variant, 'bf16');

    state.offline = false;
    const reads = fake.reads();
    assert.equal((await engine.current()).detected, false, 'a failed check is remembered for 30 s: no new request');
    assert.equal(fake.reads(), reads);
    clock = 31_000;
    assert.equal((await engine.current()).detected, true);
    state.offline = true;
    const remembered = await engine.current();
    assert.equal(remembered.detected, true);
    assert.equal(remembered.presets.get('zimage-t2i').variant, 'int8');
});

test('concurrent callers share one detection', async () => {
    const state = { url: 'http://a', files: ['small.safetensors'] };
    const fake = fakeEngine(state);
    const engine = new EngineProfile({ catalog, comfy: fake.comfy });
    await Promise.all([engine.current(), engine.current(), engine.current()]);
    assert.equal(fake.reads(), 1);
});

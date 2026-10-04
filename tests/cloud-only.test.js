import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generationRoutes } from '../src/server/routes/generation.js';
import { firstVariants, loadCatalog } from '../src/server/generation/presets.js';

const presets = firstVariants(loadCatalog());
const cloudModels = { image: [{ key: 'grok/img', name: 'Grok Imagine', credits: 4, params: {} }], video: [] };

/** Routes with a card (no model picked) and an engine that is, or is not, there. */
function app({ detected, installed = false, signedIn = true, family } = {}) {
    let node = { id: 7, space_id: 1, type: 'image', settings: family ? { family } : {} };
    const enqueued = [];
    const routes = generationRoutes({
        spaces: {
            findNode: () => node,
            updateNode: (_s, _n, changes) => (node = { ...node, settings: { ...node.settings, ...changes.settings } }),
            setNodeResult() {},
        },
        jobs: { activeForNode: () => null, enqueue: (job) => (enqueued.push(job), { id: 1 }), queuePosition: () => 1, activeQueue: () => [] },
        events: { node() {}, queue() {} },
        engine: { current: async () => ({ detected, presets }) },
        account: { models: async () => (signedIn ? cloudModels : null) },
        launcher: { state: () => ({ available: installed }) },
    });
    return { routes, enqueued, card: () => node };
}

const ids = async (routes) => (await (await routes.request('/presets/image')).json()).map((f) => f.id);

test('no ComfyUI at all and signed in: bloop models come first, and an untouched card renders on one', async () => {
    const { routes, enqueued, card } = app({ detected: false });
    assert.equal((await ids(routes))[0], 'bloop:grok/img');

    const res = await routes.request('/spaces/1/nodes/7/generate', { method: 'POST' });
    assert.equal(res.status, 202);
    assert.equal(card().settings.family, 'bloop:grok/img');
    assert.equal(enqueued[0].preset, 'bloop:grok/img');
});

test('a ComfyUI that is only switched off keeps local first: an untouched card never spends credits by surprise', async () => {
    const { routes, card } = app({ detected: false, installed: true });
    assert.ok(!(await ids(routes))[0].startsWith('bloop:'));
    await routes.request('/spaces/1/nodes/7/generate', { method: 'POST' });
    assert.ok(!card().settings.family.startsWith('bloop:'));
});

test('an engine answering keeps local first; a card\'s own pick is never changed', async () => {
    assert.ok(!(await ids(app({ detected: true }).routes))[0].startsWith('bloop:'));

    const picked = app({ detected: false, family: 'zimage' });
    await picked.routes.request('/spaces/1/nodes/7/generate', { method: 'POST' });
    assert.equal(picked.card().settings.family, 'zimage');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cloudFamilies, cloudParams, isCloudFamily } from '../src/server/generation/cloud-models.js';
import { CLOUD_STAGES } from '../src/server/generation/cloud-stages.js';
import { runPipeline } from '../src/server/generation/pipeline.js';
import { BloopAccount } from '../src/server/services/bloop-account.js';
import { BloopClient } from '../src/server/services/bloop-client.js';

const KLING = {
    key: 'kling/v2-1-pro', name: 'Kling 2.1 Pro', credits: 40, requires_image: true, has_end_frame: true, image_variant: null,
    params: {
        duration: { type: 'select', options: ['5', '10'], default: '5' },
        aspect_ratio: { type: 'select', options: ['16:9', '9:16', '1:1'], default: '16:9' },
    },
};
const MODELS = { image: [], video: [KLING] };

function memorySettings(initial = {}) {
    const store = { bloopAccount: null, bloopToken: null, ...initial };
    return {
        store,
        get: (key) => store[key],
        update: (values) => Object.assign(store, values),
        clearSecret: (key) => { store[key] = null; },
    };
}

test('a bloop model becomes a card family with only the knobs it takes, at its own defaults', () => {
    const [family] = cloudFamilies(MODELS, 'video');
    assert.equal(family.id, 'bloop:kling/v2-1-pro');
    assert.ok(isCloudFamily(family.id));
    assert.equal(family.description, 'bloop cloud · from 40 credits');
    assert.deepEqual(family.options.durations, [{ value: '5', label: '5 s' }, { value: '10', label: '10 s' }]);
    assert.deepEqual(family.options.resolutions, []); // Kling has none: the card hides the knob
    assert.deepEqual(family.defaults, { aspect: '16:9', duration: '5' });
    assert.deepEqual(cloudFamilies(null, 'video'), []);
});

test('a card sends only the params its model declares, and only offered values', () => {
    assert.deepEqual(cloudParams(KLING, { aspect: '9:16', duration: '10', resolution: '720p', quality: 'final' }), { aspect_ratio: '9:16', duration: '10' });
    assert.deepEqual(cloudParams(KLING, { aspect: '21:9' }), {});
});

test('signing in: the browser hands back a code, swapped with the PKCE verifier for a token', async () => {
    const settings = memorySettings();
    let opened = null;
    let exchanged = null;
    const clientFor = (url, token) => Object.assign(new BloopClient(url, token), {
        exchange: async (body) => {
            exchanged = body;
            return { token: 'tok-1', account: { name: 'Jo', paid: true } };
        },
    });
    const account = new BloopAccount({ baseUrl: 'http://bloop.test', settings, openExternal: (url) => { opened = new URL(url); }, clientFor });

    await account.startSignIn();
    assert.equal(account.state().status, 'waiting');
    assert.equal(opened.origin + opened.pathname, 'http://bloop.test/studio/connect');
    const port = opened.searchParams.get('port');
    const state = opened.searchParams.get('state');

    // A stranger's callback with the wrong state is refused and changes nothing.
    assert.equal((await fetch(`http://127.0.0.1:${port}/callback?code=x&state=wrong`)).status, 400);
    const answer = await fetch(`http://127.0.0.1:${port}/callback?code=one-time&state=${state}`);
    assert.match(await answer.text(), /Bloop Studio is connected/);

    const challenge = createHash('sha256').update(exchanged.verifier).digest('base64url');
    assert.equal(challenge, opened.searchParams.get('code_challenge'));
    assert.equal(exchanged.code, 'one-time');
    assert.equal(settings.store.bloopToken, 'tok-1');
    assert.deepEqual(account.state(), { status: 'signed-in', account: { name: 'Jo', paid: true }, error: null });
});

test('canceling in the browser leaves the app signed out with a reason', async () => {
    let opened = null;
    const account = new BloopAccount({ baseUrl: 'http://bloop.test', settings: memorySettings(), openExternal: (url) => { opened = new URL(url); } });
    await account.startSignIn();
    await fetch(`http://127.0.0.1:${opened.searchParams.get('port')}/callback?error=access_denied&state=${opened.searchParams.get('state')}`);
    assert.deepEqual(account.state(), { status: 'signed-out', error: 'Sign-in was canceled.' });
});

test('a revoked token signs the app out; signed out offers no cloud models', async () => {
    const expired = Object.assign(new Error('Unauthenticated.'), { status: 401 });
    const settings = memorySettings({ bloopToken: 'old', bloopAccount: { paid: true } });
    const account = new BloopAccount({ baseUrl: 'http://bloop.test', settings, openExternal: () => {}, clientFor: () => ({ me: async () => { throw expired; } }) });
    await account.refresh();
    assert.equal(settings.store.bloopToken, null);
    assert.equal(account.state().status, 'signed-out');
    assert.equal(await account.models(), null);
});

test('bloop decides what a plan sees: a free account gets its list, a refused one is not asked again', async () => {
    let asked = 0;
    const cheap = { image: [], video: [{ key: 'runway/gen4', name: 'Runway Gen-4', credits: 13, params: {} }] };
    const free = new BloopAccount({ baseUrl: 'http://bloop.test',
        settings: memorySettings({ bloopToken: 't', bloopAccount: { paid: false } }),
        openExternal: () => {},
        clientFor: () => ({ models: async () => { asked++; return cheap; } }),
    });
    assert.deepEqual(await free.models(), cheap);

    const refused = Object.assign(new Error('Needs Lite.'), { status: 402 });
    const older = new BloopAccount({ baseUrl: 'http://bloop.test',
        settings: memorySettings({ bloopToken: 't', bloopAccount: { paid: false } }),
        openExternal: () => {},
        clientFor: () => ({ models: async () => { asked++; throw refused; }, me: async () => ({ paid: false }) }),
    });
    assert.equal(await older.models(), null);
    assert.equal(await older.models(), null);
    assert.equal(asked, 2); // one for the free list, one refusal, then the cache answers
});

/** A card wired with a first and a last frame, rendered through the cloud stages against a fake bloop. */
function cloudCard({ resumeId = null, statuses = [] } = {}) {
    const calls = { render: null, saved: null, takes: [], promptIds: [] };
    const client = {
        render: async (body) => {
            calls.render = body;
            return { id: 77, status: 'generating' };
        },
        status: async () => statuses.shift() ?? { status: 'generating' },
        download: async () => ({ bytes: Buffer.from('mp4'), mime: 'video/mp4' }),
    };
    const ctx = {
        job: { id: 1, comfy_prompt_id: resumeId },
        node: { id: 9, space_id: 3, type: 'video', label: 'Shot 1', settings: { family: 'bloop:kling/v2-1-pro', duration: '10', aspect: '9:16' } },
        report: () => {},
        pollMs: 1,
        deps: {
            account: { models: async () => MODELS, client: () => client },
            spaces: {
                upstreamOf: () => [
                    { to_socket: 'prompt', text_content: 'The door swings open.' },
                    { to_socket: 'first_frame', type: 'image', media_path: 'a/first.png', media_mime: 'image/png' },
                    { to_socket: 'last_frame', type: 'image', media_path: 'a/last.png', media_mime: 'image/png' },
                ],
                setNodeResult: () => {},
            },
            media: {
                read: async (path) => Buffer.from(path),
                saveTake: async (take) => {
                    calls.saved = take;
                    return 'spaces/3/card-9/take.mp4';
                },
            },
            jobs: { setPromptId: (id, promptId) => calls.promptIds.push(promptId), addTake: (take) => calls.takes.push(take) },
        },
    };
    return { ctx, calls };
}

test('a cloud card sends its words, knobs and both frames to bloop and saves the result as a take', async () => {
    const { ctx, calls } = cloudCard({ statuses: [{ status: 'generating' }, { status: 'success', video_url: 'http://bloop.test/r.mp4' }] });
    await runPipeline(CLOUD_STAGES, ctx);

    assert.equal(calls.render.prompt, 'The door swings open.');
    assert.deepEqual(calls.render.params, { aspect_ratio: '9:16', duration: '10' });
    assert.deepEqual(Object.keys(calls.render.pictures), ['first_frame', 'last_frame']);
    assert.deepEqual(calls.promptIds, ['bloop:77']); // kept so a restart polls instead of paying twice
    assert.equal(calls.saved.mime, 'video/mp4');
    assert.equal(calls.takes[0].preset, 'bloop:kling/v2-1-pro');
    assert.deepEqual(ctx.result, { media_path: 'spaces/3/card-9/take.mp4', media_mime: 'video/mp4' });
});

test('after a restart the same bloop render is polled, never sent again', async () => {
    const { ctx, calls } = cloudCard({ resumeId: 'bloop:77', statuses: [{ status: 'success', video_url: 'http://bloop.test/r.mp4' }] });
    await runPipeline(CLOUD_STAGES, ctx);
    assert.equal(calls.render, null);
    assert.equal(calls.takes.length, 1);
});

test('a failed bloop render says why, and whether the credits came back', async () => {
    const { ctx } = cloudCard({ statuses: [{ status: 'failed', error: 'The model refused the prompt.', credits_returned: true }] });
    await assert.rejects(runPipeline(CLOUD_STAGES, ctx), /refused the prompt\. Your credits were returned\./);
});

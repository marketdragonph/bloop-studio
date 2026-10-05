// Render missing beats (05-irresistible.md §2.2, owner decision 7): the owed set, the wire order, the skip on a failed
// upstream card, the time and credits shown first, the plain refusal when bloop credits are short, Cancel all, the
// CSRF guard, and that no Director tool can reach it. Temp SQLite, fake worker and account, never the GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { cutFixture, TOKEN } from './cut-fixture.js';
import { csrf } from '../src/server/middleware/csrf.js';
import { renderPlanRoutes } from '../src/server/routes/render-plan.js';
import { RenderPlan } from '../src/server/generation/render-plan/index.js';
import { queueCard } from '../src/server/generation/enqueue.js';
import { defaultSource } from '../src/shared/card-source.js';
import './cut-dock-fakes.js'; // maps /shared/ for the dock's own modules

const { renderLines, renderTime } = await import('../public/js/components/cut-render.js');

const LOCAL = { image: [{ id: 'zimage', label: 'Z-Image' }], video: [{ id: 'wan5b', label: 'Wan 2.2 5B' }], audio: [{ id: 'acestep', label: 'ACE-Step' }] };
const CLOUD = { video: [{ id: 'bloop:kling', label: 'Kling' }], image: [{ id: 'bloop:flux', label: 'Flux' }], audio: [{ id: 'bloop:music-1', label: 'Music 1' }] };

/** card-source.js for a PC with an engine (local first) or cloud only. */
const sourcesFor = (mode) => async (type) => defaultSource({ engineReady: mode === 'local', signedIn: mode !== 'none', local: LOCAL[type] ?? [], cloud: mode === 'none' ? [] : CLOUD[type] ?? [] });

async function planFixture(t, { mode = 'local', credits = 600, account: accountOverride } = {}) {
    const f = await cutFixture('bloop-render-plan-');
    t.after(() => f.close());
    const cancelled = [];
    const worker = { cancel: async (nodeId) => { cancelled.push(nodeId); f.jobs.finish(f.jobs.activeForNode(nodeId).id, 'canceled'); return true; } };
    const account = accountOverride ?? {
        refresh: async () => {},
        state: () => ({ account: { credits } }),
        models: async () => ({ video: [{ key: 'kling', name: 'Kling', credits: 40 }], image: [{ key: 'flux', name: 'Flux', credits: 4 }], audio: [{ key: 'music-1', name: 'Music 1', credits: 20 }] }),
    };
    const deps = { ...f, worker, account, sources: sourcesFor(mode) };
    const app = new Hono();
    app.use('*', csrf(TOKEN));
    app.route('/', renderPlanRoutes(deps));
    const send = (method, path, { token = TOKEN } = {}) => app.request(path, { method, headers: token ? { 'x-csrf-token': token } : {} });

    // A planned board: beat 1 rendered; beat 2 never rendered (words → still → clip, still not rendered);
    // beat 3's clip failed (its still is done); beat 4's still failed; a music bed and a voice bed with no render.
    const { space, plan, clips } = f.board('plan', ['s1-open', 's2-turn', 's3-chase', 's4-close'], ['s1-open'], { music: false });
    const card = (type, label, extra = {}) => {
        const node = f.spaces.createNode(space.id, { type, label });
        if (extra.status) f.spaces.setNodeResult(node.id, { status: extra.status, error: extra.error ?? null, media_path: extra.media, media_mime: extra.media ? 'image/png' : undefined });
        if (extra.settings) f.spaces.updateNode(space.id, node.id, { settings: extra.settings });
        return f.spaces.findNode(space.id, node.id);
    };
    const wire = (from, to, socket) => f.spaces.connect(space.id, from.id, to.id, socket);
    const words = card('text', 's2 words');
    const still2 = card('image', 's2 still');
    const clip2 = card('video', 's2-turn');
    wire(words, still2, 'prompt'); wire(words, clip2, 'prompt'); wire(still2, clip2, 'first_frame');
    const still3 = card('image', 's3 still', { status: 'done', media: 'spaces/x/still3.png' });
    const clip3 = card('video', 's3-chase', { status: 'failed', error: 'out of memory' });
    wire(still3, clip3, 'first_frame');
    const still4 = card('image', 's4 still', { status: 'failed', error: 'bad words' });
    const clip4 = card('video', 's4-close');
    wire(still4, clip4, 'first_frame');
    const bed = card('audio', 'music bed');
    const voice = card('audio', 'voice');
    return { ...f, app, send, deps, cancelled, space, plan, clips, nodes: { words, still2, clip2, still3, clip3, still4, clip4, bed, voice } };
}

test('the owed set: missing and failed beats with their unrendered pictures, the bed; done cards never again', async (t) => {
    const f = await planFixture(t);
    const summary = await new RenderPlan({ ...f.deps }).preview(f.space.id);
    const { still2, clip2, clip3, bed } = f.nodes;
    assert.deepEqual(summary.items.map((c) => c.node_id), [still2.id, clip2.id, clip3.id, bed.id], 'references, then clips, then the bed');
    assert.deepEqual(summary.items.map((c) => c.role), ['reference', 'beat', 'beat', 'bed']);
    assert.equal(summary.beats, 2);
    assert.equal(summary.cards, 4);
    assert.ok(!summary.items.some((c) => c.node_id === f.clips['s1-open'].node.id), 'a rendered beat is never queued again');
    assert.ok(!summary.items.some((c) => c.node_id === f.nodes.still3.id), 'a done picture is never queued again');
    // Skipped with plain reasons: beat 4's picture failed; the voice needs a bloop voice model.
    assert.equal(summary.skipped.length, 2);
    assert.match(summary.skipped[0].reason, /^04 · Close: its picture card "s4 still" failed last time/);
    assert.match(summary.skipped[1].reason, /voices do not render on this PC/);
    assert.deepEqual(summary.items.map((c) => c.model), ['Z-Image', 'Wan 2.2 5B', 'Wan 2.2 5B', 'ACE-Step']);
    assert.equal(summary.local.seconds, null, 'no past renders: no time is guessed');
    assert.equal(summary.cloud.cards, 0);
    assert.equal(f.jobs.activeQueue().length, 0, 'the sheet reads only');
});

test('the press queues each card once, in wire order, through the per-card path; a second press has nothing to do', async (t) => {
    const f = await planFixture(t);
    const nodes = [];
    f.events.on('node', (u) => nodes.push(u));
    const refused = await f.send('POST', `/spaces/${f.space.id}/render-plan`, { token: null });
    assert.equal(refused.status, 403, 'CSRF');
    const res = await f.send('POST', `/spaces/${f.space.id}/render-plan`);
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.queued, 4);
    const queue = f.jobs.activeQueue();
    const { still2, clip2, clip3, bed } = f.nodes;
    assert.deepEqual(queue.map((j) => j.nodeId), [still2.id, clip2.id, clip3.id, bed.id]);
    assert.deepEqual(nodes.map((u) => [u.nodeId, u.status]), queue.map((j) => [j.nodeId, 'queued']));
    assert.equal(f.spaces.findNode(f.space.id, clip2.id).settings.family, 'wan5b', 'a card with no pick gets the first model its list offers');
    // The worker waits for the still before the clip it feeds (jobs.claimNext), and the queue keeps that order.
    assert.equal(f.jobs.claimNext().node_id, still2.id);

    const again = await f.send('POST', `/spaces/${f.space.id}/render-plan`);
    assert.equal(again.status, 422);
    assert.match((await again.json()).error, /already has its video, or is on its way/);
});

test('a time shows only when every model has past renders; Cancel all stops the renders the press queued', async (t) => {
    const f = await planFixture(t);
    const past = (preset, seconds) => {
        const job = f.jobs.enqueue({ nodeId: f.clips['s1-open'].node.id, preset });
        f.db.prepare("UPDATE jobs SET status = 'succeeded', started_at = '2026-10-05T10:00:00.000Z', finished_at = ? WHERE id = ?")
            .run(new Date(Date.parse('2026-10-05T10:00:00.000Z') + seconds * 1000).toISOString(), job.id);
    };
    past('zimage', 20);
    past('wan5b', 100);
    assert.equal((await new RenderPlan(f.deps).preview(f.space.id)).local.seconds, null, 'ACE-Step has no past render');
    past('acestep', 60);
    const summary = await new RenderPlan(f.deps).preview(f.space.id);
    assert.equal(summary.local.seconds, 20 + 100 + 100 + 60);
    assert.deepEqual(renderLines(summary), [`4 cards on this PC · ${renderTime(280)} · you can keep working`]);

    // The person started a card of their own with Generate (the per-card path, no origin) before the press.
    const mine = f.spaces.createNode(f.space.id, { type: 'image', label: 'my own still' });
    queueCard(f.deps, mine);
    await f.send('POST', `/spaces/${f.space.id}/render-plan`);
    const marked = f.jobs.activeQueue();
    assert.deepEqual(marked.map((j) => j.origin), [null, 'render-plan', 'render-plan', 'render-plan', 'render-plan'], 'the queue stream says which press');
    const res = await f.send('DELETE', `/spaces/${f.space.id}/render-plan`);
    assert.deepEqual(await res.json(), { cancelled: 4 });
    assert.deepEqual(f.jobs.activeQueue().map((j) => j.nodeId), [mine.id], 'a card started with Generate keeps going');
    assert.ok(!f.cancelled.includes(mine.id));
});

test('on bloop: the credits and the balance come first, and a shortfall is refused with nothing queued', async (t) => {
    const short = await planFixture(t, { mode: 'cloud', credits: 50 });
    const summary = await new RenderPlan(short.deps).preview(short.space.id);
    // still 4 + clip 40 + clip 40 + music 20 = 104 credits.
    assert.deepEqual(summary.cloud, { cards: 4, credits: 104, balance: 50, short: true });
    assert.deepEqual(summary.items.map((c) => c.family), ['bloop:flux', 'bloop:kling', 'bloop:kling', 'bloop:music-1']);
    assert.deepEqual(renderLines(summary), ['4 cards · about 104 credits · you have 50 · renders on bloop']);
    const res = await short.send('POST', `/spaces/${short.space.id}/render-plan`);
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: 'This needs about 104 credits and you have 50 on bloop. Nothing was queued.', code: 'short' });
    assert.equal(short.jobs.activeQueue().length, 0);

    const enough = await planFixture(t, { mode: 'cloud', credits: 600 });
    assert.equal((await enough.send('POST', `/spaces/${enough.space.id}/render-plan`)).status, 202);
    assert.equal(enough.spaces.findNode(enough.space.id, enough.nodes.clip2.id).settings.family, 'bloop:kling');

    const unknown = await planFixture(t, { mode: 'cloud', account: { state: () => ({ account: {} }), models: async () => ({}) } });
    const refused = await unknown.send('POST', `/spaces/${unknown.space.id}/render-plan`);
    assert.equal(refused.status, 422);
    assert.match((await refused.json()).error, /Could not read what these bloop models cost/);
});

test('no engine and no sign-in: nothing can render, said plainly, nothing queued', async (t) => {
    const f = await planFixture(t, { mode: 'none' });
    const summary = await new RenderPlan(f.deps).preview(f.space.id);
    assert.match(summary.blocked, /^Nothing can render yet\. Install the engine in Settings, or sign in to bloop/);
    const res = await f.send('POST', `/spaces/${f.space.id}/render-plan`);
    assert.equal(res.status, 422);
    assert.equal(f.jobs.activeQueue().length, 0);
});

test('zero calls from the Director: no Director file reaches the render plan or the job queue', () => {
    const dir = fileURLToPath(new URL('../src/server/director/', import.meta.url));
    const files = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));
    for (const file of files(dir).filter((f) => f.endsWith('.js'))) {
        const text = readFileSync(file, 'utf8');
        assert.doesNotMatch(text, /render-plan|RenderPlan|queueCard|jobs\.enqueue|\/generate\b/, file);
    }
});

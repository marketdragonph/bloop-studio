// Starter boards (05-irresistible.md §2.4): three small plans, briefs only, no media, no franchise or rival editor
// names. One press lays a starter out as a normal finished plan that BoardCut orders without ORDER_GUESSED, so the
// live cut and Render missing beats work unchanged. The modal follows the HTMX pattern; CSRF guards the posts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { cutFixture, TOKEN } from './cut-fixture.js';
import { csrf } from '../src/server/middleware/csrf.js';
import { createViews } from '../src/server/views.js';
import { StarterBoards, loadStarters, starterOps } from '../src/server/spaces/apply-starter.js';
import { BoardOps } from '../src/server/director/ops/board-ops.js';
import { ValidationError } from '../src/server/repositories/spaces.js';
import { starterRoutes } from '../src/server/routes/starters.js';
import { RenderPlan } from '../src/server/generation/render-plan/index.js';
import { defaultSource } from '../src/shared/card-source.js';

const DIR = new URL('../src/shared/starters/', import.meta.url);
const BANNED = /gundam|rx-?78|mobile suit|zeon|zaku|amuro|char aznable|evangelion|macross|mazinger|transformers|voltron|capcut|premiere|davinci|final cut|imovie/i;
const local = async (type) => defaultSource({ engineReady: true, signedIn: false, local: [{ id: { image: 'zimage', video: 'wan5b', audio: 'acestep' }[type], label: type }] });

async function starterFixture(t, { sources = local } = {}) {
    const f = await cutFixture('bloop-starters-');
    t.after(() => f.close());
    const ops = new BoardOps({ spaces: f.spaces });
    const starters = new StarterBoards({ db: f.db, spaces: f.spaces, plans: f.plans, ops, sources });
    const views = createViews({ csrfToken: TOKEN });
    const app = new Hono();
    app.use('*', csrf(TOKEN));
    app.route('/', starterRoutes({ ...f, views, starters }));
    return { ...f, ops, starters, app };
}

test('three starter files: small, complete, words only, no franchise or rival editor names', () => {
    const files = readdirSync(DIR).filter((n) => n.endsWith('.json'));
    assert.equal(files.length, 3);
    for (const name of files) {
        const text = readFileSync(new URL(name, DIR), 'utf8');
        assert.ok(text.split('\n').length <= 120, `${name} under 120 lines`);
        assert.doesNotMatch(text, BANNED, name);
        assert.doesNotMatch(text, /\.(mp4|png|jpe?g|mp3|wav)\b|https?:/i, `${name}: briefs only, no media`);
        const s = JSON.parse(text);
        for (const key of ['id', 'title', 'line', 'approach', 'aspect', 'runtime_seconds', 'clip_seconds', 'beats']) assert.ok(s[key], `${name}: ${key}`);
        assert.equal(s.beats.length * s.clip_seconds, s.runtime_seconds, `${name}: the beats add up to the runtime`);
        for (const b of s.beats) for (const key of ['tag', 'role', 'brief', 'shot']) assert.ok(b[key], `${name} ${b.tag}: ${key}`);
    }
    assert.deepEqual(loadStarters().map((s) => s.line), [
        'Night drive · 4 beats · 0:20 · music', 'Postcard from the sea · 5 beats · 0:25 · voice + music', 'Product turn · 3 beats · 0:12',
    ]);
});

test('every starter lays out through BoardOps: wired words, stills, clips, a music bed', () => {
    for (const s of loadStarters()) {
        const ops = starterOps(s);
        assert.ok(ops.length <= 60, `${s.id}: within one op list`);
        assert.equal(ops.filter((o) => o.type === 'video').length, s.beats.length);
        assert.equal(ops.some((o) => o.title === 'music bed'), Boolean(s.music));
        assert.equal(ops.some((o) => o.title === 'voice'), Boolean(s.voice));
        assert.ok(!ops.some((o) => o.op === 'title'), 'the space keeps the name the person gave it');
    }
});

test('a starter is a normal finished plan: BoardCut orders it without ORDER_GUESSED, Render missing beats owes it all', async (t) => {
    const f = await starterFixture(t);
    const space = f.spaces.create({ name: 'Mine' });
    const { plan, nodes } = await f.starters.apply(space.id, 'night-drive');
    assert.equal(f.spaces.find(space.id).name, 'Mine');
    assert.equal(plan.aspect, '16:9');
    assert.equal(plan.runtime_seconds, 20);
    assert.ok(plan.built_at && plan.dispatched_at);
    const beats = f.plans.beats(plan.id);
    assert.deepEqual(beats.map((b) => [b.tag, b.staging.role, b.state, b.node_ids.length]), [
        ['s1-ignition', 'hook', 'written', 3], ['s2-city', 'setup', 'written', 3], ['s3-red-light', 'turn', 'written', 3], ['s4-open-road', 'close', 'written', 3],
    ]);
    assert.equal(nodes.length, 4 * 3 + 2);
    assert.equal(f.spaces.board(space.id).connections.length, 4 * 3 + 1);

    const read = f.boardCut.read(space.id);
    assert.equal(read.guessed, false);
    assert.ok(!read.findings.some((x) => x.code === 'ORDER_GUESSED'));
    assert.deepEqual(read.slots.map((s) => [s.beat_tag, s.reason]), beats.map((b) => [b.tag, 'never_rendered']));

    const sheet = await new RenderPlan({ ...f, worker: null, sources: local }).preview(space.id);
    assert.equal(sheet.beats, 4);
    assert.equal(sheet.cards, 4 + 4 + 1, '4 stills, 4 clips, the music bed');
});

test('cloud only: the starter\'s cards start on bloop\'s models (the music bed on a music model)', async (t) => {
    const cloud = async (type) => defaultSource({ engineReady: false, signedIn: true, local: [], cloud: {
        image: [{ id: 'bloop:flux', label: 'Flux' }], video: [{ id: 'bloop:kling', label: 'Kling' }],
        audio: [{ id: 'bloop:voice-1', label: 'Voice' }, { id: 'bloop:music-2', label: 'Music 2' }],
    }[type] });
    const f = await starterFixture(t, { sources: cloud });
    const space = f.spaces.create({ name: 'Sea' });
    await f.starters.apply(space.id, 'postcard-sea');
    const byLabel = (label) => f.spaces.board(space.id).nodes.find((n) => n.label === label);
    assert.equal(byLabel('s1-harbour').settings.family, 'bloop:kling');
    assert.equal(byLabel('s1-harbour still').settings.family, 'bloop:flux');
    assert.equal(byLabel('music bed').settings.family, 'bloop:music-2');
    assert.equal(byLabel('voice').settings.family, undefined, 'the voice waits for the person to pick a voice');
});

test('a starter goes only on an empty board; the routes: modal, new space, CSRF, refusal', async (t) => {
    const f = await starterFixture(t);
    const busy = f.spaces.create({ name: 'Busy' });
    f.spaces.createNode(busy.id, { type: 'text' });
    await assert.rejects(f.starters.apply(busy.id, 'product-turn'), ValidationError);
    await assert.rejects(f.starters.apply(busy.id, 'nope'), /does not exist/);

    const modal = await f.app.request('/spaces/starters');
    assert.equal(modal.status, 200);
    const html = await modal.text();
    assert.equal(html.match(/data-control="board.starterPick"/g)?.length, 3);
    assert.match(html, /Night drive · 4 beats · 0:20 · music/);
    assert.match(html, /hx-post="\/spaces\/starters"/);
    assert.match(await (await f.app.request(`/spaces/starters?space=${busy.id}`)).text(), new RegExp(`hx-post="/spaces/${busy.id}/starter"`));

    const form = (starter, token = TOKEN) => ({ method: 'POST', body: new URLSearchParams({ starter }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'hx-request': 'true', ...(token ? { 'x-csrf-token': token } : {}) } });
    assert.equal((await f.app.request('/spaces/starters', form('product-turn', null))).status, 403);
    const made = await f.app.request('/spaces/starters', form('product-turn'));
    assert.equal(made.status, 204);
    const id = Number(made.headers.get('hx-redirect').split('/').pop());
    assert.equal(f.spaces.find(id).name, 'Product turn');
    assert.equal(f.plans.beats(f.plans.latest(id).id).length, 3);

    const refused = await f.app.request(`/spaces/${busy.id}/starter`, form('product-turn'));
    assert.equal(refused.status, 422);
    assert.match(await refused.text(), /Starters go on an empty board/);
});

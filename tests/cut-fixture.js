// A board with a plan, rendered beat cards (measured takes) and a music bed, plus the cut routes behind the CSRF
// guard — for the Cut save and draft tests. Temp SQLite file, no ComfyUI, no ffmpeg.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { JobsRepository } from '../src/server/repositories/jobs.js';
import { DirectorPlans } from '../src/server/repositories/director-plans.js';
import { CutsRepository } from '../src/server/repositories/cuts.js';
import { BoardCut } from '../src/server/cut/board-cut.js';
import { BoardEvents } from '../src/server/generation/events.js';
import { csrf } from '../src/server/middleware/csrf.js';
import { cutRoutes } from '../src/server/routes/cut.js';

export const TOKEN = 'b'.repeat(64);

export async function cutFixture(prefix) {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    const db = openDatabase(join(dir, 'test.db'));
    const spaces = new SpacesRepository(db);
    const jobs = new JobsRepository(db);
    const plans = new DirectorPlans(db);
    const cuts = new CutsRepository(db);
    const events = new BoardEvents();
    const boardCut = new BoardCut({ db });
    const deps = { db, spaces, jobs, plans, cuts, events, boardCut };
    const app = new Hono();
    app.use('*', csrf(TOKEN));
    app.route('/', cutRoutes(deps));

    /** A rendered card: a done take of `ms` (measured unless `measured: false`). Returns {node, take}. */
    const clip = (spaceId, label, ms = 4000, { type = 'video', mime = 'video/mp4', measured = true } = {}) => {
        const node = spaces.createNode(spaceId, { type, label });
        spaces.updateNode(spaceId, node.id, { settings: { duration: ms / 1000 } });
        const path = `spaces/${spaceId}/card-${node.id}/take.${mime.split('/')[1]}`;
        jobs.addTake({ nodeId: node.id, mediaPath: path, mime, preset: 'wan5b', seed: 1, params: {} });
        const take = cuts.takeFor(node.id, path);
        if (measured) cuts.setTakeDuration(take.id, ms);
        spaces.setNodeResult(node.id, { status: 'done', media_path: path, media_mime: mime });
        return { node, take: cuts.takeFor(node.id, path) };
    };

    /** A space with a plan of `tags` beats; `rendered` tags get a measured clip card. */
    const board = (name, tags, rendered = tags, { music = true, aspect = '16:9' } = {}) => {
        const space = spaces.create({ name });
        const plan = plans.create(space.id, { aspect });
        plans.saveBeats(plan.id, tags.map((tag, i) => ({ tag, lane: i + 1, brief: 'b' })));
        const clips = Object.fromEntries(rendered.map((tag, i) => [tag, clip(space.id, tag, 3000 + i * 1000)]));
        const bed = music ? clip(space.id, 'music bed', 60_000, { type: 'audio', mime: 'audio/mpeg' }) : null;
        return { space, plan, clips, bed };
    };

    /** Every `cut` event sent while `fn` runs. */
    const listen = async (fn) => {
        const sent = [];
        const on = (u) => sent.push(u);
        events.on('cut', on);
        try {
            await fn();
        } finally {
            events.off('cut', on);
        }
        return sent;
    };

    const send = (method, path, payload, { token = TOKEN } = {}) => app.request(path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
        body: payload === undefined ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload),
    });

    const close = async () => {
        db.close();
        await rm(dir, { recursive: true, force: true });
    };

    return { db, ...deps, app, clip, board, listen, send, close };
}

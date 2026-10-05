// StoreResult (01-core.md §6, 05 §5.2–§5.3): the poster frame, then the move into the media folder under a
// story name (`night-market-youtube-r12.mp4`, the poster beside it), then a new video card at the end of the
// board's first row with a `takes` row (preset 'cut', so BoardCut never takes it as a clip) and the events.
import { mkdir, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { storyFileName } from '../../../shared/safe-name.js';
import { now } from '../../db/database.js';
import { posterArgs } from './recipe.js';

const CARD_GAP = 80;
const DEFAULT_WIDTH = 320;

/** The poster time in export ms: the cut's set poster, else the middle of the first clip. */
const posterMs = (ctx) => {
    const set = Number(ctx.snapshot.settings?.poster_ms);
    const first = ctx.layout.items[0];
    const at = Number.isFinite(set) && set >= 0 ? set : ((first?.lenF ?? 0) / 2) * (1000 / 30);
    return Math.max(0, Math.min(at, ctx.totalMs - 100));
};

/** A file name in the cuts folder that is not taken yet (old revisions keep their names). */
function freeName(dir, parts) {
    for (let n = 1; n < 100; n++) {
        const name = storyFileName({ ...parts, n });
        const poster = storyFileName({ ...parts, n, suffix: '-poster', ext: 'jpg' });
        if (!existsSync(join(dir, name)) && !existsSync(join(dir, poster))) return { name, poster };
    }
    return { name: storyFileName({ ...parts, n: Date.now() }), poster: storyFileName({ ...parts, n: Date.now(), suffix: '-poster', ext: 'jpg' }) };
}

/** Right of the right-most card, level with the top row. */
function cardPlace(db, spaceId) {
    const row = db.prepare('SELECT MAX(position_x + COALESCE(width, ?)) AS right, MIN(position_y) AS top FROM space_nodes WHERE space_id = ?').get(DEFAULT_WIDTH, spaceId);
    return { x: (row?.right ?? 0) + CARD_GAP, y: row?.top ?? 0 };
}

export async function storeResult(ctx, next) {
    const { media, spaces, db, exportsRepo, events } = ctx.deps;
    const rev = ctx.snapshot.revision;
    ctx.alive();
    // Poster: one capped step; a poster that fails never fails the export.
    const posterTmp = join(ctx.tmp, 'poster.jpg');
    let hasPoster = false;
    try {
        await ctx.step(posterArgs({ input: ctx.final, atSec: posterMs(ctx) / 1000, out: posterTmp }), { label: 'Saving to your media folder', weight: ctx.weights.poster, timeoutMs: 20_000, capBytes: 2 * 1024 * 1024 });
        hasPoster = existsSync(posterTmp);
    } catch (error) {
        if (error.name === 'AbortError' || ctx.gone) throw error;
        ctx.deps.log?.warn?.(`Cut export ${ctx.exportId}: no poster: ${error.message}`);
    }
    ctx.alive();

    const space = spaces.find(ctx.spaceId);
    const dir = media.resolve(`spaces/${ctx.spaceId}/cuts`);
    await mkdir(dir, { recursive: true });
    const { name, poster } = freeName(dir, { story: space?.name, preset: ctx.output.preset, revision: rev, ext: 'mp4' });
    const finalPath = join(dir, name);
    await rename(ctx.final, finalPath);
    const rel = (full) => relative(media.getRoot(), full).split(sep).join('/');
    let posterRel = null;
    if (hasPoster) {
        await rename(posterTmp, join(dir, poster));
        posterRel = rel(join(dir, poster));
    }
    const mediaPath = rel(finalPath);
    const { size: bytes } = await stat(finalPath);

    // The card: "Cut · r12 · YouTube", right of the board, with its take (preset 'cut').
    const place = cardPlace(db, ctx.spaceId);
    const label = `Cut · r${rev} · ${ctx.output.label}`;
    const node = spaces.createNode(ctx.spaceId, { type: 'video', label, position_x: place.x, position_y: place.y });
    spaces.updateNode(ctx.spaceId, node.id, { settings: { duration: ctx.totalMs / 1000, aspect: ctx.output.aspect, cut_export_id: ctx.exportId } });
    const params = { export_id: ctx.exportId, revision: rev, preset: ctx.output.preset, width: ctx.output.width, height: ctx.output.height, fps: ctx.output.fps, poster: posterRel };
    db.prepare('INSERT INTO takes (node_id, media_path, media_mime, preset, seed, params, duration_ms, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)')
        .run(node.id, mediaPath, 'video/mp4', 'cut', JSON.stringify(params), ctx.totalMs, now());
    spaces.setNodeResult(node.id, { status: 'done', media_path: mediaPath, media_mime: 'video/mp4' });

    ctx.report.poster_path = posterRel;
    ctx.report.total_ms = ctx.totalMs;
    ctx.report.files = [{ path: mediaPath, bytes }, ...(posterRel ? [{ path: posterRel, bytes: (await stat(join(media.getRoot(), posterRel))).size }] : [])];
    exportsRepo.finish(ctx.exportId, { status: 'done', media_path: mediaPath, bytes, node_id: node.id, progress: 1, step: 'Done', report: ctx.report });
    ctx.result = { node: spaces.findNode(ctx.spaceId, node.id), media_path: mediaPath, bytes };
    events.node({ spaceId: ctx.spaceId, nodeId: node.id, status: 'done', media_path: mediaPath, media_mime: 'video/mp4', created: true });
    await next();
}


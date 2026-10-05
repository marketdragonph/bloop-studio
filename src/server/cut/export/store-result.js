// StoreResult (01-core.md §6, 05 §5.2–§5.3): the poster frame, then the move into the media folder under a
// story name (`night-market-youtube-r12.mp4`, the poster beside it), then a new video card at the end of the
// board's first row with a `takes` row (preset 'cut', so BoardCut never takes it as a clip) and the events.
// P6: the name carries the shape when it is not the preset's own ("night-market-master-9x16-r12.mp4"), and the
// .srt and the preview GIF go beside it under the same stem.
import { mkdir, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { storyFileName } from '../../../shared/safe-name.js';
import { now } from '../../db/database.js';
import { outputLabel, outputName } from '../../../shared/export-presets.js';
import { posterArgs } from './recipe.js';
import { posterMs } from './extras.js';

const CARD_GAP = 80;
const DEFAULT_WIDTH = 320;

const SIDES = Object.freeze({ poster: { suffix: '-poster', ext: 'jpg' }, gif: { suffix: '-preview', ext: 'gif' }, srt: { suffix: '', ext: 'srt' } });

/** A file name in the cuts folder that is not taken yet, with its side files (old revisions keep their names). */
export function freeName(dir, parts, exists = existsSync) {
    const names = (n) => ({
        name: storyFileName({ ...parts, n }),
        ...Object.fromEntries(Object.entries(SIDES).map(([k, side]) => [k, storyFileName({ ...parts, n, ...side })])),
    });
    for (let n = 1; n < 100; n++) {
        const set = names(n);
        if (Object.values(set).every((file) => !exists(join(dir, file)))) return set;
    }
    return names(Date.now());
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
    const names = freeName(dir, { story: space?.name, preset: outputName(ctx.output.preset, ctx.output.aspect, ctx.planShape), revision: rev, ext: 'mp4' });
    const { name, poster } = names;
    const finalPath = join(dir, name);
    await rename(ctx.final, finalPath);
    const rel = (full) => relative(media.getRoot(), full).split(sep).join('/');
    let posterRel = null;
    if (hasPoster) {
        await rename(posterTmp, join(dir, poster));
        posterRel = rel(join(dir, poster));
    }
    const sides = [];
    for (const kind of ['srt', 'gif']) {
        if (!ctx.side?.[kind]) continue;
        await rename(ctx.side[kind], join(dir, names[kind]));
        sides.push({ kind, path: rel(join(dir, names[kind])), bytes: (await stat(join(dir, names[kind]))).size });
    }
    const mediaPath = rel(finalPath);
    const { size: bytes } = await stat(finalPath);

    // The card: "Cut · r12 · YouTube", right of the board, with its take (preset 'cut').
    const place = cardPlace(db, ctx.spaceId);
    const label = `Cut · r${rev} · ${outputLabel(ctx.output.preset, ctx.output.aspect, ctx.planShape)}`;
    const node = spaces.createNode(ctx.spaceId, { type: 'video', label, position_x: place.x, position_y: place.y });
    spaces.updateNode(ctx.spaceId, node.id, { settings: { duration: ctx.totalMs / 1000, aspect: ctx.output.aspect, cut_export_id: ctx.exportId } });
    const params = { export_id: ctx.exportId, revision: rev, preset: ctx.output.preset, variant: ctx.output.aspect, width: ctx.output.width, height: ctx.output.height, fps: ctx.output.fps, poster: posterRel };
    db.prepare('INSERT INTO takes (node_id, media_path, media_mime, preset, seed, params, duration_ms, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)')
        .run(node.id, mediaPath, 'video/mp4', 'cut', JSON.stringify(params), ctx.totalMs, now());
    spaces.setNodeResult(node.id, { status: 'done', media_path: mediaPath, media_mime: 'video/mp4' });

    ctx.report.poster_path = posterRel;
    ctx.report.total_ms = ctx.totalMs;
    ctx.report.files = [{ path: mediaPath, bytes }, ...(posterRel ? [{ path: posterRel, bytes: (await stat(join(media.getRoot(), posterRel))).size }] : []), ...sides.map(({ path, bytes: b }) => ({ path, bytes: b }))];
    for (const side of sides) ctx.report[`${side.kind}_path`] = side.path;
    exportsRepo.finish(ctx.exportId, { status: 'done', media_path: mediaPath, bytes, node_id: node.id, progress: 1, step: 'Done', report: ctx.report });
    ctx.result = { node: spaces.findNode(ctx.spaceId, node.id), media_path: mediaPath, bytes };
    events.node({ spaceId: ctx.spaceId, nodeId: node.id, status: 'done', media_path: mediaPath, media_mime: 'video/mp4', created: true });
    await next();
}


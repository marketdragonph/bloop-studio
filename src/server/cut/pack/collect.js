// What goes into a Pack (01-core.md §8): every take of every card, in a layout a person can find things in.
//   beats/<lane>-<tag>/<card>-take<id>-seed<seed>.<ext>   a beat's video takes
//   clips/                                                 video takes on no beat
//   stills/  sound/                                        image and audio takes (and uploads)
//   cut/                                                   the latest done export and its poster
//   notes/                                                 the words cards, as .md
// Read-only: database rows and file sizes. Every name is made safe for Windows. A file that is gone from the
// media folder is listed as missing, never a reason to fail the pack.
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { DirectorPlans } from '../../repositories/director-plans.js';
import { EXPORT_PRESETS as OWN_EXPORTS } from '../board-cut.js';
import { safeName, safePath, withoutExtension } from '../../../shared/safe-name.js';

const json = (text, fallback) => {
    try {
        return text == null ? fallback : JSON.parse(text);
    } catch {
        return fallback;
    }
};
const pad = (n) => String(n).padStart(2, '0');
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** The board as rows: space, cards, wires, takes, plan + beats, the latest done export. */
export function readBoard(db, spaceId, { exportsRepo, cuts }) {
    const space = db.prepare('SELECT id, name, description, created_at FROM spaces WHERE id = ?').get(spaceId);
    const nodes = db.prepare('SELECT * FROM space_nodes WHERE space_id = ? ORDER BY id').all(spaceId).map((n) => ({ ...n, settings: json(n.settings, {}) }));
    const wires = db.prepare('SELECT from_node_id, to_node_id, to_socket FROM space_connections WHERE space_id = ? ORDER BY id').all(spaceId);
    const takes = db.prepare(`SELECT t.* FROM takes t JOIN space_nodes n ON n.id = t.node_id WHERE n.space_id = ? ORDER BY t.id`).all(spaceId)
        .map((t) => ({ ...t, params: json(t.params, {}) }));
    const plans = new DirectorPlans(db);
    const plan = plans.latest(spaceId);
    const beats = plan ? plans.beats(plan.id) : [];
    return { space, nodes, wires, takes, plan, beats, cut: cuts.current(spaceId), lastExport: exportsRepo.latestDone(spaceId) };
}

/** The beat a card belongs to: listed in the beat's node_ids, or labelled with its tag. */
const beatOf = (node, beats) => beats.find((b) => (b.node_ids ?? []).includes(node.id)) ?? beats.find((b) => same(node.label, b.tag)) ?? null;

const kindOf = (node, mime) => {
    const m = String(mime ?? node.media_mime ?? '');
    if (node.type === 'video' || m.startsWith('video/')) return 'video';
    if (node.type === 'image' || m.startsWith('image/')) return 'image';
    if (node.type === 'audio' || m.startsWith('audio/')) return 'audio';
    return 'other';
};

/**
 * The files to pack, in zip order, each with its size; plus what is missing.
 * @returns {Promise<{ files: object[], notes: object[], missing: object[], bytes: number }>}
 */
export async function collect(board, { media, includePrompts = true }) {
    const files = [];
    const missing = [];
    const used = new Set();
    const unique = (path) => {
        let candidate = path;
        const ext = extname(path);
        for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${path.slice(0, path.length - ext.length)}-${n}${ext}`;
        used.add(candidate.toLowerCase());
        return candidate;
    };
    const add = async (zipPath, rel, meta) => {
        const full = rel ? media.resolve(rel) : null;
        try {
            const info = full ? await stat(full) : null;
            if (!info?.isFile()) throw new Error('missing');
            const entry = { zip: unique(safePath(zipPath)), full, size: info.size, mtime: info.mtime, ...meta };
            files.push(entry);
            return entry;
        } catch {
            missing.push({ path: rel, ...meta });
            return null;
        }
    };
    const takesByNode = new Map();
    for (const t of board.takes) takesByNode.set(t.node_id, [...(takesByNode.get(t.node_id) ?? []), t]);

    for (const node of board.nodes) {
        // A label that is a file name ("open-lanterns.mp4") loses its extension: the take's own goes on the end.
        const card = safeName(withoutExtension(node.label) || `${node.type}-${node.id}`, { max: 40 });
        const beat = beatOf(node, board.beats);
        const own = (takesByNode.get(node.id) ?? []).filter((t) => !OWN_EXPORTS.has(t.preset));
        const folderFor = (kind) => {
            if (kind === 'video') return beat ? `beats/${pad(beat.lane)}-${safeName(beat.tag, { max: 40 })}` : 'clips';
            return kind === 'image' ? 'stills' : kind === 'audio' ? 'sound' : 'other';
        };
        for (const take of own) {
            const ext = extname(take.media_path) || '.bin';
            const seed = includePrompts && take.seed != null ? `-seed${take.seed}` : '';
            await add(`${folderFor(kindOf(node, take.media_mime))}/${card}-take${take.id}${seed}${ext}`, take.media_path, { node_id: node.id, take_id: take.id });
        }
        if (!own.length && node.media_path && node.type === 'upload') {
            await add(`${folderFor(kindOf(node))}/${card}-upload${extname(node.media_path)}`, node.media_path, { node_id: node.id, take_id: null });
        }
    }

    const last = board.lastExport;
    if (last?.media_path) {
        await add(`cut/${last.media_path.split('/').pop()}`, last.media_path, { node_id: last.node_id, export_id: last.id });
        // P6: the .srt and the preview GIF beside it go with it.
        for (const key of ['poster_path', 'srt_path', 'gif_path']) {
            const side = last.report?.[key];
            if (side) await add(`cut/${side.split('/').pop()}`, side, { node_id: last.node_id, export_id: last.id });
        }
    }

    const notes = board.nodes
        .filter((n) => (n.type === 'text' || n.type === 'note') && String(n.text_content ?? '').trim())
        .map((n) => {
            const beat = beatOf(n, board.beats);
            const stem = beat ? `${pad(beat.lane)}-${beat.tag}-${n.label || n.id}` : (n.label || `${n.type}-${n.id}`);
            const title = n.label?.trim() || (beat ? beat.tag : `Card ${n.id}`);
            return { zip: unique(`notes/${safeName(stem, { max: 60 })}.md`), text: `# ${title}\n\n${String(n.text_content).trim()}\n`, node_id: n.id };
        });

    return { files, notes, missing, bytes: files.reduce((sum, f) => sum + f.size, 0) };
}

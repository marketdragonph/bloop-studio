// Pack manifest v1 (01-core.md §8, 05-irresistible.md §5.7): `format: 'bloop-studio-pack'`, `version: 1`.
// Per take: file, model, seed, the prompt sent, sizes and knobs, measured length, when it was made, and whether
// it is in the cut with its in/out. Then the board section (cards, wires, plan, cut). Secret-looking keys are
// dropped everywhere; with prompts off, prompts and seeds are dropped too (a client job).
import { boardSection, scrub } from './board-section.js';

export const PACK_FORMAT = 'bloop-studio-pack';
export const PACK_VERSION = 1;

/**
 * @param {object} board readBoard() rows
 * @param {{ files: object[], missing: object[], notes: object[] }} packed collect() result
 * @param {{ appVersion: string, includePrompts?: boolean, createdAt?: string }} options
 */
export function buildManifest(board, packed, { appVersion, includePrompts = true, createdAt = new Date().toISOString() }) {
    const fileOf = new Map(packed.files.filter((f) => f.take_id != null).map((f) => [f.take_id, f.zip]));
    const nodeOf = new Map(board.nodes.map((n) => [n.id, n]));
    const inCut = new Map((board.cut.items ?? []).map((i) => [i.take_id ?? `n${i.node_id}`, i]));
    const takes = board.takes.filter((t) => fileOf.has(t.id)).map((t) => {
        const node = nodeOf.get(t.node_id);
        const item = inCut.get(t.id) ?? null;
        const { prompt, model, ...knobs } = t.params ?? {};
        return {
            file: fileOf.get(t.id), card_id: t.node_id, card: node?.label ?? null, type: node?.type ?? null,
            model: model ?? t.preset, preset: t.preset, seed: t.seed, prompt: prompt ?? null, knobs,
            duration_ms: t.duration_ms ?? null, created_at: t.created_at,
            in_cut: Boolean(item), in_ms: item?.in_ms ?? null, out_ms: item?.out_ms ?? null,
        };
    });
    const beats = board.beats.map((b) => ({
        tag: b.tag, lane: b.lane, brief: b.brief, cards: b.node_ids ?? [],
        files: takes.filter((t) => (b.node_ids ?? []).includes(t.card_id) || (t.card ?? '').trim().toLowerCase() === b.tag.toLowerCase()).map((t) => t.file),
    }));
    const last = board.lastExport;
    const body = scrub({
        app: { name: 'Bloop Studio', version: appVersion },
        created_at: createdAt,
        space: { id: board.space.id, name: board.space.name, description: board.space.description ?? null },
        plan: board.plan ? { approach: board.plan.approach ?? null, aspect: board.plan.aspect ?? null, runtime_seconds: board.plan.runtime_seconds ?? null, beats } : null,
        takes,
        export: last ? { file: packed.files.find((f) => f.export_id === last.id && f.full?.endsWith('.mp4'))?.zip ?? null, revision: last.cut_revision, preset: last.preset ?? null, bytes: last.bytes } : null,
        notes: packed.notes.map((n) => ({ file: n.zip, card_id: n.node_id })),
        missing: packed.missing.map((m) => ({ path: m.path, card_id: m.node_id ?? null, take_id: m.take_id ?? null })),
        board: boardSection(board, { includePrompts }),
    }, { includePrompts });
    // Written after the scrub: 'include_prompts' is itself a prompt-looking key.
    return { format: PACK_FORMAT, version: PACK_VERSION, options: { include_prompts: includePrompts }, ...body };
}

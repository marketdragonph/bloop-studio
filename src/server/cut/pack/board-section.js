// The board section of a Pack manifest (05-irresistible.md §5.7): cards, wires, positions, labels, the plan and
// the cut, so a future importer can open old packs. Split from manifest.js to keep both files small.

/** Keys never written to a manifest, at any depth (API keys, bloop tokens, auth headers). */
export const SECRET_KEY = /key|token|secret|authorization|password/i;
const PROMPT_KEY = /prompt|lyrics|negative|seed|^text$/i; // with prompts off, the words cards go too

/** A deep copy without secret keys (and, when prompts are off, without prompt and seed fields). */
export function scrub(value, { includePrompts = true } = {}) {
    if (Array.isArray(value)) return value.map((v) => scrub(v, { includePrompts }));
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SECRET_KEY.test(k)) continue;
        if (!includePrompts && PROMPT_KEY.test(k)) continue;
        out[k] = scrub(v, { includePrompts });
    }
    return out;
}

export function boardSection(board, { includePrompts = true } = {}) {
    const cards = board.nodes.map((n) => ({
        id: n.id, type: n.type, label: n.label, status: n.status,
        x: n.position_x, y: n.position_y, width: n.width, height: n.height,
        prompt: n.prompt ?? null, text: n.text_content ?? null, media_path: n.media_path ?? null, media_mime: n.media_mime ?? null,
        settings: n.settings,
    }));
    const plan = board.plan ? {
        approach: board.plan.approach ?? null, aspect: board.plan.aspect ?? null, runtime_seconds: board.plan.runtime_seconds ?? null,
        beats: board.beats.map((b) => ({ tag: b.tag, lane: b.lane, brief: b.brief, cards: b.node_ids ?? [] })),
    } : null;
    const { revision, items, sound, settings } = board.cut;
    return scrub({
        cards,
        wires: board.wires.map((w) => ({ from: w.from_node_id, to: w.to_node_id, socket: w.to_socket })),
        plan,
        cut: { revision, items, sound, settings },
    }, { includePrompts });
}

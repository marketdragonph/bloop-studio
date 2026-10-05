// Render missing beats, stages 1 and 2 (05-irresistible.md §2.2): which cards the plan still owes, and in what order.
//
// collectOwed  every beat BoardCut reads as missing (never rendered) or failed, with the cards wired into its clip
//              (pictures, a lip-sync voice) that have no render yet, plus a music bed with none. A card that is done,
//              queued or rendering is never queued again. A beat whose wired-in card failed, or is an Upload card with
//              no file, is skipped with a plain reason: a render press cannot fix that. A voice bed renders only on
//              bloop's voice models, so it is owed only when its card already has one picked.
// orderByWires references first (a card after everything wired into it), then the beats' clips, the bed last.
import { isCloudSource } from '../../../shared/card-source.js';

const RENDERS = new Set(['image', 'video', 'audio']);
const BUSY = new Set(['queued', 'generating']);
const MUSIC_BED = /^(music bed|song)$/i;
const VOICE_BED = /^(voice|voice ?over|voice-over|narration|narrator)$/i;
const OWED_SLOT = new Set(['never_rendered', 'failed']);
const TYPE_WORD = { image: 'picture', video: 'video', audio: 'audio', upload: 'upload' };
const ROLE_ORDER = { reference: 0, beat: 1, bed: 2 };

const hasRender = (n) => Boolean(n.media_path);
const needsRender = (n) => RENDERS.has(n.type) && !hasRender(n) && !BUSY.has(n.status);

/** Every card wired into `node`, however far back (pictures into pictures, a voice into a clip). */
function upstreamOf(node, board) {
    const seen = new Map();
    const walk = (id) => {
        for (const wire of board.into.get(id) ?? []) {
            const from = board.byId.get(wire.from_node_id);
            if (!from || seen.has(from.id)) continue;
            seen.set(from.id, from);
            walk(from.id);
        }
    };
    walk(node.id);
    return [...seen.values()];
}

/** Why a beat cannot be rendered by one press, or null. */
function blockerOf(slot, upstream) {
    const failed = upstream.find((n) => RENDERS.has(n.type) && n.status === 'failed' && !hasRender(n));
    if (failed) return `${slot.label}: its ${TYPE_WORD[failed.type]} card${failed.label ? ` "${failed.label}"` : ''} failed last time. Open it on the board and fix it first.`;
    const empty = upstream.find((n) => n.type === 'upload' && !hasRender(n));
    if (empty) return `${slot.label}: its Upload card has no file yet.`;
    return null;
}

export async function collectOwed(ctx, next) {
    const { spaces, boardCut } = ctx.deps;
    const board = spaces.board(ctx.spaceId);
    const byId = new Map(board.nodes.map((n) => [n.id, n]));
    const into = new Map();
    for (const wire of board.connections) into.set(wire.to_node_id, [...(into.get(wire.to_node_id) ?? []), wire]);
    const graph = { byId, into };
    const read = boardCut.read(ctx.spaceId);

    const owed = new Map(); // node id → { node, role, beat }
    const skipped = [];
    const beats = [];
    const owe = (node, role, beat) => { if (!owed.has(node.id)) owed.set(node.id, { node, role, beat }); };
    read.slots.forEach((slot, beat) => {
        if (!OWED_SLOT.has(slot.reason)) return;
        const clip = slot.node_id == null ? null : byId.get(slot.node_id);
        if (!clip) {
            skipped.push({ beat_tag: slot.beat_tag, label: slot.label, reason: `${slot.label}: it has no video card on the board.` });
            return;
        }
        if (BUSY.has(clip.status)) return;
        const upstream = upstreamOf(clip, graph);
        const blocked = blockerOf(slot, upstream);
        if (blocked) {
            skipped.push({ beat_tag: slot.beat_tag, label: slot.label, reason: blocked });
            return;
        }
        beats.push(slot.beat_tag);
        for (const ref of upstream.filter(needsRender)) owe(ref, 'reference', beat);
        owe(clip, 'beat', beat);
    });

    // Beds: the newest music bed card with no render; a voice bed only on a bloop voice model the person picked.
    const sounds = board.nodes.filter((n) => n.type === 'audio' && needsRender(n)).sort((a, b) => b.id - a.id);
    const music = sounds.find((n) => MUSIC_BED.test(n.label?.trim() ?? ''));
    if (music && !board.nodes.some((n) => n.id !== music.id && MUSIC_BED.test(n.label?.trim() ?? '') && hasRender(n))) owe(music, 'bed', Infinity);
    for (const voice of sounds.filter((n) => VOICE_BED.test(n.label?.trim() ?? ''))) {
        if (isCloudSource(voice.settings?.family)) owe(voice, 'bed', Infinity);
        else skipped.push({ beat_tag: null, label: voice.label, reason: `${voice.label}: pick a bloop voice model on its card first; voices do not render on this PC.` });
    }

    ctx.board = board;
    ctx.graph = graph;
    ctx.read = read;
    ctx.beats = beats;
    ctx.owed = [...owed.values()];
    ctx.skipped = skipped;
    await next();
}

export async function orderByWires(ctx, next) {
    const roleOf = new Map(ctx.owed.map((o) => [o.node.id, o.role]));
    const depth = new Map();
    const depthOf = (id, trail = new Set()) => {
        if (depth.has(id)) return depth.get(id);
        if (trail.has(id)) return 0; // the board refuses loops; never spin on one
        trail.add(id);
        // Depth counts only owed cards of the same group: references are all queued before any clip anyway.
        const ups = (ctx.graph.into.get(id) ?? []).map((w) => w.from_node_id).filter((up) => roleOf.get(up) === roleOf.get(id));
        const d = ups.length ? 1 + Math.max(...ups.map((up) => depthOf(up, trail))) : 0;
        depth.set(id, d);
        return d;
    };
    // References, then the beats' clips, then the bed; inside each, a card after the cards wired into it, then beat order.
    const rank = (o) => ROLE_ORDER[o.role] * 1000 + (o.role === 'bed' ? 0 : depthOf(o.node.id));
    const beat = (o) => (Number.isFinite(o.beat) ? o.beat : Number.MAX_SAFE_INTEGER);
    ctx.order = [...ctx.owed].sort((a, b) => rank(a) - rank(b) || beat(a) - beat(b) || a.node.id - b.node.id);
    await next();
}

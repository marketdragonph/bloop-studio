// AppliedEdits: what a Director cut write ACTUALLY changed, read from the cut before and after the save — never
// from what the ops asked for. It is the one source for the edit count (turn strip, reveal text, Undo turn), the
// strip's rows, the tool result the model describes the turn from, and the ledger's closing words. An op that
// changed nothing ("trim" to the same points, a move back where it was) is not an edit and is not listed.
import { cutClock } from '../../../shared/cut-clock.js';

const s1 = (ms) => (Math.round(ms / 100) / 10).toFixed(1);
const signed = (ms) => `${ms < 0 ? '−' : '+'}${s1(Math.abs(ms))} s`;
const lengthOf = (item) => item.out_ms - item.in_ms;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const TIMED_ROWS = ['trim', 'snap'];

/** The trim words for the person: "Trimmed −1.0 s", "Longer +0.4 s", "Trim points set". */
function trimText(old, item) {
    const delta = lengthOf(item) - lengthOf(old);
    return delta < 0 ? `Trimmed ${signed(delta)}` : delta > 0 ? `Longer ${signed(delta)}` : 'Trim points set';
}

/** "in 0.0→0.6 s, out 10.0→9.0 s, now 8.4 s long": the exact numbers, only the ones that moved. */
function trimDetail(old, item) {
    const parts = [];
    if (old.in_ms !== item.in_ms) parts.push(`in ${s1(old.in_ms)}→${s1(item.in_ms)} s`);
    if (old.out_ms !== item.out_ms) parts.push(`out ${s1(old.out_ms)}→${s1(item.out_ms)} s`);
    return `${parts.join(', ')}, now ${s1(lengthOf(item))} s long`;
}

function joinDetail(join) {
    const audio = join?.audio_ms ?? 0;
    if (audio < 0) return `J cut ${s1(-audio)} s into it`;
    if (audio > 0) return `L cut ${s1(audio)} s into it`;
    return join?.type === 'dissolve' ? `dissolve ${s1(join.ms ?? 0)} s into it` : 'hard cut into it';
}

/** The clip before `id` among the clips both cuts hold (a move changes it; a removal or a placement does not). */
function predecessors(items, common) {
    const out = new Map();
    let prev = null;
    for (const item of items) {
        if (!common.has(item.id)) continue;
        out.set(item.id, prev);
        prev = item.id;
    }
    return out;
}

/**
 * @param {{ before: { items: object[], settings?: object }, after: { items: object[], settings?: object }, rows?: object[], summary?: object[] }} input
 *   rows/summary: what the op handlers wrote (they give the words and the `why`; the cuts give the facts).
 * @returns {{ rows: object[], summary: object[], count: number }} rows: one per change to a clip, for the strip;
 *   summary: one per change to the whole cut (music, loudness, export set-up). count = rows + summary.
 */
export function appliedEdits({ before, after, rows = [], summary = [] }) {
    const was = new Map(before.items.map((i) => [i.id, i]));
    const now = new Map(after.items.map((i) => [i.id, i]));
    const common = new Set([...now.keys()].filter((id) => was.has(id)));
    const prevBefore = predecessors(before.items, common);
    const prevAfter = predecessors(after.items, common);
    const starts = new Map(cutClock(after.items).items.map((at, k) => [after.items[k].id, at.start_ms]));
    const rowsOf = (id) => rows.filter((r) => r.item_id === id);
    const lastRow = (id, kinds) => rowsOf(id).filter((r) => kinds.includes(r.kind)).at(-1) ?? null;
    const out = [];
    const add = (item, kind, text, detail, row = null, extra = {}) => out.push({
        kind, beat_tag: item.beat_tag ?? null, node_id: item.node_id ?? null, item_id: item.id, text, detail,
        why: row?.why ?? null, at_ms: starts.get(item.id) ?? null, ...extra,
    });

    after.items.forEach((item, k) => {
        const old = was.get(item.id);
        if (!old) return add(item, 'place', 'Placed', `placed, ${s1(item.in_ms)}–${s1(item.out_ms)} s of the clip`, lastRow(item.id, ['place']));
        const changes = [];
        if (old.media_path !== item.media_path || old.take_id !== item.take_id) changes.push(['place', 'Swapped in another take', 'another take swapped in, whole clip']);
        else if (old.in_ms !== item.in_ms || old.out_ms !== item.out_ms) {
            const row = lastRow(item.id, TIMED_ROWS);
            changes.push([row?.kind ?? 'trim', row?.kind === 'snap' ? row.text : trimText(old, item), trimDetail(old, item), row, { was: { in_ms: old.in_ms, out_ms: old.out_ms } }]);
        }
        if (prevBefore.get(item.id) !== prevAfter.get(item.id) && lastRow(item.id, ['move'])) {
            const where = k === 0 ? 'moved to the start' : `moved after ${after.items[k - 1].beat_tag}`;
            changes.push(['move', lastRow(item.id, ['move']).text, where]);
        }
        if (k > 0 && !same(old.join, item.join)) {
            const row = lastRow(item.id, ['join']);
            changes.push(['join', row?.text ?? `${after.items[k - 1].beat_tag}→${item.beat_tag} ${joinDetail(item.join)}`, joinDetail(item.join), row]);
        }
        if ((old.sound !== false) !== (item.sound !== false)) changes.push(['sound', item.sound === false ? 'Clip sound off' : 'Clip sound on', item.sound === false ? 'its own sound off' : 'its own sound on']);
        const undo = lastRow(item.id, ['undo']);
        if (undo && changes.length) return add(item, 'undo', undo.text, changes.map((c) => c[2]).join(', '));
        for (const [kind, text, detail, row, extra] of changes) add(item, kind, text, detail, row ?? lastRow(item.id, [kind]), extra);
    });
    before.items.forEach((item) => {
        if (!now.has(item.id)) add(item, 'remove', 'Taken out of the cut', 'removed from the cut', lastRow(item.id, ['remove']), { at_ms: null });
    });
    const poster = after.settings?.poster_ms;
    if (poster != null && poster !== before.settings?.poster_ms) {
        const row = rows.filter((r) => r.kind === 'poster').at(-1);
        const item = (row && now.get(row.item_id)) ?? { id: null, beat_tag: null, node_id: null };
        add(item, 'poster', 'Poster frame', `poster frame at ${s1(poster)} s in the cut`, row);
    }
    return { rows: out, summary: [...summary], count: out.length + summary.length };
}

/**
 * The exact list for the model, one line per change: "- s3-door: out 10.0→9.0 s, now 9.0 s long (dead tail)".
 * The model describes these and nothing else (doctrine-edit.js).
 */
export function editLines({ rows, summary }) {
    const lines = rows.map((r) => `- ${r.beat_tag ?? 'The cut'}: ${r.detail}${r.why ? ` (${r.why})` : ''}`);
    for (const s of summary) lines.push(`- ${s.track === 'music' ? 'Music' : s.track === 'voice' ? 'Voice' : 'The cut'}: ${s.text}${s.why ? ` (${s.why})` : ''}`);
    return lines;
}

/** The same list for the person, in the strip's words: "s3-door trimmed −1.0 s". */
export function personLines({ rows, summary }) {
    return [...rows.map((r) => (r.beat_tag ? `${r.beat_tag}: ${r.text}` : r.text)), ...summary.map((s) => s.text)];
}

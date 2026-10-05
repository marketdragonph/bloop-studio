// What each propose_cut_ops op does to a working copy of the cut (03-director.md §3). Every handler checks the op
// against the cut as the earlier ops left it and pushes a reason instead of changing anything when it cannot apply;
// cut-ops.js saves only when no op has a reason (all or nothing). Notes (≤ 40 chars, sensor blue on the clip),
// strip rows and the why ledger are written here as the ops apply.
import { cutClock } from '../../../shared/cut-clock.js';
import { DISSOLVE, DUCK, MIN_CLIP_MS, CUT_LIMITS } from '../../../shared/cut-rules.js';
import { snapToBeat } from '../../../shared/cut-sound.js';
import { itemFor } from '../../cut/cut-draft.js';
import { isLocked, lockedReason } from './lock.js';

const s1 = (ms) => (Math.round(ms / 100) / 10).toFixed(1);
const signed = (ms) => `${ms < 0 ? '−' : '+'}${s1(Math.abs(ms))} s`;
const tenth = (s) => Math.round(Number(s) * 10) * 100; // seconds in 0.1 steps → ms
const lengthOf = (item) => item.out_ms - item.in_ms;
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** Where `beat` is in the working cut: {item, index} or null. `@id` names a card. */
export function locate(w, beat) {
    const ref = String(beat ?? '').trim();
    const index = /^@\d+$/.test(ref) ? w.items.findIndex((i) => i.node_id === Number(ref.slice(1))) : w.items.findIndex((i) => same(i.beat_tag, ref));
    return index < 0 ? null : { item: w.items[index], index };
}

/** "The beats are: s1-open, s2-cup … s8-close." */
function beatList(w) {
    const tags = w.beats.length ? w.beats : w.items.map((i) => i.beat_tag);
    const shown = tags.length > 10 ? [...tags.slice(0, 3), '…', tags.at(-1)] : tags;
    return tags.length ? ` The beats are: ${shown.join(', ').replace(', …,', ' …')}.` : '';
}

function slotOf(w, beat) {
    const ref = String(beat ?? '').trim();
    if (/^@\d+$/.test(ref)) return w.slots.find((s) => s.node_id === Number(ref.slice(1))) ?? null;
    return w.slots.find((s) => same(s.beat_tag, ref)) ?? null;
}

/** The clip for an op that edits one, with the beat, lock and timing checks; null (with a reason) when it cannot. */
function target(w, n, op, { timed = false } = {}) {
    const found = locate(w, op.beat);
    if (!found) {
        if (slotOf(w, op.beat) || w.beats.some((b) => same(b, op.beat))) w.reason(`op ${n}: ${op.beat} is not in the cut. Place it first, or leave it.`);
        else w.reason(`op ${n}: ${op.beat} is not a beat on this board.${beatList(w)}`);
        return null;
    }
    if (!w.mayEdit(found.item)) {
        w.reason(`op ${n}: ${lockedReason(found.item)}`);
        return null;
    }
    if (timed && !w.timedOk(n, found.item)) return null;
    return found;
}

export const note = (w, item, phrase) => w.note(item.id, phrase);

const HANDLERS = {
    place(w, n, op) {
        const slot = slotOf(w, op.beat);
        if (!slot) return w.reason(`op ${n}: ${op.beat} is not a beat on this board.${beatList(w)}`);
        if (slot.state !== 'ready' || !slot.media_path) return w.reason(`op ${n}: ${slot.beat_tag} has no video, so it cannot be placed. Name it in one sentence; do not offer to render it, and do not name any buttons.`);
        let fresh = itemFor(slot);
        if (op.take) {
            const take = w.takesOf(slot.node_id).find((t) => t.id === Number(String(op.take).slice(1)));
            if (!take) return w.reason(`op ${n}: ${op.take} is not a take of ${slot.beat_tag}.`);
            const ms = take.duration_ms ?? fresh.seconds_ms;
            fresh = { ...fresh, take_id: take.id, media_path: take.media_path, seconds_ms: ms, in_ms: 0, out_ms: ms };
        }
        const already = w.items.findIndex((i) => i.node_id === slot.node_id);
        if (already >= 0) {
            const item = w.items[already];
            if (item.take_id === fresh.take_id) return w.reason(`op ${n}: ${slot.beat_tag} is already in the cut with that take. Use move to change where it plays.`);
            if (!w.mayEdit(item)) return w.reason(`op ${n}: ${lockedReason(item)}`);
            w.items[already] = { ...item, take_id: fresh.take_id, media_path: fresh.media_path, seconds_ms: fresh.seconds_ms, in_ms: 0, out_ms: fresh.seconds_ms };
            w.row(op, w.items[already], 'Swapped in another take');
            return note(w, w.items[already], 'Other take');
        }
        if (w.items.length >= CUT_LIMITS.maxItems) return w.reason(`op ${n}: the cut already holds ${CUT_LIMITS.maxItems} clips.`);
        fresh = { ...fresh, note: undefined };
        let at;
        if (op.after === undefined) {
            const rank = (tag) => w.beats.findIndex((b) => same(b, tag));
            const mine = rank(slot.beat_tag);
            at = w.items.findIndex((i) => rank(i.beat_tag) > mine);
            if (at < 0) at = w.items.length;
        } else if (same(op.after, 'start')) at = 0;
        else {
            const after = locate(w, op.after);
            if (!after) return w.reason(`op ${n}: ${op.after} is not in the cut, so nothing can follow it.`);
            at = after.index + 1;
        }
        w.items.splice(at, 0, fresh);
        w.row(op, fresh, 'Placed');
        return note(w, fresh, 'Placed by the Director');
    },

    trim(w, n, op) {
        const found = target(w, n, op, { timed: true });
        if (!found) return;
        const { item } = found;
        const inMs = op.in_s === undefined ? item.in_ms : tenth(op.in_s);
        let outMs = op.out_s === undefined ? item.out_ms : tenth(op.out_s);
        const length = item.seconds_ms;
        if (outMs > length + CUT_LIMITS.trimSlackMs) return w.reason(`op ${n}: out_s ${s1(outMs)} is past the end of ${item.beat_tag} (${s1(length)} s). Read it with inspect_cut.`);
        if (inMs >= length) return w.reason(`op ${n}: in_s ${s1(inMs)} is past the end of ${item.beat_tag} (${s1(length)} s). Read it with inspect_cut.`);
        if (outMs - inMs < MIN_CLIP_MS) return w.reason(`op ${n}: that leaves ${item.beat_tag} ${s1(Math.max(0, outMs - inMs))} s long; a clip keeps at least ${s1(MIN_CLIP_MS)} s. Remove it instead if it should go.`);
        const before = lengthOf(item);
        const was = { in_ms: item.in_ms, out_ms: item.out_ms }; // the dock draws the frames the trim took as a ghost
        Object.assign(item, { in_ms: inMs, out_ms: Math.min(outMs, length) });
        // Cut on the beat: an out point within 80 ms of an estimated downbeat lands on it.
        const index = w.items.indexOf(item);
        const end = cutClock(w.items).items[index].end_ms;
        const beat = index < w.items.length - 1 ? snapToBeat(end, w.downbeats) : null;
        if (beat != null && beat !== end) {
            const moved = item.out_ms + (beat - end);
            if (moved <= length && moved - item.in_ms >= MIN_CLIP_MS) {
                item.out_ms = moved;
                w.snapped.push(`${item.beat_tag}'s out point moved ${Math.abs(beat - end)} ms onto the downbeat at ${s1(beat)} s (estimated).`);
            }
        }
        outMs = item.out_ms;
        const delta = lengthOf(item) - before;
        w.count('trim');
        w.row(op, item, delta ? `Trimmed ${signed(delta)}` : 'Trim points set', op.why, { was });
        note(w, item, delta < 0 ? `Trimmed ${signed(delta)}` : delta > 0 ? `Longer ${signed(delta)}` : 'Trim points set');
    },

    move(w, n, op) {
        const found = target(w, n, op);
        if (!found) return;
        const [item] = w.items.splice(found.index, 1);
        let at = 0;
        if (!same(op.after, 'start')) {
            const after = locate(w, op.after);
            if (!after) {
                w.items.splice(found.index, 0, item);
                return w.reason(`op ${n}: ${op.after} is not in the cut, so ${item.beat_tag} cannot follow it.`);
            }
            at = after.index + 1;
        }
        w.items.splice(at, 0, item);
        w.count('move');
        w.row(op, item, same(op.after, 'start') ? 'Moved to the start' : `Moved after ${op.after}`, op.why);
        note(w, item, same(op.after, 'start') ? 'Moved to the start' : `Moved after ${op.after}`);
    },

    remove(w, n, op) {
        const found = target(w, n, op);
        if (!found) return;
        w.items.splice(found.index, 1);
        if (found.index === 0 && w.items[0]) w.items[0] = { ...w.items[0], join: { type: 'cut' } };
        w.count('remove');
        w.row(op, found.item, 'Taken out of the cut', op.why);
    },

    join(w, n, op) {
        const found = locate(w, op.beat);
        if (!found) return target(w, n, op);
        const next = w.items[found.index + 1];
        if (!next) return w.reason(`op ${n}: ${found.item.beat_tag} is the last clip, so there is no join after it.`);
        if (!w.mayEdit(next)) return w.reason(`op ${n}: ${lockedReason(next)}`);
        const join = { type: op.type };
        if (op.type === 'dissolve') {
            join.ms = op.ms ?? DISSOLVE.default;
            const shorter = Math.min(lengthOf(found.item), lengthOf(next));
            const short = lengthOf(found.item) <= lengthOf(next) ? found.item : next;
            if (join.ms > shorter / 2) return w.reason(`op ${n}: a dissolve of ${join.ms} ms is more than half of ${short.beat_tag} (${s1(shorter)} s).`);
        }
        const audio = op.audio_ms ?? 0;
        if (audio) {
            if (!w.timedOk(n, found.item) || !w.timedOk(n, next)) return;
            if (!found.item.sound || !next.sound) return w.reason(`op ${n}: a J or L cut needs the sound on in ${found.item.beat_tag} and ${next.beat_tag}.`);
            if (audio < 0 && next.in_ms < -audio) return w.reason(`op ${n}: ${next.beat_tag} has only ${s1(next.in_ms)} s of sound before its in point, so it cannot start ${s1(-audio)} s early.`);
            if (audio > 0 && found.item.seconds_ms - found.item.out_ms < audio) return w.reason(`op ${n}: ${found.item.beat_tag} has only ${s1(found.item.seconds_ms - found.item.out_ms)} s of sound after its out point, so it cannot run on ${s1(audio)} s.`);
            join.audio_ms = audio;
        }
        w.items[found.index + 1] = { ...next, join };
        const text = audio < 0 ? `J cut ${s1(-audio)} s` : audio > 0 ? `L cut ${s1(audio)} s` : op.type === 'dissolve' ? `Dissolve ${s1(join.ms)} s` : 'Hard cut';
        w.count('join');
        w.row(op, next, `${found.item.beat_tag}→${next.beat_tag} ${text}`, op.why);
        note(w, w.items[found.index + 1], text);
    },

    sound(w, n, op) {
        const found = target(w, n, op);
        if (!found) return;
        if (!op.on && w.items.some((i, k) => (k === found.index + 1 && i.join?.audio_ms) || (k === found.index && i.join?.audio_ms))) {
            return w.reason(`op ${n}: ${found.item.beat_tag} has a J or L cut; set that join back to a plain cut first.`);
        }
        found.item.sound = op.on;
        w.count('sound');
        w.row(op, found.item, op.on ? 'Clip sound on' : 'Clip sound off', op.why);
        note(w, found.item, op.on ? 'Clip sound on' : 'Clip sound off');
    },

    duck(w, n, op) {
        if (!w.sound?.music) return w.reason(`op ${n}: the cut has no music bed, so there is nothing to duck.`);
        if (!w.timedOk(n, null)) return;
        const depth = Math.round(op.depth_db);
        w.sound = { ...w.sound, music: { ...w.sound.music, duck: { depth_db: depth, attack_ms: DUCK.attack_ms, release_ms: DUCK.release_ms } } };
        w.count('duck');
        w.summary.push({ kind: 'duck', track: 'music', text: `Music ducked ${depth} dB under spoken lines`, why: op.why ?? null });
    },

    level(w, n, op) {
        if (op.track === 'clips') return w.reason(`op ${n}: a level for the clips' own sound is not in the cut yet. Set music or voice, or say so in one sentence.`);
        if (op.track) {
            if (!w.sound?.[op.track]) return w.reason(`op ${n}: the cut has no ${op.track} bed.`);
            const gain = Math.round(op.gain_db);
            w.sound = { ...w.sound, [op.track]: { ...w.sound[op.track], gain_db: gain } };
            w.summary.push({ kind: 'level', track: op.track, text: `${op.track === 'music' ? 'Music' : 'Voice'} level ${gain > 0 ? '+' : ''}${gain} dB`, why: op.why ?? null });
        }
        if (op.target_lufs !== undefined) {
            if (!w.timedOk(n, null)) return;
            w.settings = { ...w.settings, target_lufs: op.target_lufs };
            w.summary.push({ kind: 'level', track: 'mix', text: `Loudness aimed at ${op.target_lufs} LUFS`, why: op.why ?? null });
        }
        w.count('level');
    },

    snap(w, n, op) {
        const found = target(w, n, op, { timed: true });
        if (!found) return;
        if (!w.downbeats.length) return w.reason(`op ${n}: no music beats are measured, so there is no beat to cut on. Say so in one sentence.`);
        if (found.index === w.items.length - 1) return w.reason(`op ${n}: ${found.item.beat_tag} is the last clip; its end is the end of the cut.`);
        const { item } = found;
        const end = cutClock(w.items).items[found.index].end_ms;
        const speech = w.analysisOf(item.media_path)?.speech ?? [];
        const options = w.downbeats.map((b) => ({ b, out: item.out_ms + (b - end) }))
            .filter(({ out }) => out <= item.seconds_ms && out - item.in_ms >= MIN_CLIP_MS && !speech.some(([a, z]) => out > a && out < z))
            .sort((x, y) => Math.abs(x.b - end) - Math.abs(y.b - end));
        const best = options[0];
        if (!best || Math.abs(best.b - end) > 1500) return w.reason(`op ${n}: no downbeat lands within 1.5 s of ${item.beat_tag}'s end without cutting a line or running past the clip.`);
        const was = { in_ms: item.in_ms, out_ms: item.out_ms };
        item.out_ms = best.out;
        w.count('snap');
        w.row(op, item, `Cut on the downbeat at ${s1(best.b)} s`, op.why, { was });
        note(w, item, 'Cut on the downbeat');
    },

    poster(w, n, op) {
        const found = locate(w, op.beat);
        if (!found) return target(w, n, op);
        const { item, index } = found;
        const at = op.at_s === undefined ? Math.round((item.in_ms + item.out_ms) / 2) : tenth(op.at_s);
        if (at < item.in_ms || at > item.out_ms) return w.reason(`op ${n}: ${s1(at)} s is outside the part of ${item.beat_tag} that plays (${s1(item.in_ms)}–${s1(item.out_ms)} s).`);
        w.settings = { ...w.settings, poster_ms: cutClock(w.items).items[index].start_ms + (at - item.in_ms) };
        w.count('poster');
        w.row(op, item, 'Poster frame', op.why);
    },
};

/** Applies one op to the working cut (or records why it cannot). */
export function applyOp(w, n, op) {
    HANDLERS[op.op]?.(w, n, op);
}

export { isLocked };

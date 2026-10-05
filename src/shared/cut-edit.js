// The person's edits on the Cut's items (02-dock.md §6), as pure functions: each takes the items and returns
// new ones, never changing what it was given, so the dock's undo can keep plain snapshots. Shared by the
// dock and its tests; the server validates the same rules again when it saves (01-core.md §2).
// Item: {id, node_id, take_id, beat_tag, media_path, seconds_ms, in_ms, out_ms, sound, join: {type, ms}, note?}.
// Limits come from the one rule file (cut-rules.js); dissolve lengths from the one clock (cut-clock.js).
import { DISSOLVE_DEFAULT_MS, DISSOLVE_MIN_MS, dissolveMs } from './cut-clock.js';
import { CUT_LIMITS, FADE_OUT, MUSIC_LEVEL, VOICE_LEVEL, checkItems, clampLevel } from './cut-rules.js';

export const TRIM_SLACK_MS = CUT_LIMITS.trimSlackMs; // out may sit up to 50 ms past the measured length (01-core.md §2)
export const MIN_CLIP_MS = 100; // a trim never makes a clip shorter than this
export const NUDGE_MS = 100; // Shift+arrow

// The server saves a cut join as {type:'cut'} (validate-cut.js); the dock writes the same shape.
const CUT_JOIN = Object.freeze({ type: 'cut' });

/** `/media/<path>` with each segment encoded (the same rule as board-cut.js mediaUrl). */
export const mediaUrlOf = (path) => (path ? `/media/${String(path).split('/').map(encodeURIComponent).join('/')}` : null);

/** The media path back from a `/media/…` url. */
export function mediaPathOf(url) {
    if (!url || !String(url).startsWith('/media/')) return null;
    try {
        return String(url).slice('/media/'.length).split('/').map(decodeURIComponent).join('/');
    } catch {
        return null;
    }
}

const lengthOf = (item) => Math.max(0, (item.out_ms ?? 0) - (item.in_ms ?? 0));

/** The longest an item's source can play: measured length + the 50 ms slack. */
export const sourceMax = (item) => Math.max(MIN_CLIP_MS, Math.round(Number(item.seconds_ms) || 0)) + TRIM_SLACK_MS;

/** A person's edit clears the Director's note on that item (02-dock.md §4). */
function edited(item, patch) {
    const next = { ...item, ...patch };
    delete next.note;
    return next;
}

/** A ready BoardCut slot as an item: the whole clip, its own sound on, a cut join. */
export function itemFromSlot(slot) {
    const seconds = Math.round((Number(slot.seconds ?? slot.planned_seconds) || 5) * 1000);
    return {
        id: `slot-${slot.node_id}`,
        node_id: slot.node_id,
        take_id: slot.take_id ?? null,
        beat_tag: slot.beat_tag ?? null,
        media_path: mediaPathOf(slot.media_url),
        seconds_ms: seconds,
        in_ms: 0,
        out_ms: seconds,
        sound: true,
        join: { ...CUT_JOIN },
        placed_by: 'person',
    };
}

/** Moves the item at `from` to `to` (both clamped). Joins stay with their item. */
export function moveItem(items, from, to) {
    const target = Math.max(0, Math.min(items.length - 1, to));
    if (from === target || !items[from]) return items;
    const next = items.slice();
    const [item] = next.splice(from, 1);
    next.splice(target, 0, edited(item, {}));
    return next;
}

/**
 * Sets an item's in and/or out, clamped: 0 ≤ in, in + MIN_CLIP_MS ≤ out ≤ measured + 50 ms.
 * A dissolve on either side shrinks to fit the new length (cut-clock clamps it the same way).
 */
export function trimItem(items, index, { in_ms, out_ms } = {}) {
    const item = items[index];
    if (!item) return items;
    const max = sourceMax(item);
    let inMs = Math.round(in_ms ?? item.in_ms);
    let outMs = Math.round(out_ms ?? item.out_ms);
    if (in_ms !== undefined) inMs = Math.max(0, Math.min(inMs, outMs - MIN_CLIP_MS));
    if (out_ms !== undefined) outMs = Math.min(max, Math.max(outMs, inMs + MIN_CLIP_MS));
    inMs = Math.max(0, Math.min(inMs, max - MIN_CLIP_MS));
    if (inMs === item.in_ms && outMs === item.out_ms) return items;
    const next = items.slice();
    next[index] = edited(item, { in_ms: inMs, out_ms: outMs });
    return next;
}

/** Shift+arrow: moves one edge by `delta` ms. */
export function nudgeItem(items, index, edge, delta) {
    const item = items[index];
    if (!item) return items;
    return edge === 'in' ? trimItem(items, index, { in_ms: item.in_ms + delta }) : trimItem(items, index, { out_ms: item.out_ms + delta });
}

/** [ and ]: the edge lands at `sourceMs` (the source time under the playhead). */
export function setEdgeAt(items, index, edge, sourceMs) {
    return edge === 'in' ? trimItem(items, index, { in_ms: sourceMs }) : trimItem(items, index, { out_ms: sourceMs });
}

/** Removes an item from the cut (never the card). The next item's join becomes a cut when it lands first. */
export function removeItem(items, index) {
    if (!items[index]) return items;
    const next = items.slice();
    next.splice(index, 1);
    if (index === 0 && next[0]) next[0] = { ...next[0], join: { ...CUT_JOIN } };
    return next;
}

/** Why a dissolve cannot go on this junction, or null. */
export function dissolveRefusal(items, index) {
    const prev = items[index - 1];
    const item = items[index];
    if (!prev || !item) return 'A dissolve needs a clip before it.';
    if (dissolveMs(DISSOLVE_DEFAULT_MS, lengthOf(prev), lengthOf(item)) < DISSOLVE_MIN_MS) {
        return 'Both clips need at least half a second for a dissolve.';
    }
    return null;
}

/** The chip between two clips: cut ↔ dissolve (500 ms). A dissolve drops a J/L offset (01-core.md §2). */
export function toggleJoin(items, index) {
    const item = items[index];
    if (!item || index === 0) return { items, refused: 'The first clip has no join.' };
    if (item.join?.type === 'dissolve') {
        const next = items.slice();
        next[index] = edited(item, { join: { ...CUT_JOIN } });
        return { items: next, refused: null };
    }
    const refused = dissolveRefusal(items, index);
    if (refused) return { items, refused };
    const next = items.slice();
    next[index] = edited(item, { join: { type: 'dissolve', ms: DISSOLVE_DEFAULT_MS } });
    return { items: next, refused: null };
}

/** M: the clip's own sound off or on. */
export function toggleSound(items, index) {
    const item = items[index];
    if (!item) return items;
    const next = items.slice();
    next[index] = edited(item, { sound: item.sound === false });
    return next;
}

/** Use new take: swaps the pinned take, keeping the trim when it fits. `clamped` says it was reset to fit. */
export function useTake(items, index, take) {
    const item = items[index];
    if (!item || !take?.media_path) return { items, clamped: false };
    const seconds = Math.round(Number(take.seconds_ms) || item.seconds_ms);
    const max = seconds + TRIM_SLACK_MS;
    const fits = item.out_ms <= max && item.in_ms + MIN_CLIP_MS <= item.out_ms;
    const inMs = fits ? item.in_ms : Math.max(0, Math.min(item.in_ms, max - MIN_CLIP_MS));
    const outMs = fits ? item.out_ms : Math.min(max, seconds);
    const next = items.slice();
    next[index] = edited(item, { take_id: take.take_id ?? null, media_path: take.media_path, seconds_ms: seconds, in_ms: inMs, out_ms: Math.max(outMs, inMs + MIN_CLIP_MS) });
    return { items: next, clamped: !fits };
}

/** Why these items cannot be saved, or null (the dock checks before it commits; the server checks again). */
export const itemsRefusal = (items) => checkItems(items);

/** A join in one shape, whoever wrote it: a cut has no length, a dissolve with none gets the default. */
function joinShape(join) {
    const shape = join?.type === 'dissolve' ? { type: 'dissolve', ms: join.ms ?? DISSOLVE_DEFAULT_MS } : { type: 'cut' };
    if (join?.audio_ms) shape.audio_ms = join.audio_ms;
    return shape;
}

const bedShape = (bed, kind) => (bed ? {
    node_id: bed.node_id, take_id: bed.take_id ?? null, gain_db: levelOf({ [kind]: bed }, kind),
    fade_out_ms: bed.fade_out_ms ?? null, start_ms: bed.start_ms ?? null, duck: bed.duck?.depth_db ?? null,
} : null);

/**
 * What the person edits, without what the server stamps (media_path, placed_by, person_rev): two copies that
 * differ only there are the same cut. The restore prompt and adopting a server copy compare with this.
 */
export const cutShape = ({ items = [], sound = null } = {}) => ({
    items: (items ?? []).map((i) => ({
        id: i.id, node_id: i.node_id, take_id: i.take_id ?? null, in_ms: i.in_ms, out_ms: i.out_ms,
        sound: i.sound !== false, join: joinShape(i.join), note: i.note ?? null,
    })),
    sound: sound ? { music: bedShape(sound.music, 'music'), voice: bedShape(sound.voice, 'voice') } : null,
});

/** Same cut for the person (see cutShape). */
export const sameCut = (a, b) => JSON.stringify(cutShape(a ?? {})) === JSON.stringify(cutShape(b ?? {}));

export const levelRange = (kind) => (kind === 'voice' ? VOICE_LEVEL : MUSIC_LEVEL);

/** A bed's level in dB: the saved one, else the slider's default (music sits under the lines). */
export const levelOf = (sound, kind) => {
    const db = sound?.[kind]?.gain_db;
    return Number.isInteger(db) ? db : levelRange(kind).default;
};

/**
 * The sound with one bed's level set. A bed not in the sound yet joins it from BoardCut's bed
 * ({node_id, take_id, media_url}); the music gets the default fade, the voice starts at 0.
 */
export function withLevel(sound, kind, bed, db) {
    const extra = kind === 'voice' ? { start_ms: 0 } : { fade_out_ms: FADE_OUT.default };
    const current = sound?.[kind] ?? (bed ? { node_id: bed.node_id, take_id: bed.take_id ?? null, media_path: mediaPathOf(bed.media_url), ...extra } : null);
    if (!current) return sound ?? null;
    return { ...(sound ?? {}), [kind]: { ...extra, ...current, gain_db: clampLevel(db, levelRange(kind)) } };
}

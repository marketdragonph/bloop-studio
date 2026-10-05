// What the Cut dock draws and plays, in one time map (02-dock.md §7, 01-core.md §5). Built on cut-clock.js
// (the ONE timing function): clips get their export times from cutClock, and board time adds each gap as a
// slate of its planned length. Pure, no DOM; the lanes, the playhead, the counter and the preview all read it.
//
// Two modes: with gaps (board time, the default) and as exported (gaps hidden, every number equals the
// export). Beds always live in export time, so during a slate the bed holds still.
import { cutClock } from './cut-clock.js';
import { itemFromSlot, mediaUrlOf } from './cut-edit.js';
import { FADE_OUT } from './cut-rules.js';

export const FADE_OUT_MS = FADE_OUT.default;
const DEFAULT_GAP_MS = 5000;

const gapMs = (slot) => {
    const seconds = Number(slot?.seconds ?? slot?.planned_seconds);
    return seconds > 0 ? Math.round(seconds * 1000) : DEFAULT_GAP_MS;
};

/**
 * The lane in order: the cut's items as clips, and a gap for every beat with no clip yet, placed after the
 * last clip of an earlier beat. With no items yet, the ready slots stand in as read-only clips (what Fill
 * would make), so the dock shows the shape of the cut before it exists.
 * @returns {{ entries: object[], draft: boolean }}
 */
export function laneEntries(items = [], slots = []) {
    const draft = items.length === 0;
    const bySlotNode = new Map(slots.filter((s) => s.node_id != null).map((s) => [s.node_id, s]));
    const clipItems = draft ? slots.filter((s) => s.state === 'ready').map(itemFromSlot) : items;
    const used = new Set(clipItems.map((i) => i.node_id));
    const entries = [];
    let lastBeat = 0;
    for (const item of clipItems) {
        const slot = bySlotNode.get(item.node_id) ?? null;
        if (slot) lastBeat = slot.index ?? lastBeat;
        entries.push({ kind: 'clip', item, slot, beat: slot?.index ?? lastBeat, gone: !slot && !draft });
    }
    const gaps = slots.filter((s) => s.state !== 'ready' && !(s.node_id != null && used.has(s.node_id)));
    for (const slot of gaps) {
        const beat = slot.index ?? 0;
        let at = 0;
        for (let i = 0; i < entries.length; i++) if (entries[i].beat < beat) at = i + 1;
        entries.splice(at, 0, { kind: 'gap', item: null, slot, beat, gone: false });
    }
    return { entries, draft };
}

/**
 * Times every entry. Clips: `start_ms`/`end_ms` in this mode's time, `export_ms` their export start, `in_ms`
 * the source time at `start_ms`. Gaps: their slate span, `export_ms` the export time they hold (hidden as exported).
 * A dissolve right after a gap plays as a cut on the board (the slate sits between); the export keeps it.
 */
export function layoutLane(entries, { gaps = true } = {}) {
    const clips = entries.filter((e) => e.kind === 'clip');
    const clock = cutClock(clips.map((e) => e.item));
    let k = 0;
    let cursor = 0;
    let exportAt = 0;
    let afterGap = false;
    const timed = entries.map((entry, index) => {
        if (entry.kind === 'gap') {
            const ms = gapMs(entry.slot);
            if (!gaps) return { ...entry, index, hidden: true, start_ms: cursor, end_ms: cursor, ms: 0, export_ms: exportAt };
            const span = { ...entry, index, hidden: false, start_ms: cursor, end_ms: cursor + ms, ms, export_ms: exportAt };
            cursor += ms;
            afterGap = true;
            return span;
        }
        const c = clock.items[k++];
        const overlap = gaps && afterGap ? 0 : c.join.ms;
        const start = k === 1 ? cursor : cursor - overlap;
        cursor = start + c.length_ms;
        exportAt = c.end_ms;
        afterGap = false;
        return {
            ...entry, index, clip: k - 1, hidden: false, start_ms: start, end_ms: cursor, ms: c.length_ms,
            export_ms: c.start_ms, overlap_ms: k === 1 ? 0 : overlap, join: c.join,
            in_ms: entry.item.in_ms, out_ms: entry.item.out_ms,
            src: mediaUrlOf(entry.item.media_path), sound: entry.item.sound !== false,
        };
    });
    return { entries: timed, total_ms: cursor, export_ms: clock.total_ms };
}

/** A stable key per lane entry (the views' x-for keys and the preview's "could not play" list). */
export function entryKey(entry) {
    if (entry.kind === 'clip') return `c:${entry.item.id ?? entry.item.node_id}`;
    return `g:${entry.slot?.beat_tag ?? entry.beat}:${entry.slot?.node_id ?? ''}`;
}

/** The next entry that shows in this mode after `index`, or -1. */
export function nextShown(layout, index) {
    for (let i = index + 1; i < layout.entries.length; i++) if (!layout.entries[i].hidden) return i;
    return -1;
}

/** The next clip after `index` (past any gaps), or -1: the preview loads it early. */
export function nextClip(layout, index) {
    for (let i = index + 1; i < layout.entries.length; i++) if (layout.entries[i].kind === 'clip') return i;
    return -1;
}

/** The entry on screen at `ms` (the incoming clip during a dissolve), or -1 past the end. */
export function entryAt(layout, ms) {
    const list = layout.entries;
    for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (!e.hidden && ms >= e.start_ms && ms < e.end_ms) return i;
    }
    return -1;
}

/** Export time at a time on screen: a slate holds the export clock still. */
export function toExport(layout, ms) {
    const i = entryAt(layout, ms);
    if (i < 0) return layout.export_ms;
    const e = layout.entries[i];
    return e.kind === 'clip' ? e.export_ms + (ms - e.start_ms) : e.export_ms;
}

/** Time on screen for an export time (beat ticks, beds). Past the last clip: the end. */
export function toScreen(layout, exportMs) {
    for (const e of layout.entries) {
        if (e.kind === 'clip' && exportMs >= e.export_ms && exportMs < e.export_ms + e.ms) return e.start_ms + (exportMs - e.export_ms);
    }
    return layout.total_ms;
}

/** The source time under `ms` in a clip entry (for [ and ]). */
export const sourceAt = (entry, ms) => Math.round(entry.in_ms + Math.max(0, Math.min(entry.ms, ms - entry.start_ms)));

/**
 * Where a bed plays, in export time: from its start for its length, once (never looped), cut off at the end
 * of the cut. `to_ms <= from_ms` means it never plays.
 */
export function bedWindow(startMs, bedMs, totalMs) {
    const from = Math.max(0, Math.round(Number(startMs) || 0));
    return { from_ms: from, to_ms: Math.min(Math.max(0, totalMs), from + Math.max(0, Math.round(bedMs))) };
}

/** When the music's 1.5 s fade out starts (01-core.md §5): it ends with the cut or the bed, whichever is first. */
export const fadeStart = (totalMs, bedMs) => Math.max(0, Math.min(totalMs, bedMs) - FADE_OUT_MS);

/**
 * Where a bed's own clock should be at an export time: `null` when it is silent there.
 * @returns {number|null} ms into the bed file
 */
export function bedTime(window, exportMs) {
    if (exportMs < window.from_ms || exportMs >= window.to_ms) return null;
    return exportMs - window.from_ms;
}

/** The bed's gain (0..n, linear) at an export time: its level in dB, then the fade out. */
export function bedGain({ gainDb = 0, fadeFromMs = Infinity }, exportMs) {
    const level = 10 ** ((Number(gainDb) || 0) / 20);
    if (exportMs <= fadeFromMs) return level;
    return level * Math.max(0, 1 - (exportMs - fadeFromMs) / FADE_OUT_MS);
}

/** One number for "the cut is drifting": the bed is off by more than 150 ms (02-dock.md §7). */
export const DRIFT_MS = 150;
export const drifted = (actualMs, expectedMs) => Math.abs(actualMs - expectedMs) > DRIFT_MS;

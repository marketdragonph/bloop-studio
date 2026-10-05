// Where things sit on the Cut dock's lanes (02-dock.md §4). Pure, no DOM: the dock (CutDock) and the
// tests use it, so the strip's geometry is pinned without a browser. Served at /shared/cut-lanes.js.
//
// Two times (01-core.md §5): board time draws every slot, gaps included, at its planned length (the
// mockup's default); export time skips the gaps. Beds always live in export time, so under a gap the bed
// pauses: its lane shows a hatched pause there and carries on after it.

export const ITEM_MIN_PX = 64; // --cut-item-min: the shortest clip is never drawn narrower than this
export const DEFAULT_SLOT_MS = 5000; // a beat with no measured or planned length
export const WAVE_BAR_PX = 6; // the dock asks for one waveform bar per 6 px of lane
export const BED_DECODE_CAP_MS = 600_000; // beds over 10 minutes are never decoded in the page

const pad = (n) => String(n).padStart(2, '0');

export function slotMs(slot) {
    const seconds = Number(slot?.seconds ?? slot?.planned_seconds); // measured, else the card's asked length
    return seconds > 0 ? Math.round(seconds * 1000) : DEFAULT_SLOT_MS;
}

/** "0:47" (whole seconds, for the ruler and the readout). */
export function fmtClock(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** "0:06.0" (tenths, for a clip's length stamp). */
export function fmtLength(ms) {
    const tenths = Math.max(0, Math.round((Number(ms) || 0) / 100));
    const s = Math.floor(tenths / 10);
    return `${Math.floor(s / 60)}:${pad(s % 60)}.${tenths % 10}`;
}

/**
 * Px per second that fills the lane, but never below the scale where the shortest slot is ITEM_MIN_PX;
 * past that the lanes scroll sideways (Fit, 02-dock.md §4).
 */
export function fitScale(laneWidth, slots, minPx = ITEM_MIN_PX) {
    if (!slots.length || !(laneWidth > 0)) return minPx / (DEFAULT_SLOT_MS / 1000);
    const lengths = slots.map(slotMs);
    const totalS = lengths.reduce((a, b) => a + b, 0) / 1000;
    const shortestS = Math.min(...lengths) / 1000;
    return Math.max(laneWidth / totalS, minPx / shortestS);
}

/**
 * Slots in beat order → lane items with board and export positions.
 * @returns {{ key, index, title, ms, ready, board_ms, export_ms, x, w, ...slot }[]}
 */
export function laneLayout(slots, pxPerSec) {
    let board = 0;
    let exported = 0;
    return slots.map((slot, index) => {
        const ms = slotMs(slot);
        const ready = slot.state === 'ready';
        const item = {
            ...slot,
            key: `${index}:${slot.beat_tag ?? ''}:${slot.node_id ?? ''}`,
            index,
            title: slot.label || `${pad(index + 1)} · ${slot.beat_tag || 'Beat'}`, // BoardCut's label is "04 · Flashback"
            ms,
            ready,
            board_ms: board,
            export_ms: ready ? exported : null,
            x: round(board / 1000 * pxPerSec),
            w: round(ms / 1000 * pxPerSec),
        };
        board += ms;
        if (ready) exported += ms;
        return item;
    });
}

export function totals(items) {
    const ready = items.filter((i) => i.ready);
    return {
        count: items.length,
        ready: ready.length,
        board_ms: items.reduce((a, i) => a + i.ms, 0),
        export_ms: ready.reduce((a, i) => a + i.ms, 0),
    };
}

/** "6 of 7 beats · 0:47 · 0:55 with gaps" (the export length first; the board length only with gaps). */
export function readout(items, exportMs = null) {
    const t = totals(items);
    if (!t.count) return '';
    const exportTotal = exportMs ?? t.export_ms;
    const parts = [`${t.ready} of ${t.count} beats`, fmtClock(exportTotal)];
    if (t.ready < t.count) parts.push(`${fmtClock(t.board_ms)} with gaps`);
    return parts.join(' · ');
}

/** Label steps (s). Under a second the lanes are zoomed in (cut-zoom.js); the labels then read tenths. */
const RULER_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const FRAME_S = 1 / 30;
const rulerStep = (pxPerSec, labelPx) => RULER_STEPS.find((s) => s * pxPerSec >= labelPx) ?? RULER_STEPS.at(-1);
/** Minor ticks per label: frames under 0.2 s, fifths from 5 s, else halves. */
const minorsPer = (step) => (step <= 0.2 ? Math.round(step / FRAME_S) : step >= 5 ? 5 : 2);
const rulerLabel = (ms, step) => (step < 1 ? fmtLength(ms) : fmtClock(ms));

/** Ruler ticks: a labelled major every `step` s (labels at least ~48 px apart), minors between. */
export function rulerTicks(boardMs, pxPerSec, { labelPx = 48, maxTicks = 400 } = {}) {
    const step = rulerStep(pxPerSec, labelPx);
    const per = minorsPer(step);
    const minor = step / per;
    const totalS = Math.max(boardMs / 1000, step);
    const ticks = [];
    for (let i = 0; i * minor <= totalS + 1e-9 && ticks.length < maxTicks; i++) {
        const major = i % per === 0;
        ticks.push({ key: i, x: round(i * minor * pxPerSec), major, label: major ? rulerLabel(Math.round(i * minor * 1000), step) : '' });
    }
    return ticks;
}

/**
 * The ruler as the dock draws it (P5): the labelled majors as elements, the minors as one repeating CSS gradient
 * every `minorPx` (a 150 s cut has ~150 ticks; drawing them as elements cost a long task on open). The majors are
 * counted by step, not from the tick list, so a deep zoom (a frame a minor) still labels the whole cut; minorPx
 * keeps 4 decimals so the gradient stays on the frames across the whole span. `fromS`/`toS`: only the labels in
 * that window (a zoomed lane draws the ones near the view; keys stay the step index). With a window the minors come
 * back as elements too (`minors`): a gradient tens of thousands of px wide drifts off the labels as it repeats.
 * @returns {{ majors: { key: number, x: number, label: string }[], minors: { key: number, x: number }[], minorPx: number }}
 */
export function rulerScale(boardMs, pxPerSec, { labelPx = 48, fromS = 0, toS = Infinity } = {}) {
    const step = rulerStep(pxPerSec, labelPx);
    const totalS = Math.max(boardMs / 1000, step);
    const last = Math.floor((Math.min(totalS, toS) + 1e-9) / step);
    const majors = [];
    for (let k = Math.max(0, Math.floor(fromS / step)); k <= last; k++) majors.push({ key: k, x: round(k * step * pxPerSec), label: rulerLabel(Math.round(k * step * 1000), step) });
    const per = minorsPer(step);
    const minor = step / per;
    const minors = [];
    if (Number.isFinite(toS)) { // a window: the zoomed lane
        const end = Math.floor((Math.min(totalS, toS) + 1e-9) / minor);
        for (let j = Math.max(0, Math.ceil(fromS / minor - 1e-9)); j <= end; j++) if (j % per) minors.push({ key: j, x: round(j * minor * pxPerSec) });
    }
    return { majors, minors, minorPx: Math.round(minor * pxPerSec * 10_000) / 10_000 };
}

/** Board ms for an export-time ms (beat ticks, bed spans). Past the last clip: the board end. */
export function toBoardMs(items, exportMs) {
    for (const item of items) {
        if (item.ready && exportMs >= item.export_ms && exportMs < item.export_ms + item.ms) {
            return item.board_ms + (exportMs - item.export_ms);
        }
    }
    return totals(items).board_ms;
}

/**
 * Where a bed (export time, from `startMs` for `lengthMs`) shows on the lanes: one segment per clip it
 * plays under. `from_ms`/`to_ms` are offsets into the bed, so a waveform can be windowed per segment.
 */
export function bedSegments(items, startMs, lengthMs, pxPerSec) {
    const bedEnd = startMs + lengthMs;
    const segments = [];
    for (const item of items) {
        if (!item.ready) continue;
        const a = Math.max(item.export_ms, startMs);
        const b = Math.min(item.export_ms + item.ms, bedEnd);
        if (b <= a) continue;
        const boardA = item.board_ms + (a - item.export_ms);
        segments.push({
            key: item.key,
            x: round(boardA / 1000 * pxPerSec),
            w: round((b - a) / 1000 * pxPerSec),
            from_ms: a - startMs,
            to_ms: b - startMs,
        });
    }
    return segments;
}

/** The hatched pauses a bed lane shows under each gap. */
export function gapBlocks(items) {
    return items.filter((i) => !i.ready).map((i) => ({ key: i.key, x: i.x, w: i.w }));
}

/** How many waveform bars a bed gets at this scale (one per WAVE_BAR_PX, 24..2000). */
export function waveBars(bedMs, pxPerSec) {
    return Math.max(24, Math.min(2000, Math.round((bedMs / 1000) * pxPerSec / WAVE_BAR_PX)));
}

/**
 * Peaks (0..1) → ONE svg path in a viewBox `0 0 peaks.length 100` (one unit per bar), drawn centred.
 * A segment shows its window with viewBox `${from} 0 ${width} 100` (see waveWindow).
 */
export function wavePath(peaks) {
    let d = '';
    for (let i = 0; i < peaks.length; i++) {
        const h = round(Math.max(1, Math.min(1, peaks[i] || 0) * 46));
        d += `M${round(i + 0.15)} ${round(50 - h)}h0.7v${round(h * 2)}h-0.7z`;
    }
    return d;
}

/** The viewBox for one bed segment, in bar units. */
export function waveWindow(segment, bedMs, bars) {
    const from = round((segment.from_ms / bedMs) * bars);
    const width = Math.max(0.01, round(((segment.to_ms - segment.from_ms) / bedMs) * bars));
    return `${from} 0 ${width} 100`;
}

/** A still, made-up waveform for the empty dock's ghost Music lane (05 §2.3): static, the same every time. */
export function ghostPeaks(bars = 72) {
    return Array.from({ length: bars }, (_, k) => 0.25 + 0.6 * Math.abs(Math.sin(k * 0.71) * Math.cos(k * 0.23 + 1)));
}

function round(n) {
    return Math.round(n * 100) / 100;
}

// The export preflight (01-core.md §6 CheckCut, 02-dock.md "Export preflight"). The sheet shows it before the
// press and CheckCut runs it again on the saved revision. Order matters: everything about the cut itself is
// checked first, so a cut over the limits is refused without starting a single process; then the video tools
// (a cached check), then free disk (3 × the estimate). Plain reasons only; it never changes anything.
import { statfs as fsStatfs } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cutClock } from '../../shared/cut-clock.js';
import { CUT_LIMITS } from '../../shared/cut-rules.js';
import { checkPreset, estimateBytes, lengthHint, presetLine, presetOutput } from '../../shared/export-presets.js';
import { beatTitle } from './board-cut.js';

const DISK_FACTOR = 3;
const pad = (n) => String(n).padStart(2, '0');
const minutes = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};
const gb = (bytes) => `${Math.max(0.1, Math.round(bytes / 1e8) / 10)} GB`;

/** "04 · Flashback": the beat's label from the board, else the clip's place in the cut. */
export function itemLabel(item, index, slots = []) {
    const slot = slots.find((s) => s.node_id != null && s.node_id === item.node_id);
    return slot?.label ?? `${pad(index + 1)} · ${beatTitle(item.beat_tag)}`;
}

/**
 * @param {{ spaceId: number, snapshot: { revision: number, items: object[], sound: object|null, settings: object },
 *   preset: string, variant?: string|null, boardCut: import('./board-cut.js').BoardCut, media: { resolve(p: string): string|null, getRoot(): string },
 *   tools?: { state(): Promise<object> } | null, exists?: (p: string) => boolean, statfs?: (p: string) => Promise<{ bavail: number, bsize: number }> }} input
 * `variant` (P6): the shape of this file in the Shapes row; null = the preset's own shape, else the cut's.
 * @returns {Promise<object>} `{ ok, code?, reason?, beat?, items, skipped, total_ms, estimate_bytes, output, plan_shape, audio_encoder, line, hint }`
 */
export async function preflight({ spaceId, snapshot, preset, variant = null, boardCut, media, tools = null, exists = existsSync, statfs = fsStatfs }) {
    const read = boardCut.read(spaceId, { cut: { items: snapshot.items } });
    const planAspect = read.slots.find((s) => s.plan_aspect)?.plan_aspect ?? null;
    const planShape = snapshot.settings?.aspect ?? planAspect ?? '16:9';
    const output = presetOutput(preset, { ...snapshot.settings, aspect: planShape }, variant);
    const total = cutClock(snapshot.items).total_ms;
    const skipped = read.slots.filter((s) => s.state !== 'ready' && !snapshot.items.some((i) => i.node_id === s.node_id)).map((s) => s.label);
    const items = snapshot.items.map((item, index) => ({ ...item, index, label: itemLabel(item, index, read.slots), src: item.media_path ? media.resolve(item.media_path) : null }));
    const result = { ok: false, items, skipped, total_ms: total, estimate_bytes: estimateBytes(total), output, audio_encoder: null, line: presetLine(output, total), plan_shape: planShape, hint: lengthHint(preset, total) };
    const refuse = (code, reason, beat = null) => ({ ...result, code, reason, beat });

    const presetReason = checkPreset(preset);
    if (presetReason) return refuse('limits', presetReason);
    if (!items.length) return refuse('limits', 'The cut has no clips yet. Fill the cut, then export.');
    if (items.length > CUT_LIMITS.maxItems) return refuse('limits', `A cut holds at most ${CUT_LIMITS.maxItems} clips; this one has ${items.length}.`);
    if (total > CUT_LIMITS.maxTotalMs) return refuse('limits', `The cut is ${minutes(total)}. The limit is ${minutes(CUT_LIMITS.maxTotalMs)}.`);
    const lost = items.find((i) => !i.src || !exists(i.src));
    if (lost) return refuse('clip', `${lost.label}: its file is missing from the media folder. Remove it and export again.`, lost.beat_tag ?? null);
    for (const kind of ['music', 'voice']) {
        const bed = snapshot.sound?.[kind];
        if (bed?.media_path && !exists(media.resolve(bed.media_path) ?? '')) return refuse('limits', `The ${kind} file is missing from the media folder.`);
    }

    if (tools) {
        const state = await tools.state();
        if (!state.ready) return refuse('tools', state.reason);
        result.audio_encoder = state.encoders.audio;
    }

    try {
        const { bavail, bsize } = await statfs(media.getRoot());
        const free = Number(bavail) * Number(bsize);
        const need = DISK_FACTOR * result.estimate_bytes;
        if (Number.isFinite(free) && free < need) {
            return refuse('disk', `The export needs about ${gb(need)} free on the media folder's disk; there is ${gb(free)}.`);
        }
    } catch {
        // No answer from the disk: the -fs caps still hold, so the export goes on.
    }
    return { ...result, ok: true };
}

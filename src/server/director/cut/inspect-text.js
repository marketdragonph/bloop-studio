// inspect_cut's answer (03-director.md §5): one compact line per clip and one for the bed, with the measured
// numbers only — never a guess. Times are seconds into the clip (trims are set in clip time); the bed's beats are
// in cut time. Estimates say "estimated". What is not measured yet is named, so the model leaves it alone.
import { cutClock } from '../../../shared/cut-clock.js';
import { fitPlan } from '../../../shared/cut-rules.js';
import { beatsInCut } from '../../../shared/cut-ducks.js';
import { isLocked } from './lock.js';

const s1 = (ms) => (Math.round(ms / 100) / 10).toFixed(1);
const span = ([a, b]) => `${s1(a)}–${s1(b)}`;
const quote = (text) => {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    return t ? ` "${t.length > 60 ? `${t.slice(0, 60)}…` : t}"` : '';
};

/** One clip's line. `words`: the beat's script, `lose`: what fitPlan says it can lose. */
export function clipLine(item, a, { words = null, lose = 0, index = 0, start = 0 } = {}) {
    const parts = [`${item.beat_tag} @${item.node_id} ${s1(item.seconds_ms)} s, used ${s1(item.in_ms)}–${s1(item.out_ms)}, at ${s1(start)} in the cut`];
    if (index > 0 && item.join?.type === 'dissolve') parts.push(`dissolve in ${s1(item.join.ms ?? 500)}`);
    if (item.join?.audio_ms) parts.push(item.join.audio_ms < 0 ? `J cut ${s1(-item.join.audio_ms)}` : `L cut from the clip before ${s1(item.join.audio_ms)}`);
    if (!item.sound) parts.push('own sound off');
    if (isLocked(item)) parts.push('THE PERSON\'S (locked)');
    if (a.still_head) parts.push(`still head ${span(a.still_head)}`);
    if (a.still_tail && a.still_tail !== a.still_head) parts.push(`still tail ${span(a.still_tail)}`);
    for (const [i, s] of (a.speech ?? []).entries()) parts.push(`speech ${span(s)}${i === 0 ? quote(words) : ''}`);
    if (a.has_audio === false) parts.push('no sound in the file');
    else for (const s of (a.silence ?? []).slice(0, 3)) parts.push(`silence ${span(s)}`);
    if (a.loudness) parts.push(`${a.loudness.i.toFixed(1)} LUFS${a.loudness.tp != null ? `, peak ${a.loudness.tp.toFixed(1)} dBTP` : ''}`);
    for (const ms of (a.scenes ?? []).slice(0, 4)) parts.push(`scene change ${s1(ms)}`);
    if (lose > 0) parts.push(`can lose ${s1(lose)} s`);
    return parts.join(' | ');
}

/** The bed's line. */
export function bedLine(kind, bed, a, totalMs) {
    const parts = [`${kind} @${bed.node_id} ${s1(a.duration_ms)} s`];
    const { downbeats_ms } = beatsInCut(a, totalMs);
    if (kind === 'music') {
        if (a.bpm) parts.push(`~${a.bpm} BPM (estimated)`);
        if (downbeats_ms.length) parts.push(`downbeats ${downbeats_ms.slice(0, 12).map(s1).join(' ')}${downbeats_ms.length > 12 ? ' …' : ''} (in cut time)`);
        else parts.push('no steady beat found');
    }
    if (a.loudness) parts.push(`${a.loudness.i.toFixed(1)} LUFS`);
    parts.push(`level ${bed.gain_db} dB`);
    if (bed.duck) parts.push(`ducks ${bed.duck.depth_db} dB under lines`);
    parts.push(`ends ${s1(a.duration_ms)} s (cut is ${s1(totalMs)} s)`);
    return parts.join(' | ');
}

/**
 * The whole answer.
 * @param {{ cut: object, analysisOf: Function, wanted: Set<string>|null, scripts: Map<string, string>,
 *   toolsMissing: boolean, measuring: (path: string) => boolean, reasons: (tag: string) => object[] }} input
 */
export function inspectText({ cut, analysisOf, wanted = null, scripts = new Map(), toolsMissing = false, measuring = () => false, reasons = () => [] }) {
    if (toolsMissing) return 'Not measured: the video tools are missing on this PC. Use no times.';
    const clock = cutClock(cut.items);
    const fit = fitPlan(cut.items, new Map(cut.items.map((i) => [i.media_path, analysisOf(i.media_path)]).filter(([, a]) => a)), 0);
    const lose = new Map(fit.can_lose.map((t) => [t.item_id, t.lose_ms]));
    const lines = [`THE CUT: ${cut.items.length} clips, ${s1(clock.total_ms)} s, revision ${cut.revision}. Clip times are seconds into each clip.`];
    const missing = [];
    cut.items.forEach((item, index) => {
        if (wanted && !wanted.has(item.beat_tag?.toLowerCase())) return;
        const a = analysisOf(item.media_path);
        if (!a) return missing.push(`${item.beat_tag} (${measuring(item.media_path) ? 'queued' : 'not measured'})`);
        if (a.status === 'failed' || a.error) return missing.push(`${item.beat_tag} (could not be read)`);
        lines.push(clipLine(item, a, { words: scripts.get(item.beat_tag), lose: lose.get(item.id) ?? 0, index, start: clock.items[index].start_ms }));
        if (wanted) for (const r of reasons(item.beat_tag)) lines.push(`  Last edit: ${r.text ?? r.op} — ${r.why}`);
    });
    for (const kind of ['music', 'voice']) {
        const bed = cut.sound?.[kind];
        if (!bed || wanted) continue;
        const a = analysisOf(bed.media_path);
        if (a) lines.push(bedLine(kind, bed, a, clock.total_ms));
        else missing.push(`the ${kind} bed (${measuring(bed.media_path) ? 'queued' : 'not measured'})`);
    }
    if (missing.length) lines.push(`Not measured yet: ${missing.join(', ')}. Use only these numbers; do not guess the rest.`);
    return lines.join('\n');
}

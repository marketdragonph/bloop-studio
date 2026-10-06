// Check your cut, the timed rules (05 §3.6, 03-director.md §6): LINE_CUT_OFF, DEAD_AIR, LOUDNESS_OFF,
// MUSIC_ENDS_EARLY, OVER_RUNTIME, SHORT and JUMP, from the cut and the measured analysis. Pure: no db, no ffmpeg.
// BoardCut's untimed findings (GAP, STALE, TAKES, UNMEASURED, ORDER_GUESSED, MIXED_ASPECT, RUNTIME_OFF,
// MISSING_FILE) stay in board-cut.js; mergeFindings() puts both in one list for the dock, and the Director's critic
// (director/cut/audit-cut.js) turns the same list into its "CHECK YOUR CUT" lines. A finding reports, never edits.
//
// Finding: { code, text, beat_tag, node_id, item_id, at_ms, ...numbers } — `text` is for the person, `at_ms` is
// where Show me / Go to item jumps (export time).
import { cutClock } from '../../shared/cut-clock.js';
import { CRITIC, CUT_LIMITS } from '../../shared/cut-rules.js';

const s1 = (ms) => (Math.round(ms / 100) / 10).toFixed(1);
const pad = (n) => String(n).padStart(2, '0');
const clockText = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};
const cutPieces = (span, holes) => {
    let pieces = [span];
    for (const [a, b] of holes) {
        pieces = pieces.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, Math.max(x, a)], [Math.min(y, b), y]].filter(([p, q]) => q > p)));
    }
    return pieces;
};
const invert = (spans, from, to) => cutPieces([from, to], spans);

// Shot words (03 §6 JUMP): a words heuristic on each beat's brief, and it says so.
const SIZES = [
    ['extreme close-up', /\bextreme close[- ]?ups?\b|\becu\b/i], ['close-up', /\bclose[- ]?ups?\b|\bclose shot\b|\bcu\b/i],
    ['medium close-up', /\bmedium close\b|\bmcu\b/i], ['medium', /\bmedium( shot)?\b|\bmid[- ]shot\b/i],
    ['wide', /\bwide( shot)?\b|\blong shot\b|\bestablishing\b|\bfull shot\b/i], ['insert', /\binsert\b/i],
];
const ANGLES = [
    ['low angle', /\blow[- ]angle\b/i], ['high angle', /\bhigh[- ]angle\b/i], ['overhead', /\boverhead\b|\bbird'?s[- ]eye\b|\btop[- ]down\b/i],
    ['over the shoulder', /\bover[- ]the[- ]shoulder\b|\bots\b/i], ['point of view', /\bpov\b|\bpoint of view\b/i], ['dutch', /\bdutch\b/i],
];
export function shotWords(text) {
    const t = String(text ?? '');
    return { size: SIZES.find(([, re]) => re.test(t))?.[0] ?? null, angle: ANGLES.find(([, re]) => re.test(t))?.[0] ?? 'eye level' };
}

/**
 * @param {{ cut: { items: object[], sound: object|null }, slots?: object[], plan?: { runtime_seconds?: number }|null,
 *   briefs?: Map<string, string>, analysisOf: (mediaPath: string) => object|null }} input
 * @returns {object[]}
 */
export function timedFindings({ cut, slots = [], plan = null, briefs = new Map(), analysisOf }) {
    const items = cut?.items ?? [];
    const out = [];
    const clock = cutClock(items);
    const total = clock.total_ms;
    const add = (code, item, text, extra = {}) => out.push({ code, text, beat_tag: item?.beat_tag ?? null, node_id: item?.node_id ?? null, item_id: item?.id ?? null, ...extra });
    const bed = cut?.sound?.music ? analysisOf(cut.sound.music.media_path) : null;
    const bedEnd = cut?.sound?.music ? (bed?.duration_ms ?? null) : 0; // null: a bed nobody measured

    items.forEach((item, i) => {
        const a = analysisOf(item.media_path);
        const at = clock.items[i];
        if (!a) return;
        const speech = item.sound ? a.speech ?? [] : [];
        // LINE_CUT_OFF: an in or out point inside a spoken line, unless a J or L cut lets the line be heard.
        const early = Math.max(0, -(item.join?.audio_ms ?? 0));
        const late = Math.max(0, items[i + 1]?.join?.audio_ms ?? 0);
        for (const [from, to] of speech) {
            const inside = (ms) => ms > from + CRITIC.lineInsideMs && ms < to - CRITIC.lineInsideMs;
            if (inside(item.in_ms) && item.in_ms - early > from + CRITIC.lineInsideMs) {
                add('LINE_CUT_OFF', item, `${item.beat_tag}: a spoken line is cut off at its start.`, { at_ms: at.start_ms, edge: 'in', line: [from, to] });
            }
            if (inside(item.out_ms) && item.out_ms + late < to - CRITIC.lineInsideMs) {
                add('LINE_CUT_OFF', item, `${item.beat_tag}: a spoken line is cut off at its end.`, { at_ms: at.end_ms, edge: 'out', line: [from, to] });
            }
        }
        // DEAD_AIR: still frames with no line, no clip sound and no music under them.
        const audible = item.sound && a.has_audio ? invert(a.silence ?? [], 0, a.duration_ms ?? item.seconds_ms) : [];
        for (const [sa, sb] of a.still ?? []) {
            const from = Math.max(sa, item.in_ms);
            const to = Math.min(sb, item.out_ms);
            if (to - from < CRITIC.deadAirMs) continue;
            for (const [p, q] of cutPieces([from, to], [...speech, ...audible])) {
                const exportFrom = at.start_ms + (p - item.in_ms);
                const musicUnder = cut?.sound?.music && (bedEnd == null || exportFrom < bedEnd);
                if (q - p >= CRITIC.deadAirMs && !musicUnder) {
                    add('DEAD_AIR', item, `${item.beat_tag}: ${s1(q - p)} s where nothing moves and nothing sounds.`, { at_ms: exportFrom, span: [p, q] });
                    break;
                }
            }
        }
    });

    // LOUDNESS_OFF: a clip whose own sound is far louder or quieter than the clips around it (the median of up to
    // two on each side, so one loud clip does not make its quiet neighbours look wrong too).
    const loud = items.map((item) => (item.sound ? analysisOf(item.media_path)?.loudness?.i ?? null : null));
    items.forEach((item, i) => {
        if (loud[i] == null) return;
        const near = [loud[i - 2], loud[i - 1], loud[i + 1], loud[i + 2]].filter((v) => v != null).sort((a, b) => a - b);
        if (!near.length) return;
        const mid = near.length % 2 ? near[(near.length - 1) / 2] : (near[near.length / 2 - 1] + near[near.length / 2]) / 2;
        const off = loud[i] - mid;
        if (Math.abs(off) > CRITIC.loudnessJumpLu) {
            add('LOUDNESS_OFF', item, `${item.beat_tag}: its sound is ${Math.round(Math.abs(off))} LU ${off > 0 ? 'louder' : 'quieter'} than the clips around it.`, { at_ms: clock.items[i].start_ms, lu: Math.round(off * 10) / 10 });
        }
    });

    // SHORT: the clip is shorter than its beat asked for.
    for (const slot of slots) {
        if (slot.state !== 'ready' || !slot.measured || !slot.planned_seconds) continue;
        const short = Math.round(slot.planned_seconds * 1000 - slot.seconds * 1000);
        if (short > CRITIC.shortMs) {
            const i = items.findIndex((it) => it.node_id === slot.node_id);
            add('SHORT', items[i] ?? { beat_tag: slot.beat_tag, node_id: slot.node_id }, `${slot.beat_tag}: short by ${s1(short)} s.`, { at_ms: i >= 0 ? clock.items[i].start_ms : null, short_ms: short });
        }
    }

    // JUMP: the same shot size and angle twice in a row (from the briefs' words). The two parts of a split that
    // plays straight on (same card and take, the second starting where the first ends) are one shot, not a jump.
    for (let i = 1; i < items.length; i++) {
        const [prev, cur] = [items[i - 1], items[i]];
        if (prev.node_id === cur.node_id && (prev.take_id ?? null) === (cur.take_id ?? null) && cur.in_ms === prev.out_ms) continue;
        const [a, b] = [shotWords(briefs.get(items[i - 1].beat_tag)), shotWords(briefs.get(items[i].beat_tag))];
        if (a.size && a.size === b.size && a.angle === b.angle && items[i].join?.type !== 'dissolve') {
            add('JUMP', items[i], `${items[i - 1].beat_tag} → ${items[i].beat_tag}: two ${a.size} shots at the same angle in a row (read from the briefs' words).`, { at_ms: clock.items[i].start_ms });
        }
    }

    if (items.length && bedEnd != null && cut?.sound?.music && bedEnd < total - CRITIC.musicEarlyMs) {
        add('MUSIC_ENDS_EARLY', null, `The music ends at ${clockText(bedEnd)}; the picture runs to ${clockText(total)}.`, { at_ms: bedEnd });
    }
    const runtime = (plan?.runtime_seconds ?? 0) * 1000;
    if (items.length && ((runtime && total > runtime * (1 + CRITIC.runtimeSlack)) || total > CUT_LIMITS.maxTotalMs)) {
        add('OVER_RUNTIME', null, runtime ? `The cut is ${clockText(total)}; the plan asked for ${clockText(runtime)}.` : `The cut is ${clockText(total)}, over the 10-minute limit.`, { at_ms: 0, total_ms: total, runtime_ms: runtime || null });
    }
    return out;
}

/** BoardCut's findings plus the timed ones; OVER_RUNTIME replaces a long RUNTIME_OFF (RUNTIME_OFF keeps "too short"). */
export function mergeFindings(base, timed) {
    const over = timed.some((f) => f.code === 'OVER_RUNTIME');
    return [...base.filter((f) => !(over && f.code === 'RUNTIME_OFF')), ...timed];
}

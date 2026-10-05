// THE rule file for the Cut (01-core.md §2, katana.md §6 "one rule file"): caps, trims, joins, J/L, sound levels
// and settings. Pure, no DOM, no Node APIs: the dock checks an edit before it saves, the server's validate-cut.js
// checks every save, and the Director's ops (P4) read the same numbers. Every check returns a plain reason the
// person can act on, or null when the cut is fine.
import { DISSOLVE_DEFAULT_MS, DISSOLVE_MAX_MS, DISSOLVE_MIN_MS, cutClock } from './cut-clock.js';

export const CUT_LIMITS = Object.freeze({
    maxItems: 50, // the Director's beat cap (owner decision 3)
    maxTotalMs: 600_000, // 10 minutes
    trimSlackMs: 50, // out may pass the measured length by this much (container rounding)
    maxClipMs: 600_000,
    noteMax: 40, // the Director's clip note, sensor blue on the chip
    tagMax: 80,
    idMax: 64,
    jlMaxMs: 1500, // |join.audio_ms| for a J or L cut (P4)
});

export const JOIN_TYPES = Object.freeze(['cut', 'dissolve']);
export const DISSOLVE = Object.freeze({ min: DISSOLVE_MIN_MS, max: DISSOLVE_MAX_MS, default: DISSOLVE_DEFAULT_MS });

/** Music level slider (05 §3.5): −24 to +6 dB in 1 dB steps. The bed sits under the lines by default. */
export const MUSIC_LEVEL = Object.freeze({ min: -24, max: 6, step: 1, default: -12 });
export const VOICE_LEVEL = Object.freeze({ min: -24, max: 6, step: 1, default: 0 });
/** Duck under lines (P4): depth −3 to −18 dB, default −10; attack and release are fixed (01-core.md §2). */
export const DUCK = Object.freeze({ min: -18, max: -3, step: 1, default: -10, attack_ms: 120, release_ms: 400 });
/** The bed's fade out at the end of the cut (cut-clock fadeStart uses the default). */
export const FADE_OUT = Object.freeze({ min: 0, max: 5000, default: 1500 });

export const RESOLUTIONS = Object.freeze([720, 1080]);
export const FRAME_RATES = Object.freeze([30]);
export const ASPECTS = Object.freeze(['16:9', '9:16', '1:1']);

const isInt = (value) => Number.isInteger(value);
const inRange = (value, { min, max }) => Number.isFinite(value) && value >= min && value <= max;
const pad = (n) => String(n).padStart(2, '0');
const minutes = (ms) => {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}:${pad(s % 60)}` : `${s} s`;
};
const name = (item, index) => item?.beat_tag ? `Clip ${index + 1} (${item.beat_tag})` : `Clip ${index + 1}`;

/** "Music −14 dB" (a real minus sign, for the slider's aria-valuetext and the lane readout). */
export const levelText = (kind, db) => `${kind} ${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db)} dB`;

/** Clamps a level to its slider and step. */
export const clampLevel = (db, range = MUSIC_LEVEL) => {
    const n = Number.isFinite(Number(db)) ? Math.round(Number(db) / range.step) * range.step : range.default;
    return Math.min(range.max, Math.max(range.min, n));
};

/**
 * One item on its own. `lengthMs` is the clip's real length (measured, else the snapshot `seconds_ms`).
 * @returns {string|null}
 */
export function checkItem(item, index = 0, lengthMs = item?.seconds_ms) {
    const label = name(item, index);
    if (!item || typeof item !== 'object') return `${label} is not a clip.`;
    if (!isInt(item.node_id) || item.node_id <= 0) return `${label} has no card.`;
    if (!isInt(item.in_ms) || !isInt(item.out_ms)) return `${label} needs whole-millisecond in and out points.`;
    if (!isInt(lengthMs) || lengthMs <= 0 || lengthMs > CUT_LIMITS.maxClipMs) return `${label} has no usable length.`;
    if (item.in_ms < 0) return `${label} starts before its clip does.`;
    if (item.out_ms <= item.in_ms) return `${label} ends before it starts.`;
    if (item.out_ms > lengthMs + CUT_LIMITS.trimSlackMs) return `${label} runs past the end of its clip (${minutes(lengthMs)}).`;
    if (typeof item.sound !== 'boolean') return `${label}: clip sound must be on or off.`;
    if (item.note != null && (typeof item.note !== 'string' || item.note.length > CUT_LIMITS.noteMax)) {
        return `${label}: a clip note is at most ${CUT_LIMITS.noteMax} characters.`;
    }
    return checkJoin(item.join, label);
}

function checkJoin(join, label) {
    if (join == null) return null;
    if (!JOIN_TYPES.includes(join.type)) return `${label}: a join is a cut or a dissolve.`;
    if (join.type === 'dissolve' && join.ms != null && !(isInt(join.ms) && inRange(join.ms, DISSOLVE))) {
        return `${label}: a dissolve is ${DISSOLVE.min} to ${DISSOLVE.max} ms.`;
    }
    if (join.audio_ms != null && join.audio_ms !== 0) {
        if (!isInt(join.audio_ms) || Math.abs(join.audio_ms) > CUT_LIMITS.jlMaxMs) return `${label}: a J or L cut shifts the sound by at most 1.5 s.`;
        if (join.type !== 'cut') return `${label}: a J or L cut sits only on a cut, never on a dissolve.`;
    }
    return null;
}

/** J/L needs source sound outside the trim on the side it borrows from, and sound on both clips. */
function checkBorrow(previous, item, label) {
    const shift = item.join?.audio_ms ?? 0;
    if (!shift) return null;
    if (!previous) return `${label} is the first clip, so its sound cannot start early or run late.`;
    if (!previous.sound || !item.sound) return `${label}: a J or L cut needs the sound on in both clips.`;
    if (shift < 0 && item.in_ms < -shift) return `${label} has no sound before its in point to start early.`;
    if (shift > 0 && previous.seconds_ms - previous.out_ms < shift) return `${label}: the clip before has no sound after its out point to run on.`;
    return null;
}

/**
 * The whole list: count, unique ids, each item, J/L borrowing, and the total length (by the one clock).
 * @returns {string|null}
 */
export function checkItems(items) {
    if (!Array.isArray(items)) return 'The cut must be a list of clips.';
    if (items.length > CUT_LIMITS.maxItems) return `A cut holds at most ${CUT_LIMITS.maxItems} clips; this one has ${items.length}.`;
    const ids = new Set();
    for (const [index, item] of items.entries()) {
        const label = name(item, index);
        if (typeof item?.id !== 'string' || !item.id || item.id.length > CUT_LIMITS.idMax) return `${label} has no id.`;
        if (ids.has(item.id)) return `${label} is in the cut twice.`;
        ids.add(item.id);
        const reason = checkItem(item, index) ?? checkBorrow(items[index - 1], item, label);
        if (reason) return reason;
    }
    const { total_ms: total } = cutClock(items);
    if (total > CUT_LIMITS.maxTotalMs) return `The cut is ${minutes(total)}. The limit is ${minutes(CUT_LIMITS.maxTotalMs)}.`;
    return null;
}

/**
 * `sound` = null, or `{ music?: {node_id, gain_db, fade_out_ms, duck?: {depth_db}}, voice?: {node_id, gain_db, start_ms} }`.
 * @returns {string|null}
 */
export function checkSound(sound) {
    if (sound == null) return null;
    if (typeof sound !== 'object' || Array.isArray(sound)) return 'The cut\'s sound is not readable.';
    for (const kind of Object.keys(sound)) if (kind !== 'music' && kind !== 'voice') return `The cut has no ${kind} track.`;
    const { music, voice } = sound;
    if (music != null) {
        if (!isInt(music.node_id)) return 'The music has no card.';
        if (!(isInt(music.gain_db) && inRange(music.gain_db, MUSIC_LEVEL))) return `Music level is ${MUSIC_LEVEL.min} to +${MUSIC_LEVEL.max} dB.`;
        if (!(isInt(music.fade_out_ms) && inRange(music.fade_out_ms, FADE_OUT))) return 'The music fade is 0 to 5 seconds.';
        if (music.duck != null && !(isInt(music.duck.depth_db) && inRange(music.duck.depth_db, DUCK))) {
            return `Ducking under lines is ${DUCK.max} to ${DUCK.min} dB.`;
        }
    }
    if (voice != null) {
        if (!isInt(voice.node_id)) return 'The voice has no card.';
        if (!(isInt(voice.gain_db) && inRange(voice.gain_db, VOICE_LEVEL))) return `Voice level is ${VOICE_LEVEL.min} to +${VOICE_LEVEL.max} dB.`;
        if (!(isInt(voice.start_ms) && inRange(voice.start_ms, { min: 0, max: CUT_LIMITS.maxTotalMs }))) return 'The voice starts inside the cut.';
    }
    return null;
}

/** `{resolution, fps, aspect?}`. @returns {string|null} */
export function checkSettings(settings) {
    if (settings == null || typeof settings !== 'object') return 'The cut\'s settings are not readable.';
    if (!RESOLUTIONS.includes(settings.resolution)) return 'The cut exports at 720p or 1080p.';
    if (!FRAME_RATES.includes(settings.fps)) return 'The cut exports at 30 frames a second.';
    if (settings.aspect != null && !ASPECTS.includes(settings.aspect)) return 'The cut is 16:9, 9:16 or 1:1.';
    return null;
}

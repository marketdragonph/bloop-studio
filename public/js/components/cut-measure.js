// What the analysis measured, in the dock (03-director.md §5, 05-irresistible.md §3.4–§3.5). Spread into CutDock.
// - "Measuring 3 clips…" in sensor blue on the rail while the media-tools queue reads the cut's clips and bed.
// - Beat ticks on the ruler from the measured onsets only (`beats_ms`, downbeats taller), labelled estimated. With
//   no video tools there are none, and the Music lane says "Not measured".
// - Snap to beats (the open dock's track header): a dragged trim whose cut point lands within 80 ms of a downbeat
//   goes onto it, through cut-sound.js snapToBeat, the function the Director's validator uses. Never on drafts,
//   never on keyboard nudges (a 0.1 s nudge must move 0.1 s).
// - Duck under lines (the Music level popover): −18 to −3 dB; the preview follows at once, one undo step on release.
//   Duck bands and dialogue spans are drawn from the server's `ducks` and `speech` (export time), so the dock shows
//   the numbers the export and the Director use. Never derived here from anything but those.
import { controlLabel, copy } from '/shared/katana-controls.js';
import { fmtLength } from '/shared/cut-lanes.js';
import { cutClock } from '/shared/cut-clock.js';
import { DUCK, clampLevel } from '/shared/cut-rules.js';
import { BEAT_SNAP_MS, snapToBeat } from '/shared/cut-sound.js';
import { levelOf, trimItem, withLevel } from '/shared/cut-edit.js';
import { toScreen } from '/shared/cut-timeline.js';

const SNAP_KEY = 'bloop-studio:cut-snap';
const ms = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const times = (v) => (Array.isArray(v) ? v.map(ms).filter((n) => n != null && n >= 0) : []);
const spans = (v) => (Array.isArray(v) ? v : [])
    .map((s) => ({ from_ms: ms(s?.from_ms), to_ms: ms(s?.to_ms), beat_tag: s?.beat_tag ?? null, text: typeof s?.text === 'string' ? s.text : '' }))
    .filter((s) => s.from_ms != null && s.to_ms != null && s.to_ms > s.from_ms);

function readSnap() {
    try { return globalThis.localStorage?.getItem(SNAP_KEY) === '1'; } catch { return false; }
}

function saveSnap(on) {
    try { globalThis.localStorage?.setItem(SNAP_KEY, on ? '1' : '0'); } catch { /* private window: the toggle still works */ }
}

/** The analysis readout: { state: 'idle' | 'measuring' | 'missing' | 'done', pending }. */
export function readAnalysis(raw) {
    const pending = Math.max(0, ms(raw?.pending) ?? 0);
    const state = raw?.state === 'missing' || raw?.tools === false ? 'missing' : pending > 0 || raw?.state === 'measuring' ? 'measuring' : raw?.state === 'done' ? 'done' : 'idle';
    return { state, pending };
}

/**
 * Snaps a trimmed clip's cut point (its end in export time) onto a downbeat within 80 ms. Moving `out` moves the
 * end by the same amount; moving `in` moves it the other way. Returns the items unchanged when nothing is near.
 */
export function snapTrim(items, index, edge, beatsMs) {
    const clock = cutClock(items);
    const end = clock.items[index]?.end_ms;
    const beat = snapToBeat(end, beatsMs, BEAT_SNAP_MS);
    if (end == null || beat == null || beat === end) return { items, beat: null };
    const item = items[index];
    const delta = beat - end;
    const next = edge === 'in' ? trimItem(items, index, { in_ms: item.in_ms - delta }) : trimItem(items, index, { out_ms: item.out_ms + delta });
    return cutClock(next).items[index]?.end_ms === beat ? { items: next, beat } : { items, beat: null };
}

export const cutMeasureMethods = {
    cutAnalysis: { state: 'idle', pending: 0 },
    cutDownbeatsMs: [],
    cutDucksMs: [], // duck windows, export ms, from the server
    cutSpeechMs: [], // measured spoken lines, export ms
    cutDuckBands: [], // on screen
    cutSpeechSpans: [],
    cutSnap: false, // read once on the first load (cutApplyMeasure); remembered per viewer
    _cutDuckBefore: null,

    /** From GET /spaces/:id/cut: beats, downbeats, ducks, speech spans and the analysis state. */
    cutApplyMeasure(data) {
        if (!this._cutSnapRead) { this._cutSnapRead = true; this.cutSnap = readSnap(); }
        this.cutBeatsMs = times(data?.beats_ms);
        this.cutDownbeatsMs = times(data?.downbeats_ms);
        this.cutDucksMs = spans(data?.ducks);
        this.cutSpeechMs = spans(data?.speech);
        this.cutAnalysis = readAnalysis(data?.analysis);
    },

    /** A `cut` event can carry the analysis state alone (measuring started or finished). */
    cutAnalysisEvent(raw) {
        if (raw && typeof raw === 'object') this.cutAnalysis = readAnalysis(raw);
    },

    /** Ruler ticks (downbeats taller), duck bands and dialogue spans at the lane's scale. Called from cutLayout. */
    cutMeasureLayout(layout, pps) {
        const x = (t) => Math.round(toScreen(layout, t) / 1000 * pps * 100) / 100;
        const down = new Set(this.cutDownbeatsMs);
        const beats = this.cutBeatsMs.length ? this.cutBeatsMs : this.cutDownbeatsMs;
        this.cutBeats = beats.filter((t) => t <= layout.export_ms).map((t, i) => ({ key: i, x: x(t), down: down.has(t) }));
        const band = (s, i) => ({ key: `${s.from_ms}:${i}`, x: x(s.from_ms), w: Math.max(1, x(s.to_ms) - x(s.from_ms)), text: s.text, beat_tag: s.beat_tag });
        this.cutDuckBands = this.cutDuckDb() == null ? [] : this.cutDuckWindows().map(band);
        this.cutSpeechSpans = this.cutSpeechMs.map(band);
    },

    // ── Analysis state ──────────────────────────────────────────────────

    cutMeasuring() {
        return this.cutAnalysis.state === 'measuring';
    },

    cutMeasuringText() {
        const n = this.cutAnalysis.pending;
        if (!n) return copy('measuringSome');
        return n === 1 ? copy('measuringOne') : copy('measuring', { n });
    },

    cutToolsMissing() {
        return this.cutAnalysis.state === 'missing';
    },

    cutBeatsLabel() {
        if (this.cutToolsMissing()) return copy('toolsMissing');
        return this.cutBeats.length ? copy('beatsEstimated') : copy('beatsNone');
    },

    /** The short line on the Music label: "Beats · estimated", "Not measured", or nothing. */
    cutBeatsShort() {
        if (this.cutToolsMissing()) return copy('laneNotMeasured');
        return this.cutBeats.length ? copy('beatsEstimated') : '';
    },

    // ── Snap to beats ───────────────────────────────────────────────────

    /** Downbeats when measured, else the beats; nothing at all without a measured bed. */
    cutSnapBeats() {
        return this.cutDownbeatsMs.length ? this.cutDownbeatsMs : this.cutBeatsMs;
    },

    cutSnapReady() {
        return this.cutSnapBeats().length > 0;
    },

    cutSnapToggle() {
        if (!this.cutSnapReady() && !this.cutSnap) return;
        this.cutSnap = !this.cutSnap;
        saveSnap(this.cutSnap);
        this.cutAnnounce = `${controlLabel('cut.snap')}: ${this.cutSnap ? 'on' : 'off'}`;
    },

    /** A drag frame's trimmed items, snapped when Snap to beats is on (the drafts lane is never edited). */
    cutSnapped(items, index, edge) {
        if (!this.cutSnap || this.cutDraft || !this.cutSnapReady()) return { items, beat: null };
        return snapTrim(items, index, edge, this.cutSnapBeats());
    },

    // ── Duck under lines (05 §3.5) ──────────────────────────────────────

    /** The depth in dB, or null when ducking is off. */
    cutDuckDb() {
        const depth = this.cutSound?.music?.duck?.depth_db;
        return Number.isFinite(depth) ? depth : null;
    },

    cutDuckText() {
        const db = this.cutDuckDb();
        return db == null ? copy('duckOff') : copy('duckText', { db: `−${Math.abs(db)}` });
    },

    /** Where the music ducks: the server's windows; just after turning it on, the measured lines until the next load. */
    cutDuckWindows() {
        if (this.cutDuckDb() == null) return [];
        return this.cutDucksMs.length ? this.cutDucksMs : this.cutSpeechMs;
    },

    cutDuckLinesText() {
        const n = this.cutSpeechMs.length;
        if (!n) return copy('duckNoLines');
        return n === 1 ? copy('duckLinesOne') : copy('duckLines', { n });
    },

    /** The sound with ducking set (`null` turns it off); a bed with no saved level gets its default level first. */
    cutWithDuck(db) {
        const music = this.cutBeds.music;
        if (!music && !this.cutSound?.music) return this.cutSound;
        const sound = withLevel(this.cutSound, 'music', music, levelOf(this.cutSound, 'music'));
        const duck = db == null ? null : { depth_db: clampLevel(db, DUCK), attack_ms: DUCK.attack_ms, release_ms: DUCK.release_ms };
        return { ...sound, music: { ...sound.music, duck } };
    },

    /** The on/off key: on starts at −10 dB (the default under lines). One undo step. */
    cutDuckToggle() {
        const on = this.cutDuckDb() == null;
        this.cutCommit(on ? 'Duck under lines' : 'No ducking', { sound: this.cutWithDuck(on ? DUCK.default : null) });
        this.cutLayout();
        this._cutPlayer?.levels();
        this.cutAnnounce = this.cutDuckText();
    },

    /** The depth slider: `input` moves the preview, `change` commits one undo step (like the level). */
    cutSetDuck(value, { commit = false } = {}) {
        const sound = this.cutWithDuck(Number(value));
        if (!commit) {
            this._cutDuckBefore ??= this.cutSnapshot();
            this.cutSound = sound;
            this._cutPlayer?.levels();
            return;
        }
        const before = this._cutDuckBefore ?? this.cutSnapshot();
        this._cutDuckBefore = null;
        this.cutCommit('Duck under lines', { sound }, { before });
        this._cutPlayer?.levels();
    },

    cutDuckRange() {
        return DUCK;
    },

    /** "MIRA · 1.2 s" for a dialogue span's label. */
    cutSpeechLabel(span) {
        const who = span.beat_tag ? `${span.beat_tag} · ` : '';
        return `${who}${span.text || fmtLength(span.to_ms - span.from_ms)}`;
    },
};

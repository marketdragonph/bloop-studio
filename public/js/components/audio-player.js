// The audio player: a cockpit instrument instead of the browser's <audio controls> (ported from bloop's
// audio-player.js). A play key, a waveform that is also the seek bar, the time, a live level gauge and a
// VOICE sensor. The file is decoded once, off the playback path, into bar peaks, per-frame loudness and
// per-frame voice; playback streams as usual. If decoding fails the waveform falls back to a flat bar and
// everything still works. Voice detection is energy-based (a detector, not a transcriber).
import { fmtTime, readVolume } from './media-player.js';

const BARS = 80;
const FRAME_S = 0.04;

/** Per 40 ms frame: on when louder than the noise floor, with a short hangover; blips under 3 frames dropped. */
export function detectVoice(rms) {
    const sorted = Array.from(rms).sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.25)] || 0;
    const peak = sorted.at(-1) || 0;
    const threshold = Math.max(floor * 2.2, peak * 0.1, 0.004);
    const voice = new Uint8Array(rms.length);
    let hold = 0;
    for (let f = 0; f < rms.length; f++) {
        if (rms[f] >= threshold) { hold = 4; voice[f] = 1; } else if (hold > 0) { hold--; voice[f] = 1; }
    }
    let runStart = -1;
    for (let f = 0; f <= voice.length; f++) {
        const on = f < voice.length && voice[f];
        if (on && runStart < 0) runStart = f;
        if (!on && runStart >= 0) {
            if (f - runStart < 3) voice.fill(0, runStart, f);
            runStart = -1;
        }
    }
    return voice;
}

const TRACKS_KEPT = 48;
const tracks = new Map(); // src -> Promise of a reduced track
let decoding = Promise.resolve();

const whenIdle = () => new Promise((resolve) => (window.requestIdleCallback ? requestIdleCallback(resolve, { timeout: 1000 }) : setTimeout(resolve, 0)));

async function decodeTrack(src) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`media ${res.status}`);
    const ctx = new AudioContext();
    try {
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        return reduceTrack(mono(buffer), buffer.sampleRate);
    } finally {
        ctx.close().catch(() => {});
    }
}

/**
 * One file's waveform, decoded once per page. A board with many audio cards decodes them one at a time,
 * when the page is idle, instead of fetching and decoding every song at once (which froze the board).
 */
function trackOf(src) {
    if (!tracks.has(src)) {
        const track = decoding.then(whenIdle).then(() => decodeTrack(src));
        decoding = track.catch(() => {});
        track.catch(() => tracks.delete(src));
        tracks.set(src, track);
        if (tracks.size > TRACKS_KEPT) tracks.delete(tracks.keys().next().value);
    }
    return tracks.get(src);
}

/** A decoded track → { peaks (0..1 per bar), barVoice, rms, voice, speechRatio }. The Cut dock asks for more `bars`. */
export function reduceTrack(data, rate, bars = BARS) {
    const frameLen = Math.max(1, Math.round(rate * FRAME_S));
    const frames = Math.ceil(data.length / frameLen);
    const rms = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
        const start = f * frameLen;
        const end = Math.min(data.length, start + frameLen);
        let sum = 0;
        for (let i = start; i < end; i++) sum += data[i] * data[i];
        rms[f] = Math.sqrt(sum / Math.max(1, end - start));
    }
    const voice = detectVoice(rms);
    const per = data.length / bars;
    const peaks = [];
    const barVoice = [];
    let max = 0;
    for (let b = 0; b < bars; b++) {
        const start = Math.floor(b * per);
        const end = Math.min(data.length, Math.floor((b + 1) * per));
        let peak = 0;
        for (let i = start; i < end; i += 4) peak = Math.max(peak, Math.abs(data[i]));
        peaks.push(peak);
        max = Math.max(max, peak);
        const f0 = Math.floor(start / frameLen);
        const f1 = Math.max(f0 + 1, Math.floor(end / frameLen));
        let on = 0;
        for (let f = f0; f < f1; f++) on += voice[f] ? 1 : 0;
        barVoice.push(on >= (f1 - f0) / 2);
    }
    const speech = voice.reduce((n, v) => n + v, 0);
    return { peaks: peaks.map((p) => (max ? p / max : 0)), barVoice, rms, voice, speechRatio: frames ? speech / frames : 0 };
}

export function mono(buffer) {
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    const out = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < out.length; i++) out[i] += ch[i] / buffer.numberOfChannels;
    }
    return out;
}

export default function AudioPlayer() {
    return {
        src: '',
        playing: false,
        current: 0,
        duration: 0,
        muted: false,
        ready: false,
        failed: false,
        peaks: [],
        barVoice: [],
        speechRatio: 0,
        level: 0,
        speaking: false,
        _rms: null,
        _voice: null,
        _peakRms: 1,
        _raf: null,
        _token: 0,

        /** From an x-effect, so a re-rendered card reloads the picture instead of keeping the old one. */
        load(src) {
            if (!src || src === this.src) return;
            this.src = src;
            Object.assign(this, { playing: false, current: 0, duration: 0, ready: false, failed: false, peaks: [], barVoice: [], speechRatio: 0, level: 0, speaking: false });
            this._rms = null;
            this._voice = null;
            this._stop();
            this.$nextTick(() => {
                const { volume, muted } = readVolume();
                if (this.el()) Object.assign(this.el(), { volume, muted });
                this.muted = muted;
            });
            this.analyse(src);
        },

        destroy() {
            this._stop();
        },

        async analyse(src) {
            const token = ++this._token;
            try {
                const track = await trackOf(src);
                if (token !== this._token) return;
                Object.assign(this, { peaks: track.peaks, barVoice: track.barVoice, speechRatio: track.speechRatio, ready: true });
                this._rms = track.rms;
                this._voice = track.voice;
                this._peakRms = Math.max(...track.rms) || 1;
            } catch {
                if (token === this._token) this.failed = true;
            }
        },

        el() {
            return this.$refs.el;
        },

        toggle() {
            const a = this.el();
            if (!a) return;
            if (a.paused) a.play().catch(() => {});
            else a.pause();
        },

        onPlay() { this.playing = true; this._tick(); },
        onPause() { this.playing = false; this._stop(); this.speaking = false; this.level = 0; },

        toggleMute() {
            const a = this.el();
            if (!a) return;
            a.muted = !a.muted;
            this.muted = a.muted;
        },

        seek(e) {
            const a = this.el();
            if (!a || !this.duration) return;
            const r = e.currentTarget.getBoundingClientRect();
            a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.duration;
            this.current = a.currentTime;
        },

        nudge(seconds) {
            const a = this.el();
            if (!a || !this.duration) return;
            a.currentTime = Math.max(0, Math.min(this.duration, a.currentTime + seconds));
            this.current = a.currentTime;
        },

        progress() {
            return this.duration ? (this.current / this.duration) * 100 : 0;
        },

        isPlayed(i) {
            return (i + 0.5) / this.peaks.length <= this.progress() / 100;
        },

        fmt: fmtTime,

        signal() {
            if (!this.playing) return 'Idle';
            return this.speaking ? 'Voice' : 'Quiet';
        },

        /** The gauge: fast attack, slow decay, so a syllable lands as a hit and the bar breathes out after it. */
        _tick() {
            const a = this.el();
            if (!a || !this.playing) return this._stop();
            this.current = a.currentTime;
            if (this._rms) {
                const f = Math.min(this._rms.length - 1, Math.floor(a.currentTime / FRAME_S));
                const target = Math.min(1, this._rms[f] / this._peakRms);
                this.level = target > this.level ? target : this.level * 0.85 + target * 0.15;
                this.speaking = Boolean(this._voice[f]);
            }
            this._raf = requestAnimationFrame(() => this._tick());
        },

        _stop() {
            if (this._raf) cancelAnimationFrame(this._raf);
            this._raf = null;
        },
    };
}

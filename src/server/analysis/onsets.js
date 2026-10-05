// Music onsets, tempo and downbeats from 11 kHz mono PCM (03-director.md §5), and the bed's waveform bars.
// Spectral flux on a 1024-sample window, hop 256 (23 ms), then a tempo from the flux's autocorrelation (60–180
// BPM), a beat grid locked to the strongest phase, each beat pulled to its nearest onset, and downbeats every
// fourth beat on the phase with the most energy. Always an estimate, and labelled so wherever it is shown.
// It yields to the event loop every few thousand frames, so a 10-minute bed never blocks the app.
import { PCM_RATE } from './parse.js';

const WINDOW = 1024;
const HOP = 256;
const YIELD_EVERY = 300; // frames (~7 s of music): the event loop never waits long
const MIN_BPM = 60;
const MAX_BPM = 180;
const PULL_MS = 60; // a grid beat moves to an onset at most this far away
// A steady pulse puts an onset on (nearly) every beat: clicks and drums land 98–100 %, while a beatless pad or tone
// lands 11–19 % (P4 gate). Below this share the grid is a guess, so there are no beats at all ("no steady beat found").
export const MIN_ON_BEAT = 0.5;
export const MAX_BARS = 2000;

const pause = () => new Promise((resolve) => setImmediate(resolve));

/** In-place radix-2 FFT (re, im of length n, a power of two). */
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const angle = (-2 * Math.PI) / len;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const a = i + k;
                const b = a + len / 2;
                const tr = re[b] * cr - im[b] * ci;
                const ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
            }
        }
    }
}

/** Int16 PCM (a Buffer of s16le) → Float32Array -1..1. */
export function samplesOf(buffer) {
    const n = Math.floor(buffer.length / 2);
    const aligned = buffer.byteOffset % 2 === 0 ? buffer : Buffer.from(buffer);
    const pcm = new Int16Array(aligned.buffer, aligned.byteOffset, n); // s16le on a little-endian PC
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = pcm[i] / 32768;
    return out;
}

/** Half-wave rectified spectral flux per hop, normalised 0..1. */
export async function spectralFlux(samples) {
    const frames = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
    const flux = new Float32Array(frames);
    const hann = Float32Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)));
    let previous = new Float32Array(WINDOW / 2);
    const re = new Float32Array(WINDOW);
    const im = new Float32Array(WINDOW);
    for (let f = 0; f < frames; f++) {
        const at = f * HOP;
        for (let i = 0; i < WINDOW; i++) {
            re[i] = samples[at + i] * hann[i];
            im[i] = 0;
        }
        fft(re, im);
        const magnitude = new Float32Array(WINDOW / 2);
        let sum = 0;
        for (let k = 0; k < WINDOW / 2; k++) {
            magnitude[k] = Math.log1p(10 * Math.hypot(re[k], im[k]));
            const rise = magnitude[k] - previous[k];
            if (rise > 0) sum += rise;
        }
        flux[f] = sum;
        previous = magnitude;
        if (f % YIELD_EVERY === YIELD_EVERY - 1) await pause();
    }
    let peak = 1e-9;
    for (let f = 0; f < frames; f++) peak = Math.max(peak, flux[f]);
    for (let f = 0; f < frames; f++) flux[f] /= peak;
    return flux;
}

const frameMs = (f) => Math.round(((f * HOP + WINDOW / 2) / PCM_RATE) * 1000);

/** Local maxima above an adaptive threshold (mean of the last ~0.5 s + a margin), at least 100 ms apart. */
export function pickOnsets(flux) {
    const out = [];
    const span = Math.round((0.5 * PCM_RATE) / HOP);
    const gap = Math.round((0.1 * PCM_RATE) / HOP);
    let last = -Infinity;
    for (let f = 1; f < flux.length - 1; f++) {
        if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue;
        let mean = 0;
        const from = Math.max(0, f - span);
        for (let i = from; i < f; i++) mean += flux[i];
        mean /= Math.max(1, f - from);
        if (flux[f] > mean + 0.08 && flux[f] > 0.1 && f - last >= gap) {
            out.push(f);
            last = f;
        }
    }
    return out;
}

/**
 * Tempo by autocorrelation of the flux, 60–180 BPM. A pulse correlates as well at twice its period as at its own,
 * so each lag is weighted by a log-normal tempo prior around 120 BPM (one octave wide): 60 and 120 score alike,
 * and 120 wins, as a listener would tap it.
 */
export function estimateTempo(flux) {
    const fps = PCM_RATE / HOP;
    const minLag = Math.floor((60 / MAX_BPM) * fps);
    const maxLag = Math.ceil((60 / MIN_BPM) * fps);
    const raw = new Map();
    const corr = (lag) => {
        if (!raw.has(lag)) {
            let sum = 0;
            for (let i = 0; i + lag < flux.length; i++) sum += flux[i] * flux[i + lag];
            raw.set(lag, lag < flux.length ? sum / (flux.length - lag) : 0);
        }
        return raw.get(lag);
    };
    let best = null;
    for (let lag = minLag; lag <= maxLag && lag < flux.length; lag++) {
        const bpm = (60 * fps) / lag;
        const weight = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
        if (!best || corr(lag) * weight > best.score) best = { lag, score: corr(lag) * weight };
    }
    if (!best || best.score <= 0) return null;
    // The true period sits between frames: a parabola through the peak and its neighbours finds it.
    const [a, b, c] = [corr(best.lag - 1), corr(best.lag), corr(best.lag + 1)];
    const shift = a - 2 * b + c < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / (a - 2 * b + c))) : 0;
    const period = best.lag + shift;
    return { lag: best.lag, period, bpm: (60 * fps) / period, score: best.score };
}

/**
 * {bpm, beats_ms, downbeats_ms, onsets_ms} from PCM samples, or nulls when there is no steady pulse.
 * @param {Float32Array} samples 11 kHz mono
 */
export async function analyzeBeats(samples) {
    const flux = await spectralFlux(samples);
    const onsets = pickOnsets(flux);
    const tempo = estimateTempo(flux);
    const onsets_ms = onsets.map(frameMs);
    if (!tempo || onsets.length < 4) return { bpm: null, beats_ms: [], downbeats_ms: [], onsets_ms };
    const { period } = tempo;
    // The first beat: of the onsets in the first two periods, the one the whole grid lines up with best.
    const near = (f) => Math.max(flux[f - 1] ?? 0, flux[f] ?? 0, flux[f + 1] ?? 0);
    let phase = onsets[0];
    let bestPhase = -1;
    for (const start of onsets.filter((o) => o < onsets[0] + 2 * period).slice(0, 8)) {
        let sum = 0;
        for (let f = start; f < flux.length; f += period) sum += near(Math.round(f));
        if (sum > bestPhase) [bestPhase, phase] = [sum, start];
    }
    // Track the pulse: each beat is expected one period after the last; an onset near it becomes the beat, so the
    // grid follows the music instead of drifting off it.
    const pull = Math.max(2, Math.round((PULL_MS / 1000) * (PCM_RATE / HOP)));
    const nearest = (at) => onsets.filter((o) => Math.abs(o - at) <= pull).sort((x, y) => Math.abs(x - at) - Math.abs(y - at))[0];
    const beats = [];
    let onBeat = 0;
    for (let first = nearest(phase), at = first ?? phase, hit = first != null; at < flux.length;) {
        beats.push(Math.round(at));
        if (hit) onBeat++;
        const expected = at + period;
        const found = nearest(expected);
        [at, hit] = [found ?? expected, found != null];
    }
    if (onBeat / Math.max(1, beats.length) < MIN_ON_BEAT) return { bpm: null, beats_ms: [], downbeats_ms: [], onsets_ms };
    let downPhase = 0;
    let downBest = -1;
    for (let p = 0; p < 4; p++) {
        let sum = 0;
        for (let i = p; i < beats.length; i += 4) sum += flux[beats[i]];
        if (sum > downBest) [downBest, downPhase] = [sum, p];
    }
    const beats_ms = beats.map(frameMs);
    return {
        bpm: Math.round(tempo.bpm),
        beats_ms,
        downbeats_ms: beats_ms.filter((_, i) => i % 4 === downPhase),
        onsets_ms,
    };
}

/** Waveform bars (0..100, peak per bar) — at most 2000, about 10 a second. */
export function peaksOf(samples, lengthMs) {
    const count = Math.max(1, Math.min(MAX_BARS, Math.ceil(lengthMs / 100)));
    const per = Math.max(1, Math.floor(samples.length / count));
    const values = [];
    for (let b = 0; b < count; b++) {
        let peak = 0;
        const end = Math.min(samples.length, (b + 1) * per);
        for (let i = b * per; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
        values.push(Math.round(peak * 100));
    }
    return { bars: values.length, ms_per_bar: Math.round(lengthMs / values.length), values };
}

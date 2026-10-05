// The Music lane's waveform. The bed is decoded once per page at a fine grain (FINE_PER_S peaks a second) and drawn
// at the lane's scale: one bar per WAVE_BAR_PX at Fit, more bars as the lanes zoom in (cut-zoom.js), so a zoomed lane
// shows the real sound under each frame instead of a few stretched blocks. Decoded only while the dock is open.
// Spread into CutDock; cutLayout calls cutWaveDraw().
import { BED_DECODE_CAP_MS, WAVE_BAR_PX, wavePath, waveWindow } from '/shared/cut-lanes.js';
import { mono, reduceTrack } from './audio-player.js';

const WAVES = new Map(); // media url → { ms, peaks } at the fine grain (decoded once per bed, per page)
const FINE_PER_S = 100; // 10 ms a peak: 12 px a peak at the deepest zoom
const FINE_MAX = 30_000;
const MIN_BARS = 24;

/** `peaks` down to `bars` (each the loudest of its share), or as they are when there are fewer. */
export function resamplePeaks(peaks, bars) {
    if (bars >= peaks.length) return Array.from(peaks);
    const out = new Array(bars);
    const per = peaks.length / bars;
    for (let b = 0; b < bars; b++) {
        let top = 0;
        for (let i = Math.floor(b * per), end = Math.min(peaks.length, Math.floor((b + 1) * per) || 1); i < end; i++) top = Math.max(top, peaks[i]);
        out[b] = top;
    }
    return out;
}

/** How many bars the lane draws for a bed at this scale. */
export const barsAt = (bedMs, pxPerSec, fine) => Math.min(fine, Math.max(MIN_BARS, Math.round((bedMs / 1000) * pxPerSec / WAVE_BAR_PX)));

export const cutWaveMethods = {
    cutWave: '',
    cutWaveBars: 0,

    async cutLoadWave() {
        const bed = this.cutBeds.music;
        if (!bed?.media_url || this.cutBedMs(bed) > BED_DECODE_CAP_MS) { this.cutWave = ''; return; }
        if (!WAVES.has(bed.media_url)) {
            try {
                const res = await fetch(bed.media_url);
                if (!res.ok) throw new Error(`media ${res.status}`);
                const ctx = new AudioContext();
                let buffer;
                try { buffer = await ctx.decodeAudioData(await res.arrayBuffer()); } finally { ctx.close().catch(() => {}); }
                const ms = Math.round(buffer.duration * 1000);
                const fine = Math.max(MIN_BARS, Math.min(FINE_MAX, Math.round((ms / 1000) * FINE_PER_S)));
                WAVES.set(bed.media_url, { ms, peaks: reduceTrack(mono(buffer), buffer.sampleRate, fine).peaks });
            } catch {
                this.cutWave = '';
                return;
            }
        }
        const current = this.cutBeds.music;
        if (current?.media_url !== bed.media_url) return; // the bed changed while decoding
        const wave = WAVES.get(bed.media_url);
        // Not measured on the server yet: the decoded length places the bed (display only).
        if (!(Number(current.seconds) > 0) && wave.ms > 0) {
            this.cutBeds = { ...this.cutBeds, music: { ...current, seconds: wave.ms / 1000 } };
            this.cutLayout(); // draws the wave too
            return;
        }
        this.cutWaveDraw(true);
    },

    /** The path at the lane's scale; redrawn only when the bar count moves by a quarter (a zoom), or `force`. */
    cutWaveDraw(force = false) {
        const bed = this.cutBeds?.music;
        const wave = bed?.media_url ? WAVES.get(bed.media_url) : null;
        if (!wave) return;
        const bars = barsAt(this.cutBedMs(bed), this.cutPps || 0, wave.peaks.length);
        const was = this._cutWaveKey;
        if (!force && was?.url === bed.media_url && bars > was.bars * 0.8 && bars < was.bars * 1.25) return;
        this._cutWaveKey = { url: bed.media_url, bars };
        this.cutWaveBars = bars;
        this.cutWave = wavePath(resamplePeaks(wave.peaks, bars));
    },

    cutWaveBox(segment) {
        return waveWindow(segment, this.cutBedMs(this.cutBeds.music), this.cutWaveBars || 1);
    },
};

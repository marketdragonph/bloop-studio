// Music and voice under the Cut's preview (02-dock.md §7), spread into CutPlayer. One <audio> each, placed in
// EXPORT time by the shared map (cut-timeline.js), so a slate holds the bed still and "As exported" plays
// exactly what the file will hold. Four times a second (and on play, pause, seek and level changes) each bed
// is checked: more than 150 ms off its expected time and it is put back. A bed plays once, never loops.
// Level: the saved gain in dB (05 §3.5 Music level), then the 1.5 s fade at the end, times the deck volume.
// P4: the music ducks under spoken lines on the same envelope the export uses (cut-sound.js duckGain), sampled
// every 50 ms while ducks exist (cpDuckStep), so a 120 ms attack is heard, not stepped at 250 ms.
// Above 0 dB needs gain past 1, so the beds go through a Web Audio gain node once a press has unlocked audio.
import { levelOf } from '/shared/cut-edit.js';
import { bedGain, bedTime, bedWindow, drifted, fadeStart } from '/shared/cut-timeline.js';
import { duckGain } from '/shared/cut-sound.js';

const NODES = new WeakMap(); // <audio> → { ctx, gain }: a media element can be routed through Web Audio only once

export const cutBedSyncMethods = {
    /** The beds as they play now: element, source, start (export ms), length and level. */
    cpBedList() {
        const total = this.cutLay().export_ms;
        const voiceStart = Number(this.cutSound?.voice?.start_ms) || 0;
        return [
            { kind: 'music', el: this.$refs.cutMusicEl, bed: this.cutBeds.music, start: 0 },
            { kind: 'voice', el: this.$refs.cutVoiceEl, bed: this.cutBeds.voice, start: voiceStart },
        ].map((b) => {
            const measured = Number(b.bed?.seconds) * 1000;
            const loaded = Number.isFinite(b.el?.duration) ? b.el.duration * 1000 : 0;
            const ms = measured > 0 ? measured : loaded || total;
            return { ...b, ms, window: bedWindow(b.start, ms, total), fadeFrom: b.kind === 'music' ? fadeStart(total, ms) : Infinity };
        });
    },

    /** Puts each bed where the cut's clock says it should be (`force` seeks even when within 150 ms). */
    cpBeds(force = false) {
        const exportMs = this.cpExportTime();
        const silent = this.cpSilent();
        for (const b of this.cpBedList()) {
            const el = b.el;
            if (!el) continue;
            const url = b.bed?.media_url ?? '';
            if (!url) {
                if (!el.paused) el.pause();
                continue;
            }
            if (el.dataset.src !== url) {
                el.src = url;
                el.dataset.src = url;
            }
            this.cpBedLevel(el, this.cpBedGain(b, exportMs));
            const expected = bedTime(b.window, exportMs);
            if (expected == null || silent) {
                if (!el.paused) el.pause();
                if (expected != null && force) this.cpBedSeek(el, expected);
                continue;
            }
            if (force || drifted(el.currentTime * 1000, expected)) this.cpBedSeek(el, expected);
            if (el.paused) el.play().catch(() => {});
        }
    },

    /** The bed's level at an export time: saved gain, the end fade and, for music, the duck under lines. */
    cpBedGain(b, exportMs) {
        const gain = bedGain({ gainDb: levelOf(this.cutSound, b.kind), fadeFromMs: b.fadeFrom }, exportMs);
        if (b.kind !== 'music') return gain;
        const depth = this.cutDuckDb?.();
        return depth == null ? gain : gain * duckGain(this.cutDuckWindows(), depth, exportMs);
    },

    /** Between the 250 ms bed checks: only the music's level, only while there are ducks. */
    cpDuckStep() {
        if (this.cutDuckDb?.() == null || !this.cutDuckWindows().length) return;
        const music = this.cpBedList()[0];
        if (music.el && !music.el.paused) this.cpBedLevel(music.el, this.cpBedGain(music, this.cpExportTime()));
    },

    cpBedSeek(el, ms) {
        try { el.currentTime = ms / 1000; } catch { /* not seekable until metadata loads; the next check retries */ }
    },

    /** Linear gain × the deck's volume; through Web Audio when unlocked, else clamped to the element's 0..1. */
    cpBedLevel(el, gain) {
        const master = this.muted ? 0 : this.volume;
        const node = NODES.get(el);
        if (node) {
            el.volume = 1;
            node.gain.gain.value = gain * master;
        } else {
            el.volume = Math.max(0, Math.min(1, gain * master));
        }
    },

    /** On the person's Play press (a user gesture): routes each bed through a gain node so +dB works. */
    cpBedsUnlock() {
        if (typeof AudioContext === 'undefined') return;
        for (const el of [this.$refs.cutMusicEl, this.$refs.cutVoiceEl]) {
            if (!el || NODES.has(el)) continue;
            try {
                const ctx = new AudioContext();
                const gain = ctx.createGain();
                ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
                NODES.set(el, { ctx, gain });
            } catch {
                /* no Web Audio: the element volume (0..1) still follows the level */
            }
        }
        for (const el of [this.$refs.cutMusicEl, this.$refs.cutVoiceEl]) NODES.get(el)?.ctx.resume().catch(() => {});
    },

    cpBedsDestroy() {
        for (const el of [this.$refs.cutMusicEl, this.$refs.cutVoiceEl]) {
            if (!el) continue;
            el.pause();
            el.removeAttribute('src');
            NODES.get(el)?.ctx.close().catch(() => {});
            NODES.delete(el);
        }
    },
};

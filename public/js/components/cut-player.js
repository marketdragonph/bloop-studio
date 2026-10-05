// The Cut's preview (02-dock.md §7): CutPlayer, nested in CutDock's scope (preview.edge), built on the
// MediaPlayer transport (the same deck markup, volume memory and keys). It plays the dock's ONE time map
// (cut-timeline.js on cut-clock.js), so the playhead, the counter and the lanes never disagree.
// - Two stacked <video>s, A and B: B loads the next clip at its in point while A plays.
// - Out points are caught with requestVideoFrameCallback where the browser has it (else every frame), so a
//   swap lands within a frame. A dissolve fades B in over A; reduced motion makes it a hard cut at the middle.
// - A gap plays a slate for its planned length on a rAF clock ("As exported" hides gaps). A clip that will
//   not load is skipped and named. Music and voice follow in cut-bed-sync.js.
// It lives only while the dock is open (x-if): folding removes both videos and both beds.
import { copy } from '/shared/katana-controls.js';
import { fmtClock } from '/shared/cut-lanes.js';
import { entryAt, entryKey, nextClip, nextShown, toExport, toScreen } from '/shared/cut-timeline.js';
import MediaPlayer, { readVolume } from './media-player.js';
import { cutBedSyncMethods } from './cut-bed-sync.js';

const UI_MS = 100; // the counter and the deck update at 10 Hz; the playhead every frame
const BED_MS = 250; // beds are checked for drift 4 times a second
const DUCK_MS = 50; // the music's duck envelope is sampled 20 times a second (01-core.md §5)
const LEAD_RAF_MS = 16;
const GUARD_MS = 200;
const LEAD_FRAME_MS = 34; // one frame early at 30 fps, so the next clip shows on time

const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const tenths = (ms) => {
    const t = Math.max(0, Math.round(ms / 100));
    const s = Math.floor(t / 10);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${t % 10}`;
};

export default function CutPlayer() {
    // Per-instance clock state, outside Alpine: written every frame, read by nothing reactive.
    const s = { t: 0, cur: -1, mode: 'idle', slateFrom: 0, raf: 0, guard: 0, lastStep: 0, lastUi: 0, lastBed: 0, token: 0, sig: '' };

    return {
        ...MediaPlayer(),
        front: 'a',
        incoming: null, // 'a' | 'b' while a dissolve fades it in
        slate: null, // { title, text } while a gap plays
        nowKey: null, // the lane key of the entry on screen: the tag over the picture names it (P5)

        init() {
            Object.assign(this, readVolume());
            this.watchFull();
            this._cutPlayer = {
                toggle: () => this.togglePlay(),
                seek: (ms) => this.cpSeek(ms),
                time: () => s.t,
                playing: () => this.playing,
                refresh: () => this.cpRefresh(),
                exportTime: () => toExport(this.cutLay(), s.t),
                seekExport: (ms) => this.cpSeek(toScreen(this.cutLay(), ms)),
                levels: () => this.cpBeds(true),
                playhead: () => this.cpUi(true), // a zoom moved the scale (cut-zoom.js)
            };
            this.$nextTick(() => {
                this.cpRefresh(true);
                if (this._cutPlayOnOpen) {
                    this._cutPlayOnOpen = false;
                    this.togglePlay();
                }
            });
        },

        destroy() {
            this.cpStop();
            for (const v of [this.cpVid('a'), this.cpVid('b')]) v?.removeAttribute('src');
            this.cpBedsDestroy();
            this.unwatchFull();
            this._cutPlayer = null;
        },

        // ── Elements ────────────────────────────────────────────────────────

        cpVid(which) {
            return which === 'a' ? this.$refs.cutVidA : this.$refs.cutVidB;
        },

        cpFront() {
            return this.cpVid(this.front);
        },

        cpBack() {
            return this.cpVid(this.front === 'a' ? 'b' : 'a');
        },

        vid() {
            return this.cpFront();
        },

        cpEntries() {
            return this.cutLay().entries;
        },

        /** Loads a clip into a video at `offsetMs` past its in point (paused). */
        cpPrime(video, index, offsetMs = 0) {
            const entry = this.cpEntries()[index];
            if (!video || !entry?.src) return;
            if (video.dataset.src !== entry.src) {
                video.src = entry.src;
                video.dataset.src = entry.src;
            }
            video.dataset.index = String(index);
            this.cutFrameVideo?.(video, entry); // P6: the preview's shape and crop (cut-shape.js)
            const at = (entry.in_ms + offsetMs) / 1000;
            const seek = () => { try { video.currentTime = at; } catch { /* not seekable yet */ } };
            if (video.readyState >= 1) seek();
            else video.addEventListener('loadedmetadata', seek, { once: true });
            this.cpVolume(video, entry);
        },

        cpVolume(video, entry, share = 1) {
            if (!video) return;
            video.muted = this.muted || entry?.sound === false;
            video.volume = Math.max(0, Math.min(1, this.volume * share));
        },

        // ── Position ────────────────────────────────────────────────────────

        /** Rebuilds after an edit or a reload, only when what plays changed (a take landing elsewhere does not stutter it). */
        cpRefresh(force = false) {
            const lay = this.cutLay();
            const sig = lay.entries.map((e) => `${e.kind}${e.hidden ? 'h' : ''}${e.src ?? ''}${e.in_ms ?? ''}-${e.out_ms ?? ''}@${e.start_ms}-${e.end_ms}${e.sound ? 's' : ''}`).join('|');
            if (!force && sig === s.sig) return;
            s.sig = sig;
            this.cpSeek(s.t);
        },

        cpSeek(ms) {
            const lay = this.cutLay();
            s.t = Math.max(0, Math.min(lay.total_ms, Number(ms) || 0));
            const index = entryAt(lay, s.t);
            if (index < 0) {
                this.cpShowNothing();
            } else {
                this.cpShow(index, s.t - lay.entries[index].start_ms);
                if (this.playing) this.cpStart();
            }
            this.cpUi(true);
            this.cpBeds(true);
        },

        cpShowNothing() {
            s.cur = -1;
            this.nowKey = null;
            s.mode = 'idle';
            this.slate = null;
            this.incoming = null;
            this.cpFront()?.pause();
            this.cpBack()?.pause();
            if (this.playing) this.cpPause();
        },

        /** Puts entry `index` on screen at `offsetMs` into it, and loads the next clip on the hidden video. */
        cpShow(index, offsetMs) {
            const entry = this.cpEntries()[index];
            s.cur = index;
            this.cpNow(entry);
            this.incoming = null;
            this.cpBack()?.pause();
            if (entry.kind === 'gap' || this.cutUnplayable.includes(entryKey(entry))) {
                s.mode = 'slate';
                s.slateFrom = performance.now() - offsetMs;
                this.cpFront()?.pause();
                this.slate = { title: entry.slot?.label ?? '', text: entry.kind === 'gap' ? copy('slate') : copy('unplayable') };
            } else {
                s.mode = 'clip';
                this.slate = null;
                this.cpPrime(this.cpFront(), index, offsetMs);
            }
            const next = nextClip(this.cutLay(), index);
            if (next >= 0) this.cpPrime(this.cpBack(), next, 0);
        },

        // ── Transport ───────────────────────────────────────────────────────

        togglePlay() {
            if (this.playing) return this.cpPause();
            const lay = this.cutLay();
            if (!lay.total_ms) return;
            if (s.t >= lay.total_ms - 1 || s.cur < 0) this.cpSeek(0);
            this.playing = true;
            this.cpBedsUnlock();
            this.cpStart();
            this.cpBeds(true);
        },

        cpStart() {
            if (s.mode === 'clip') {
                const video = this.cpFront();
                video?.play().catch(() => {});
                this.cpWatch(video);
            } else if (s.mode === 'slate') {
                s.slateFrom = performance.now() - (s.t - (this.cpEntries()[s.cur]?.start_ms ?? 0));
            }
            if (!s.raf) s.raf = requestAnimationFrame(() => this.cpTick());
            // rAF stops while the window is hidden; this keeps slates, swaps and beds on time anyway.
            if (!s.guard) s.guard = setInterval(() => { if (performance.now() - s.lastStep > GUARD_MS) this.cpStep(); }, GUARD_MS);
        },

        cpPause() {
            this.playing = false;
            this.cpFront()?.pause();
            this.cpBack()?.pause();
            if (this.incoming) this.cpFinishDissolve();
            this.cpStop();
            this.cpUi(true);
            this.cpBeds(true);
        },

        cpStop() {
            if (s.raf) cancelAnimationFrame(s.raf);
            clearInterval(s.guard);
            s.raf = 0;
            s.guard = 0;
            s.token++;
        },

        cpTick() {
            s.raf = 0;
            if (!this.playing) return;
            this.cpStep();
            if (this.playing) s.raf = requestAnimationFrame(() => this.cpTick());
        },

        /** One step of the clock: out points, the playhead, and (4 times a second) the beds. */
        cpStep() {
            s.lastStep = performance.now();
            if (!this.playing) return;
            this.cpCheck(this.cpClock(), LEAD_RAF_MS);
            this.cpUi();
            const now = performance.now();
            if (now - s.lastBed >= BED_MS) {
                s.lastBed = now;
                this.cpBeds();
            } else if (now - (s.lastDuck ?? 0) >= DUCK_MS) {
                s.lastDuck = now;
                this.cpDuckStep(); // cut-bed-sync.js: the duck envelope at 20 Hz
            }
        },

        /** The master clock: the playing video's time through the map, or the rAF clock during a slate. */
        cpClock() {
            const entry = this.cpEntries()[s.cur];
            if (!entry) return s.t;
            if (s.mode === 'slate') s.t = entry.start_ms + (performance.now() - s.slateFrom);
            else {
                const video = this.cpFront();
                if (video && video.readyState >= 1 && !video.seeking) s.t = entry.start_ms + (video.currentTime * 1000 - entry.in_ms);
            }
            return s.t;
        },

        /** Out points by video frame where the browser can say when each frame shows. */
        cpWatch(video) {
            const token = ++s.token;
            if (!video || typeof video.requestVideoFrameCallback !== 'function') return;
            const onFrame = (now, meta) => {
                if (token !== s.token || !this.playing || s.mode !== 'clip' || video !== this.cpFront()) return;
                const entry = this.cpEntries()[s.cur];
                if (entry && !video.seeking) {
                    s.t = entry.start_ms + (meta.mediaTime * 1000 - entry.in_ms);
                    this.cpCheck(s.t, LEAD_FRAME_MS);
                }
                if (token === s.token) video.requestVideoFrameCallback(onFrame);
            };
            video.requestVideoFrameCallback(onFrame);
        },

        cpCheck(t, lead) {
            const lay = this.cutLay();
            const entry = lay.entries[s.cur];
            if (!entry) return;
            const nextIndex = nextShown(lay, s.cur);
            const next = nextIndex >= 0 ? lay.entries[nextIndex] : null;
            if (s.mode === 'slate') {
                // A gap holds for its planned length; a clip that would not play is skipped at once.
                if (t >= entry.end_ms || entry.kind === 'clip') this.cpAdvance(nextIndex, 0);
                return;
            }
            const overlap = next?.kind === 'clip' ? next.overlap_ms ?? 0 : 0;
            if (overlap > 0 && reduced()) {
                if (t + lead >= entry.end_ms - overlap / 2) this.cpAdvance(nextIndex, overlap / 2);
                return;
            }
            if (overlap > 0) {
                if (!this.incoming && t + lead >= next.start_ms) this.cpBeginDissolve(nextIndex, overlap);
                if (this.incoming) {
                    const p = Math.max(0, Math.min(1, (t - next.start_ms) / overlap));
                    this.cpVolume(this.cpFront(), entry, 1 - p);
                    this.cpVolume(this.cpVid(this.incoming), next, p);
                }
                if (t + lead >= entry.end_ms) this.cpFinishDissolve();
                return;
            }
            if (t + lead >= entry.end_ms) this.cpAdvance(nextIndex, 0);
        },

        /** The incoming clip starts under the outgoing one and fades in over the overlap. */
        cpBeginDissolve(index, overlap) {
            const back = this.cpBack();
            if (Number(back?.dataset.index) !== index) this.cpPrime(back, index, 0);
            this.$refs.cutScreen?.style.setProperty('--cut-dissolve', `${overlap}ms`);
            back?.play().catch(() => {});
            this.incoming = this.front === 'a' ? 'b' : 'a';
        },

        cpFinishDissolve() {
            if (!this.incoming) return;
            const old = this.cpFront();
            const nextIndex = Number(this.cpVid(this.incoming)?.dataset.index);
            this.front = this.incoming;
            this.incoming = null;
            old?.pause();
            s.cur = nextIndex;
            s.mode = 'clip';
            this.cpVolume(this.cpFront(), this.cpEntries()[nextIndex]);
            if (this.playing) this.cpWatch(this.cpFront());
            const after = nextClip(this.cutLay(), nextIndex);
            if (after >= 0) this.cpPrime(old, after, 0);
        },

        /** Hard cut to entry `index` (`offsetMs` into it): the hidden video is already there when it was loaded early. */
        cpAdvance(index, offsetMs) {
            const lay = this.cutLay();
            if (index < 0) {
                s.t = lay.total_ms;
                this.cpPause();
                return;
            }
            const entry = lay.entries[index];
            const back = this.cpBack();
            const ready = entry.kind === 'clip' && Number(back?.dataset.index) === index && !this.cutUnplayable.includes(entryKey(entry));
            if (!ready) {
                s.t = entry.start_ms + offsetMs;
                this.cpShow(index, offsetMs);
                if (this.playing) this.cpStart();
                return;
            }
            if (offsetMs) back.currentTime = (entry.in_ms + offsetMs) / 1000;
            const old = this.cpFront();
            this.front = this.front === 'a' ? 'b' : 'a';
            this.slate = null;
            s.cur = index;
            this.cpNow(entry);
            s.mode = 'clip';
            s.t = entry.start_ms + offsetMs;
            this.cpVolume(back, entry);
            if (this.playing) back.play().catch(() => {});
            old?.pause();
            if (this.playing) this.cpWatch(back);
            const after = nextClip(lay, index);
            if (after >= 0) this.cpPrime(old, after, 0);
        },

        /** The entry on screen changed: one reactive write, only when it is a different clip or gap. */
        cpNow(entry) {
            const key = entry ? entryKey(entry) : null;
            if (key !== this.nowKey) this.nowKey = key;
        },

        /** The tag over the picture: the clip on screen (playing or paused), else the selected clip. */
        cpTag() {
            const now = this.nowKey != null && this.cutItems.find((item) => item.key === this.nowKey);
            return now?.title ?? this.cutSelected()?.title ?? '';
        },

        /** A clip that will not load: named on its lane, skipped by the preview (02-dock.md §5). */
        cpFailed(which) {
            const video = this.cpVid(which);
            const index = Number(video?.dataset.index);
            const entry = this.cpEntries()[index];
            if (!entry || entry.kind !== 'clip') return;
            const key = entryKey(entry);
            if (!this.cutUnplayable.includes(key)) this.cutUnplayable = [...this.cutUnplayable, key];
            this.cutAnnounce = `${entry.slot?.label ?? 'A clip'}: ${copy('unplayable')}`;
            if (index === s.cur && s.mode === 'clip') this.cpAdvance(nextShown(this.cutLay(), index), 0);
        },

        cpEnded(which) {
            if (this.playing && which === this.front && !this.incoming) this.cpAdvance(nextShown(this.cutLay(), s.cur), 0);
        },

        // ── Screen: playhead (one CSS variable), counter and deck at 10 Hz ──

        cpUi(force = false) {
            const lay = this.cutLay();
            this.cutPreviewTick?.(toExport(lay, s.t)); // P6: captions and the soft-bars backdrop (cut-shape.js)
            const x = (s.t / 1000) * (this.cutPps || 0);
            this.cutPart('playhead')?.style.setProperty('--cut-x', `${x}px`);
            const now = performance.now();
            if (!force && now - s.lastUi < UI_MS) return;
            s.lastUi = now;
            const cap = this.cutPart('cap');
            if (cap) cap.textContent = fmtClock(s.t);
            this.current = s.t / 1000;
            this.duration = lay.total_ms / 1000;
            const scroll = this.cutPart('scroll');
            if (this.playing && scroll && (x > scroll.scrollLeft + scroll.clientWidth - 24 || x < scroll.scrollLeft)) scroll.scrollLeft = Math.max(0, x - 24);
        },

        /** "0:19.4 / 0:47 as exported" or "0:19.4 / 0:55 with gaps": the total always names its mode. */
        cpCounter() {
            const lay = this.cutLay();
            const gaps = lay.entries.some((e) => e.kind === 'gap' && !e.hidden);
            const total = fmtClock(lay.total_ms);
            return `${tenths(this.current * 1000)} / ${gaps ? copy('withGapsTotal', { total }) : copy('asExported', { total })}`;
        },

        // ── MediaPlayer overrides: the deck drives the cut, not one file ──

        seekTo(ratio) {
            this.cpSeek(Math.max(0, Math.min(1, ratio)) * this.cutLay().total_ms);
        },

        nudge(seconds) {
            this.cpSeek(s.t + seconds * 1000);
        },

        applyVolume() {
            const entries = this.cpEntries();
            for (const which of ['a', 'b']) {
                const video = this.cpVid(which);
                this.cpVolume(video, entries[Number(video?.dataset.index)]);
            }
            this.cpBeds(true);
        },

        /** The stage goes full screen (the picture keeps the export's shape, as big as the screen); again, or Esc, exits. */
        fullscreen() {
            if (this.fullOn) document.exitFullscreen?.().catch(() => {});
            else this.$refs.cutStage?.requestFullscreen?.().catch(() => {});
        },

        /** The bed sync reads the clock through these. */
        cpExportTime() {
            return toExport(this.cutLay(), s.t);
        },

        /** Beds hold still while paused and while a slate plays (they live in export time). */
        cpSilent() {
            return !this.playing || s.mode !== 'clip';
        },

        ...cutBedSyncMethods,
    };
}

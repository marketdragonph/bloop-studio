// The video deck: the transport under every clip the app plays (ported from bloop's MediaPlayer.js).
// Play, a scrubber, the time, a volume level and fullscreen, in the hangar's own keys instead of the
// browser's control bar. One volume for every player, remembered across sessions.
// Keys on the scrubber: ← → seek 5 s, ↑ ↓ volume, space play, m mute, f fullscreen.
const STORE_KEY = 'bloop-studio:media-volume';

export function readVolume() {
    try {
        const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        if (v && typeof v.volume === 'number') return { volume: Math.min(1, Math.max(0, v.volume)), muted: Boolean(v.muted) };
    } catch {
        /* storage unavailable: the default is fine */
    }
    return { volume: 1, muted: false };
}

export function saveVolume(volume, muted) {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ volume, muted }));
    } catch {
        /* see readVolume */
    }
}

export const fmtTime = (s) => {
    if (!Number.isFinite(s)) return '0:00';
    const sec = Math.floor(s % 60);
    return `${Math.floor(s / 60)}:${sec < 10 ? '0' : ''}${sec}`;
};

/** @param {{ fullscreen?: (video: HTMLVideoElement) => void }} options  the surface's bigger picture (the viewer). */
export default function MediaPlayer(options = {}) {
    return {
        playing: false,
        current: 0,
        duration: 0,
        buffered: 0,
        volume: 1,
        muted: false,
        scrubbing: false,
        _src: '',
        _raf: null,
        _drag: null,

        init() {
            Object.assign(this, readVolume());
            this.$nextTick(() => this.applyVolume());
        },

        destroy() {
            this._stopTick();
            this._endDrag();
        },

        vid() {
            return this.$refs.vid;
        },

        /** From an x-effect: a re-rendered card swaps the URL and must not keep the old clip's position. */
        attach(src) {
            if (!src || src === this._src) return;
            this._src = src;
            Object.assign(this, { playing: false, current: 0, duration: 0, buffered: 0 });
            this._stopTick();
            this.$nextTick(() => this.applyVolume());
        },

        togglePlay() {
            const v = this.vid();
            if (!v) return;
            if (v.paused) v.play().catch(() => {});
            else v.pause();
        },

        onPlay() { this.playing = true; this._tick(); },
        onPause() { this.playing = false; this._stopTick(); this._sync(); },

        _sync() {
            const v = this.vid();
            if (!v) return;
            this.current = v.currentTime || 0;
            if (v.duration && Number.isFinite(v.duration)) this.duration = v.duration;
            try {
                const b = v.buffered;
                this.buffered = b.length && this.duration ? Math.min(1, b.end(b.length - 1) / this.duration) : 0;
            } catch {
                this.buffered = 0;
            }
        },

        _tick() {
            if (!this.playing || !this.vid()?.isConnected) return this._stopTick();
            this._sync();
            this._raf = requestAnimationFrame(() => this._tick());
        },

        _stopTick() {
            if (this._raf) cancelAnimationFrame(this._raf);
            this._raf = null;
        },

        progress() {
            return this.duration ? (this.current / this.duration) * 100 : 0;
        },

        seekTo(ratio) {
            const v = this.vid();
            if (!v || !this.duration) return;
            v.currentTime = Math.max(0, Math.min(1, ratio)) * this.duration;
            this._sync();
        },

        nudge(seconds) {
            const v = this.vid();
            if (!v || !this.duration) return;
            v.currentTime = Math.max(0, Math.min(this.duration, v.currentTime + seconds));
            this._sync();
        },

        fmt: fmtTime,

        applyVolume() {
            const v = this.vid();
            if (!v) return;
            v.volume = this.volume;
            v.muted = this.muted;
        },

        setVolume(level) {
            this.volume = Math.max(0, Math.min(1, level));
            this.muted = this.volume === 0;
            this.applyVolume();
            saveVolume(this.volume, this.muted);
        },

        toggleMute() {
            this.muted = !this.muted;
            if (!this.muted && this.volume === 0) this.volume = 0.5;
            this.applyVolume();
            saveVolume(this.volume, this.muted);
        },

        /** Reads back from the element, so a media key or another control lands on the deck too. */
        onVolumeChange() {
            const v = this.vid();
            if (!v) return;
            this.volume = v.volume;
            this.muted = v.muted;
        },

        volumeIcon() {
            return this.muted || this.volume === 0 ? 'mute' : 'volume';
        },

        shownVolume() {
            return this.muted ? 0 : this.volume;
        },

        volumeWheel(e) {
            this.setVolume(this.volume + (e.deltaY < 0 ? 0.05 : -0.05));
        },

        _ratio(e, el) {
            const r = el.getBoundingClientRect();
            return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        },

        scrubStart(e) {
            if (e.button !== 0) return;
            const el = e.currentTarget;
            this.scrubbing = true;
            this.seekTo(this._ratio(e, el));
            this._beginDrag((ev) => this.seekTo(this._ratio(ev, el)), () => { this.scrubbing = false; });
        },

        volumeStart(e) {
            if (e.button !== 0) return;
            const el = e.currentTarget;
            this.setVolume(this._ratio(e, el));
            this._beginDrag((ev) => this.setVolume(this._ratio(ev, el)));
        },

        _beginDrag(onMove, onEnd) {
            this._endDrag();
            const move = (ev) => onMove(ev);
            const up = () => { this._endDrag(); onEnd?.(); };
            this._drag = { move, up };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        },

        _endDrag() {
            if (!this._drag) return;
            window.removeEventListener('pointermove', this._drag.move);
            window.removeEventListener('pointerup', this._drag.up);
            this._drag = null;
        },

        /** Paused first: a viewer opening over a playing clip would leave its sound running behind it. */
        fullscreen() {
            const video = this.vid();
            if (options.fullscreen) video?.pause();
            options.fullscreen?.(video);
        },

        key(e) {
            const map = {
                ' ': () => this.togglePlay(),
                ArrowLeft: () => this.nudge(-5),
                ArrowRight: () => this.nudge(5),
                ArrowUp: () => this.setVolume(this.volume + 0.1),
                ArrowDown: () => this.setVolume(this.volume - 0.1),
                m: () => this.toggleMute(),
                f: () => this.fullscreen(),
            };
            const fn = map[e.key];
            if (!fn) return;
            e.preventDefault();
            fn();
        },
    };
}

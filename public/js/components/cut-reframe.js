// CutReframe: the orange crop box over the selected clip (Mini Katana P6, 05-irresistible.md §5.4), nested in the
// preview's screen (CutDock → CutPlayer → here). The whole clip shows; what the shape cuts away is greyed.
// - Drag the box to move it; drag its corner, pinch (two fingers) or turn the wheel to zoom 1× to 3×.
// - Keys on the focused box: arrows move 2 % (Shift: 10 %), Home centres at 1×, + and − zoom, Enter or Escape close.
// - A drag or a pinch is ONE undo step, committed on release; each key press is one. Nothing is saved mid-drag:
//   the box follows the pointer locally, then CutDock.cutSetFrame commits (cut-shape.js).
// The maths is cut-frame-edit.js on cut-frame.js, the crop the export uses. The Director never moves a box.
import { copy } from '/shared/katana-controls.js';
import { boxVars, centreFrame, frameText, moveFrame, nudgeFrame, zoomFrame } from '/shared/cut-frame-edit.js';

const BIG_STEP = 5; // Shift+arrow = 5 nudges (10 %)
const WHEEL_COMMIT_MS = 300; // a run of wheel turns is one undo step

export default function CutReframe() {
    // Gesture state outside Alpine: written on every pointer move, read by nothing reactive.
    const g = { pointers: new Map(), start: null, mode: null, rect: null, frame0: null, dist0: 0, wheel: 0 };

    return {
        crLive: null, // the frame while a gesture runs; null = the saved one

        init() {
            // A new selection moves the box to that clip; pressing Play closes the box (the preview moves on).
            this.$watch('cutSelectedKey', () => { if (this.cutCropping()) this.cutCropFollow(); });
            this.$watch('playing', (on) => { if (on && this.cutCropOn) this.cutCropClose(); });
            // Crop was just pressed: the box takes focus once it can show (the clip's size is known).
            this.$watch('cutCropSource', (size) => {
                if (!size || !this._cutCropFocus) return;
                this._cutCropFocus = false;
                this.$nextTick(() => this.$el.querySelector('.cut-crop__box')?.focus({ preventScroll: true }));
            });
        },

        crFrame() {
            return this.crLive ?? this.cutCropFrame();
        },

        crSource() {
            const s = this.cutCropSource;
            return s?.width > 0 && s?.height > 0 ? s : null;
        },

        /** The box's place as CSS custom properties (fractions of the whole clip). */
        crVars() {
            const source = this.crSource();
            return source ? boxVars(source, this.cutShapeNow(), this.crFrame()) : {};
        },

        crLabel() {
            const item = this.cutCropItem();
            return copy('cropBox', { title: item?.title ?? '', shape: this.cutShapeNow(), where: frameText(this.crFrame()) });
        },

        /** The clip is already this shape: nothing to move (it still zooms). */
        crNoRoom() {
            const s = this.crSource();
            if (!s) return false;
            const ratio = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }[this.cutShapeNow()];
            return Math.abs(s.width / s.height / ratio - 1) < 0.01;
        },

        // ── Pointer: drag, corner zoom, pinch ────────────────────────────

        crDown(event, mode = 'move') {
            if (!this.crSource() || (event.button != null && event.button !== 0 && event.pointerType === 'mouse')) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            g.rect = this.$el.getBoundingClientRect();
            g.frame0 = this.crFrame();
            g.mode = g.pointers.size === 2 ? 'pinch' : mode;
            g.start = { x: event.clientX, y: event.clientY };
            g.dist0 = g.pointers.size === 2 ? this.crSpread() : 0;
            this.$el.querySelector('.cut-crop__box')?.focus({ preventScroll: true });
        },

        crSpread() {
            const [a, b] = [...g.pointers.values()];
            return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
        },

        crMove(event) {
            if (!g.pointers.has(event.pointerId) || !g.rect) return;
            event.preventDefault();
            g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            const source = this.crSource();
            const shape = this.cutShapeNow();
            if (g.mode === 'pinch') {
                const d = this.crSpread();
                if (g.dist0 > 0 && d > 0) this.crLive = zoomFrame(g.frame0, { factor: d / g.dist0 });
                return;
            }
            const dx = (event.clientX - g.start.x) / g.rect.width;
            const dy = (event.clientY - g.start.y) / g.rect.height;
            if (g.mode === 'zoom') {
                // The corner: pulling it out grows the box (less zoom), pushing it in shrinks it (more zoom).
                const w0 = boxVars(source, shape, g.frame0)['--cut-box-w'];
                const width = parseFloat(w0) / 100;
                const grown = Math.max(0.05, width + Math.max(dx, dy * (g.rect.height / g.rect.width)) * 2);
                this.crLive = zoomFrame(g.frame0, { factor: width / grown });
                return;
            }
            this.crLive = moveFrame(g.frame0, dx, dy, source, shape);
        },

        crUp(event) {
            if (!g.pointers.has(event.pointerId)) return;
            g.pointers.delete(event.pointerId);
            if (g.pointers.size === 1 && g.mode === 'pinch') {
                // One finger left after a pinch: carry on as a drag from here, one undo step for the whole gesture.
                const [p] = g.pointers.values();
                g.mode = 'move';
                g.start = { ...p };
                g.frame0 = this.crLive ?? g.frame0;
                return;
            }
            if (g.pointers.size) return;
            const frame = this.crLive;
            g.mode = null;
            g.rect = null;
            this.crLive = null;
            if (frame) this.cutSetFrame(frame);
        },

        /** The wheel over the box zooms (no page scroll while the pointer is on it); a run of turns is one step. */
        crWheel(event) {
            if (!this.crSource() || g.mode) return;
            event.preventDefault();
            this.crLive = zoomFrame(this.crFrame(), { step: event.deltaY < 0 ? 1 : -1 });
            clearTimeout(g.wheel);
            g.wheel = setTimeout(() => {
                const frame = this.crLive;
                this.crLive = null;
                if (frame) this.cutSetFrame(frame, { label: 'Zoom' });
            }, WHEEL_COMMIT_MS);
        },

        destroy() {
            clearTimeout(g.wheel);
        },

        // ── Keys on the focused box ──────────────────────────────────────

        crKey(event) {
            if (event.ctrlKey || event.metaKey) return; // Ctrl+Z still reaches the dock's undo
            const frame = this.crFrame();
            const step = event.shiftKey ? BIG_STEP : 1;
            const keys = {
                ArrowLeft: () => this.cutSetFrame(nudgeFrame(frame, -step, 0)),
                ArrowRight: () => this.cutSetFrame(nudgeFrame(frame, step, 0)),
                ArrowUp: () => this.cutSetFrame(nudgeFrame(frame, 0, -step)),
                ArrowDown: () => this.cutSetFrame(nudgeFrame(frame, 0, step)),
                Home: () => this.cutSetFrame(centreFrame(frame), { label: 'Centre crop' }),
                '+': () => this.cutSetFrame(zoomFrame(frame, { step: 1 }), { label: 'Zoom' }),
                '=': () => this.cutSetFrame(zoomFrame(frame, { step: 1 }), { label: 'Zoom' }),
                '-': () => this.cutSetFrame(zoomFrame(frame, { step: -1 }), { label: 'Zoom' }),
                Escape: () => this.cutCropClose(),
                Enter: () => this.cutCropClose(),
            };
            const fn = keys[event.key];
            if (!fn) return;
            event.preventDefault();
            event.stopPropagation();
            fn();
        },
    };
}

// Zoom on the Cut's lanes (2026-10-06). Ctrl+scroll, or a trackpad pinch (the browser sends it as Ctrl+wheel), zooms
// around the pointer: the moment under it stays under it, to the pixel. Ctrl+= and Ctrl+− zoom around the playhead;
// Fit (and Ctrl+0) goes back to the whole cut. Zoom is a factor on the Fit scale, from 1 (Fit) up to MAX_PPS pixels
// per second, so a single frame (1/30 s) can be 40 px wide. Wheel events are folded into one layout per frame.
// Zoomed in, the ruler labels only the stretch around the view (a 10 min cut at a frame a minor would be thousands
// of labels) and follows the scroll. Spread into CutDock; cutLayout reads cutZoomPps() and calls cutRulerDraw().
import { rulerScale } from '/shared/cut-lanes.js';
import { patchList } from './cut-patch.js';
export const ZOOM_MAX_PPS = 1200;
const WHEEL_STEP = 0.0015; // per wheel pixel: one notch (100 px) ≈ ×1.16
const KEY_STEP = 1.5;
const LINE_PX = 16;
const GESTURE_MS = 400; // wheel steps closer than this, at the same pointer place, are one gesture

/** The wheel's travel in pixels, whatever unit the device reports. */
export const wheelPixels = (event, pageWidth = 800) =>
    event.deltaY * (event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? pageWidth : 1);

/** px/s for a Fit scale and a zoom factor, inside [fit, max(fit, ZOOM_MAX_PPS)]. */
export const zoomedPps = (fitPps, zoom) => Math.min(Math.max(fitPps, ZOOM_MAX_PPS), Math.max(fitPps, fitPps * zoom));

export const cutZoomMethods = {
    cutZoom: 1, // 1 = Fit
    _cutFitPps: 0,
    _cutZoomQueued: null, // { factor, anchorX } waiting for the next frame

    /** cutLayout's scale: the Fit scale times the zoom. The factor is clamped to what the scale can really be. */
    cutZoomPps(fitPps) {
        this._cutFitPps = fitPps;
        if (!(fitPps > 0)) return fitPps;
        const pps = zoomedPps(fitPps, this.cutZoom);
        this.cutZoom = pps / fitPps;
        // A narrow window snaps the lanes to clip starts; zoomed in, that snap would pull the anchor off the pointer.
        const scroll = this.cutPart?.('scroll');
        if (this.cutZoomed()) scroll?.style.setProperty('scroll-snap-type', 'none');
        else scroll?.style.removeProperty('scroll-snap-type');
        return pps;
    },

    /** The ruler: every label at Fit; zoomed, the labels from one view left of the scroll to one view right of it. */
    cutRulerDraw() {
        const pps = this.cutPps || 0;
        const scroll = this.cutPart?.('scroll');
        const view = scroll?.clientWidth || 0;
        const windowed = this.cutZoomed() && view > 0 && pps > 0;
        const fromS = windowed ? Math.max(0, scroll.scrollLeft - view) / pps : 0;
        const toS = windowed ? (scroll.scrollLeft + 2 * view) / pps : Infinity;
        const ruler = rulerScale(this.cutLay().total_ms, pps, { fromS, toS });
        this.cutStripView?.(scroll, windowed); // the filmstrip tiles follow the same window (cut-filmstrip.js)
        this.cutTicks = patchList(this.cutTicks, ruler.majors);
        this.cutTickStep = ruler.minorPx;
    },

    /** The lanes scrolled: a zoomed ruler redraws its window, once a frame. */
    cutOnScroll() {
        if (!this.cutZoomed() || this._cutRulerQueued) return;
        this._cutRulerQueued = true;
        const frame = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 0));
        frame(() => { this._cutRulerQueued = false; this.cutRulerDraw(); });
    },

    cutZoomed() {
        return this.cutZoom > 1.001;
    },

    /** Ctrl+wheel (and pinch) on the lanes. A plain wheel still scrolls. */
    cutWheel(event) {
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        const scroll = this.cutPart('scroll');
        if (!scroll) return;
        const factor = Math.exp(-wheelPixels(event, scroll.clientWidth) * WHEEL_STEP);
        this.cutZoomBy(factor, event.clientX - scroll.getBoundingClientRect().left);
    },

    /** Ctrl+= / Ctrl+− around the playhead (the lane's middle when it is off screen); Ctrl+0 is Fit. */
    cutZoomKey(key) {
        if (key === '0') return this.cutFit();
        const scroll = this.cutPart('scroll');
        if (!scroll) return;
        const x = (this._cutPlayer?.time() ?? 0) / 1000 * (this.cutPps || 0) - scroll.scrollLeft;
        const anchorX = x >= 0 && x <= scroll.clientWidth ? x : scroll.clientWidth / 2;
        this.cutZoomBy(key === '-' ? 1 / KEY_STEP : KEY_STEP, anchorX);
    },

    /** Folds the zoom steps of one frame into one layout, then scrolls so the anchor's time holds still. */
    cutZoomBy(factor, anchorX) {
        const queued = this._cutZoomQueued;
        this._cutZoomQueued = { factor: (queued?.factor ?? 1) * factor, anchorX };
        if (queued) return;
        const frame = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 0));
        frame(() => this.cutZoomApply());
    },

    cutZoomApply() {
        const step = this._cutZoomQueued;
        this._cutZoomQueued = null;
        const scroll = this.cutPart('scroll');
        if (!step || !scroll) return;
        const beforePps = this.cutPps || 1;
        // One gesture keeps one anchor time: the scroll snaps to whole pixels, so re-reading it every step would let
        // half a pixel of drift add up. A new pointer place, a pause or our scroll having moved starts a new anchor.
        const now = globalThis.performance?.now?.() ?? Date.now();
        const held = this._cutZoomAnchor;
        const same = held && Math.abs(held.x - step.anchorX) < 1 && now - held.at < GESTURE_MS && Math.abs(held.left - scroll.scrollLeft) < 1;
        const time = same ? held.time : (scroll.scrollLeft + step.anchorX) / beforePps;
        this.cutZoom = Math.max(1, this.cutZoom * step.factor);
        this.cutLayout();
        const left = time * (this.cutPps || 1) - step.anchorX;
        const span = this.cutPart('span');
        // The span's width is a CSS variable; set it now so the scroll can reach `left` in this same frame.
        span?.style.setProperty('--cut-span', `${this.cutSpan}px`);
        scroll.scrollLeft = Math.max(0, left);
        this._cutZoomAnchor = { time, x: step.anchorX, at: now, left: scroll.scrollLeft };
        this.cutRulerDraw(); // the window moved with the scroll
        this._cutPlayer?.playhead?.();
    },
};

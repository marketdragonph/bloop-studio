// Pan, zoom, card drag and box select. Ported from bloop's canvas.js:
// - one board update per animation frame (pointer events arrive faster than the screen draws)
// - the board rect is measured once and kept fresh by a ResizeObserver
// - gesture bookkeeping lives in a WeakMap, never in Alpine state
// Pointer Events cover mouse, pen and touch in one path; two fingers pinch-zoom.

const GRID = 20;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3;
const NOT_BOARD = 'button, a, input, textarea, select, video, audio, label, [contenteditable="true"], .port, .board-tools, .board-panel';

const STATE = new WeakMap();
const stateFor = (el) => {
    if (!STATE.has(el)) STATE.set(el, { rect: null, observer: null, frame: 0, held: null, pointers: new Map(), pinch: null, mode: null });
    return STATE.get(el);
};

const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const snap = (v) => Math.round(v / GRID) * GRID;

export const gestureMethods = {
    initGestures() {
        const g = stateFor(this.$refs.board);
        const measure = () => { g.rect = this.$refs.board.getBoundingClientRect(); };
        measure();
        g.observer = new ResizeObserver(measure);
        g.observer.observe(this.$refs.board);
    },

    destroyGestures() {
        const g = stateFor(this.$refs.board);
        g.observer?.disconnect();
        if (g.frame) cancelAnimationFrame(g.frame);
    },

    toBoard(clientX, clientY) {
        const { rect } = stateFor(this.$refs.board);
        return { x: (clientX - rect.left - this.panX) / this.zoom, y: (clientY - rect.top - this.panY) / this.zoom };
    },

    boardTransform() {
        return `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    },

    onWheel(event) {
        if (event.target.closest('textarea, .scrolls')) return;
        event.preventDefault();
        const { rect } = stateFor(this.$refs.board);
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        const next = clampZoom(this.zoom * (event.deltaY < 0 ? 1.1 : 0.9));
        this.panX = mx - (mx - this.panX) * (next / this.zoom);
        this.panY = my - (my - this.panY) * (next / this.zoom);
        this.zoom = next;
        this.markViewChanged();
    },

    zoomBy(factor) {
        const { rect } = stateFor(this.$refs.board);
        const mx = rect.width / 2;
        const my = rect.height / 2;
        const next = clampZoom(this.zoom * factor);
        this.panX = mx - (mx - this.panX) * (next / this.zoom);
        this.panY = my - (my - this.panY) * (next / this.zoom);
        this.zoom = next;
        this.markViewChanged();
    },

    onPointerDown(event) {
        if (event.button !== 0 && event.button !== 1) return;
        const g = stateFor(this.$refs.board);
        g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (g.pointers.size === 2 && event.pointerType === 'touch' && g.mode !== 'drag') return this._startPinch(g);
        if (g.pointers.size > 1) return;

        const target = event.target;
        const card = target.closest('[data-node-id]');
        const onHead = card && target.closest('.card__head');

        if (event.button === 1 || this.spaceHeld || (!card && !target.closest(NOT_BOARD))) {
            if (!event.shiftKey || event.button === 1 || this.spaceHeld) {
                this._begin(g, event, 'pan', { x: event.clientX - this.panX, y: event.clientY - this.panY });
                this.clearSelection();
                return;
            }
            const start = this.toBoard(event.clientX, event.clientY);
            this.marquee = { x1: start.x, y1: start.y, x2: start.x, y2: start.y };
            this._begin(g, event, 'box');
            return;
        }

        if (onHead && !target.closest(NOT_BOARD)) {
            const id = Number(card.dataset.nodeId);
            if (!this.selectedNodeIds.includes(id)) this.selectedNodeIds = event.shiftKey ? [...this.selectedNodeIds, id] : [id];
            const origin = this.toBoard(event.clientX, event.clientY);
            const starts = new Map(this.selectedNodes().map((n) => [n.id, { x: n.position_x, y: n.position_y }]));
            this._begin(g, event, 'drag', { origin, starts, moved: false });
        }
    },

    onPointerMove(event) {
        const g = stateFor(this.$refs.board);
        if (!g.pointers.has(event.pointerId)) return this.trackWirePreview?.(event);
        g.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        g.held = event;
        if (!g.frame) g.frame = requestAnimationFrame(() => this._applyHeld(g));
    },

    onPointerUp(event) {
        const g = stateFor(this.$refs.board);
        if (!g.pointers.has(event.pointerId)) return;
        if (g.frame) { cancelAnimationFrame(g.frame); g.frame = 0; }
        if (g.held) this._applyHeld(g); // land where the pointer let go
        g.pointers.delete(event.pointerId);
        if (g.pointers.size) return;

        if (g.mode === 'drag' && g.ctx.moved) this.commitDrag(g.ctx.starts);
        if (g.mode === 'box') this.finishMarquee();
        if (g.mode === 'pan' || g.mode === 'pinch') this.markViewChanged();
        g.mode = null;
        g.pinch = null;
    },

    _begin(g, event, mode, ctx = {}) {
        g.mode = mode;
        g.ctx = ctx;
        try { this.$refs.board.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    },

    _startPinch(g) {
        const [a, b] = [...g.pointers.values()];
        const { rect } = g;
        g.mode = 'pinch';
        g.pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, midX: (a.x + b.x) / 2 - rect.left, midY: (a.y + b.y) / 2 - rect.top, zoom: this.zoom, panX: this.panX, panY: this.panY };
    },

    _applyHeld(g) {
        g.frame = 0;
        const event = g.held;
        g.held = null;
        if (!event) return;

        if (g.mode === 'pan') {
            this.panX = event.clientX - g.ctx.x;
            this.panY = event.clientY - g.ctx.y;
        } else if (g.mode === 'pinch' && g.pointers.size >= 2) {
            const [a, b] = [...g.pointers.values()];
            const p = g.pinch;
            const zoom = clampZoom(p.zoom * ((Math.hypot(b.x - a.x, b.y - a.y) || 1) / p.dist));
            const bx = (p.midX - p.panX) / p.zoom;
            const by = (p.midY - p.panY) / p.zoom;
            this.zoom = zoom;
            this.panX = (a.x + b.x) / 2 - g.rect.left - bx * zoom;
            this.panY = (a.y + b.y) / 2 - g.rect.top - by * zoom;
        } else if (g.mode === 'drag') {
            const at = this.toBoard(event.clientX, event.clientY);
            const dx = at.x - g.ctx.origin.x;
            const dy = at.y - g.ctx.origin.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) g.ctx.moved = true;
            for (const node of this.selectedNodes()) {
                const start = g.ctx.starts.get(node.id);
                if (!start) continue;
                node.position_x = event.altKey ? start.x + dx : snap(start.x + dx);
                node.position_y = event.altKey ? start.y + dy : snap(start.y + dy);
            }
        } else if (g.mode === 'box') {
            const at = this.toBoard(event.clientX, event.clientY);
            this.marquee = { ...this.marquee, x2: at.x, y2: at.y };
        }
    },
};

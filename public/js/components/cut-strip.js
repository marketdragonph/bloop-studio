// Pointer work on the Cut's lanes (02-dock.md §6): drag a clip to reorder (6 px before it lifts, auto-scroll
// at the edges), drag an orange handle to trim (the time shows while dragging), and drag on the ruler to move
// the playhead. Spread into CutDock. A drag changes only local state each frame and pushes ONE history
// command on pointerup. Touch reorders with Move left / Move right in the clip's details instead.
import { itemsRefusal, trimItem } from '/shared/cut-edit.js';

const DRAG_PX = 6;
const EDGE_PX = 32; // auto-scroll when the pointer is this close to a lane edge
const SCROLL_STEP = 14;

/** Window listeners for one drag, removed on pointerup/cancel; moves are batched to one per frame. */
function track(onMove, onEnd) {
    let frame = 0;
    let last = null;
    const move = (ev) => {
        last = ev;
        if (frame) return;
        frame = requestAnimationFrame(() => { frame = 0; onMove(last); });
    };
    const end = (ev) => {
        cancelAnimationFrame(frame);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        onEnd(ev, last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
}

export const cutStripMethods = {
    /** x in lane px under a pointer (the lanes scroll sideways together). */
    cutLaneX(clientX) {
        const el = this.cutPart('scroll');
        if (!el) return 0;
        return clientX - el.getBoundingClientRect().left + el.scrollLeft;
    },

    cutAutoScroll(clientX) {
        const el = this.cutPart('scroll');
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (clientX < r.left + EDGE_PX) el.scrollLeft -= SCROLL_STEP;
        else if (clientX > r.right - EDGE_PX) el.scrollLeft += SCROLL_STEP;
    },

    /** Where a dragged clip would land: the number of other clips whose middle is left of the pointer. */
    cutDropIndex(item, clientX) {
        const x = this.cutLaneX(clientX);
        return this.cutItems.filter((i) => i.ready && i.key !== item.key && i.x + i.w / 2 < x).length;
    },

    /** Mouse or pen on a clip: a click selects; past 6 px it lifts and reorders on release. */
    cutPointerDown(event, item) {
        if (event.button !== 0 || event.pointerType === 'touch' || !item.ready || this.cutDraft) return;
        const startX = event.clientX;
        let lifted = false;
        let to = item.clip;
        track((ev) => {
            const dx = ev.clientX - startX;
            if (!lifted && Math.abs(dx) < DRAG_PX) return;
            lifted = true;
            this.cutAutoScroll(ev.clientX);
            to = this.cutDropIndex(item, ev.clientX);
            this.cutDrag = { kind: 'move', key: item.key, dx, to };
        }, () => {
            if (!lifted) return;
            this._cutDragged = true; // the click that follows a drag must not re-select
            setTimeout(() => { this._cutDragged = false; }, 0);
            this.cutDrag = null;
            this.cutSelectedKey = item.key;
            this.cutMoveTo(item, to);
        });
    },

    cutClick(item) {
        if (this._cutDragged) return;
        this.cutSelect(item);
    },

    /** The dragged clip follows the pointer by one CSS variable. */
    cutDragStyle(item) {
        return this.cutDrag?.kind === 'move' && this.cutDrag.key === item.key ? { '--drag-dx': `${this.cutDrag.dx}px` } : {};
    },

    /** An orange handle: in or out follows the pointer; ONE undo step on release. */
    cutTrimStart(event, item, edge) {
        if (event.button !== 0 || !item.ready || this.cutDraft) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        this.cutSelectedKey = item.key;
        this._cutEdge = edge;
        const before = this.cutSnapshot();
        const startX = event.clientX;
        const base = edge === 'in' ? item.in_ms : item.out_ms;
        const pps = this.cutPps || 1;
        this.cutDrag = { kind: edge, key: item.key };
        track((ev) => {
            const ms = base + ((ev.clientX - startX) / pps) * 1000;
            this.cutModel = trimItem(before.items, item.clip, edge === 'in' ? { in_ms: ms } : { out_ms: ms });
            this.cutLayout();
        }, () => {
            this.cutDrag = null;
            const refused = itemsRefusal(this.cutModel);
            if (refused) {
                this.cutRestore(before, { save: false });
                this.cutAnnounce = refused;
                return;
            }
            this.cutCommit(edge === 'in' ? 'Trim in' : 'Trim out', { items: this.cutModel }, { before });
        });
    },

    /** Drag on the ruler: the playhead follows (the player seeks; no edit). */
    cutScrubStart(event) {
        if (event.button !== 0) return;
        const ruler = event.currentTarget;
        const seek = (ev) => {
            const x = ev.clientX - ruler.getBoundingClientRect().left;
            this._cutPlayer?.seek((x / (this.cutPps || 1)) * 1000);
        };
        seek(event);
        track(seek, () => {});
    },
};

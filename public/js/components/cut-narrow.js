// Narrow windows and touch (02-dock.md §2, §6, P5). Spread into CutDock.
// - Under 48rem the open dock is a 60 vh bottom sheet (cut-narrow.css), and so is the Director's panel there: only
//   one is open at a time. Opening the dock folds the Director; the Director opening (its `director:open` window
//   event) folds the dock.
// - The selected clip's details are the item sheet: for each end, a slider over the whole clip and −0.1 s / +0.1 s
//   keys. A slider drag moves only local state and commits ONE undo step on release, like the handles.
import { NUDGE_MS, trimItem } from '/shared/cut-edit.js';

export const NARROW_QUERY = '(max-width: 47.999rem)';
export const isNarrow = () => globalThis.matchMedia?.(NARROW_QUERY).matches ?? false;

const tenths = (ms) => {
    const t = Math.max(0, Math.round(ms / 100));
    const s = Math.floor(t / 10);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${t % 10}`;
};

export const cutNarrowMethods = {
    _cutTrimBefore: null,
    cutItemOpen: false, // the item sheet on a narrow window: open after a tap on a clip, until Done

    /** The dock just opened: on a narrow window the Director's sheet folds, so only one sheet is open. */
    cutNarrowOpened() {
        if (this.cutOpen && this.directorOpen && isNarrow()) this.directorOpen = false;
    },

    /** The Director's panel opened: on a narrow window the dock folds to its rail. */
    cutNarrowYield() {
        if (this.cutOpen && isNarrow()) this.cutToggle();
    },

    /** The selected clip's ends and how far they can go (its measured length). */
    cutTrimBounds() {
        const item = this.cutEditable();
        const model = item ? this.cutModel[item.clip] : null;
        if (!model) return { max: 0, in_ms: 0, out_ms: 0 };
        return { max: Math.max(model.seconds_ms ?? 0, model.out_ms), in_ms: model.in_ms, out_ms: model.out_ms };
    },

    cutTrimText(edge) {
        const b = this.cutTrimBounds();
        return `${edge === 'in' ? 'In' : 'Out'} ${tenths(edge === 'in' ? b.in_ms : b.out_ms)}`;
    },

    /** A slider moved (`input`: preview only) or was let go (`change`: one undo step from where it started). */
    cutTrimRange(edge, value, { commit = false } = {}) {
        const item = this.cutEditable();
        if (!item) return;
        const before = this._cutTrimBefore ?? this.cutSnapshot();
        const ms = Math.round(Number(value) / NUDGE_MS) * NUDGE_MS;
        const items = trimItem(this.cutModel, item.clip, edge === 'in' ? { in_ms: ms } : { out_ms: ms });
        if (!commit) {
            this._cutTrimBefore = before;
            this.cutModel = items;
            this.cutLayout();
            return;
        }
        this._cutTrimBefore = null;
        this.cutCommit(edge === 'in' ? 'Trim in' : 'Trim out', { items }, { before });
        this.cutAnnounce = this.cutTrimText(edge);
    },

    /** −0.1 s / +0.1 s on one end of the selected clip (one undo step each). */
    cutTrimStep(edge, step) {
        this.cutNudge(edge, step * NUDGE_MS);
        this.cutAnnounce = this.cutTrimText(edge);
    },

    /** Done: closes the item sheet. The clip stays selected and as it is. */
    cutCloseItem() {
        this.cutItemOpen = false;
    },
};

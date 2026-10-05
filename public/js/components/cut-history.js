// The Cut dock's own undo and redo (02-dock.md §1, §6): 50 steps, only for the dock, never the board's
// history. Commands are snapshots of {items, sound}: at 50 items a snapshot is cheap, and both directions
// are explicit (createHistory from the board). Spread into CutDock; Ctrl/Cmd+Z reach it only while focus is
// in the dock (cut-actions.js), and the board's keys skip the dock (cards.js).
import { createHistory } from '../board/history.js';

export const CUT_HISTORY_LIMIT = 50;

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

export const cutHistoryMethods = {
    cutInitHistory() {
        this._cutHistory = createHistory({
            limit: CUT_HISTORY_LIMIT,
            onChange: () => {
                this.cutCanUndo = this._cutHistory.canUndo();
                this.cutCanRedo = this._cutHistory.canRedo();
            },
        });
    },

    /** A plain copy of what a save sends (never the reactive proxies). */
    cutSnapshot() {
        return { items: clone(this.cutModel), sound: clone(this.cutSound) };
    },

    /**
     * Puts a snapshot on screen. `save: false` when it came from the server (nothing to send back).
     * Every person's change goes through here, so the lanes, the player and the autosave follow.
     */
    cutRestore(snapshot, { save = true } = {}) {
        this.cutModel = clone(snapshot.items) ?? [];
        this.cutSound = clone(snapshot.sound);
        this.cutLayout();
        if (save) this.cutChanged();
    },

    /**
     * One undoable edit: shows `after`, pushes ONE command. Drags call it once on pointerup with the
     * snapshot taken on pointerdown, so a drag is one step however many frames it moved.
     * @returns {boolean} whether anything changed
     */
    cutCommit(label, after, { before = this.cutSnapshot(), save = true } = {}) {
        const next = { items: clone(after.items ?? this.cutModel), sound: clone(after.sound === undefined ? this.cutSound : after.sound) };
        if (JSON.stringify(next) === JSON.stringify(before)) {
            this.cutRestore(before, { save: false });
            return false;
        }
        this.cutRestore(next, { save });
        this._cutHistory.push({
            label,
            undo: () => this.cutRestore(before),
            redo: () => this.cutRestore(next),
        });
        return true;
    },

    async cutUndo() {
        if (!this._cutHistory?.canUndo()) return;
        const label = this._cutHistory.nextUndoLabel();
        await this._cutHistory.undo();
        this.cutAnnounce = `Undid: ${label}`;
    },

    async cutRedo() {
        if (!this._cutHistory?.canRedo()) return;
        await this._cutHistory.redo();
        this.cutAnnounce = 'Redone';
    },
};

// Autosave: the view and only the cards whose geometry changed, 1.5 s after the last change.
// The save state is visible (saved / saving / unsaved / failed) and a failed save retries,
// so work is never lost silently (bloop's lost-save bug B2).
import { api } from './api.js';

const DELAY = 1500;
const RETRY = 5000;
const LEDGER = new WeakMap(); // board element -> { saved: Map<id, geometry>, changes, timer }

const geometryOf = (n) => `${Math.round(n.position_x)},${Math.round(n.position_y)},${Math.round(n.width ?? 0)},${Math.round(n.height ?? 0)}`;

export const persistenceMethods = {
    initPersistence() {
        LEDGER.set(this.$refs.board, {
            saved: new Map(this.nodes.map((n) => [n.id, geometryOf(n)])),
            changes: 0,
            timer: null,
        });
        window.addEventListener('beforeunload', (event) => {
            if (this.saveState !== 'saved') event.preventDefault();
        });
    },

    markViewChanged() {
        this._scheduleSave();
    },

    markGeometryChanged() {
        this._scheduleSave();
    },

    _scheduleSave(delay = DELAY) {
        const ledger = LEDGER.get(this.$refs.board);
        ledger.changes++;
        if (this.saveState !== 'saving') this.saveState = 'unsaved';
        clearTimeout(ledger.timer);
        ledger.timer = setTimeout(() => this.saveNow(), delay);
    },

    async saveNow() {
        const ledger = LEDGER.get(this.$refs.board);
        if (this.saveState === 'saving') return;
        const changesAtSend = ledger.changes;
        const moved = this.nodes.filter((n) => ledger.saved.get(n.id) !== geometryOf(n));

        this.saveState = 'saving';
        try {
            await api('PUT', `${this.base}/canvas`, {
                canvas_state: { zoom: this.zoom, panX: this.panX, panY: this.panY },
                nodes: moved.map((n) => ({
                    id: n.id,
                    position_x: Math.round(n.position_x),
                    position_y: Math.round(n.position_y),
                    width: n.width ? Math.round(n.width) : null,
                    height: n.height ? Math.round(n.height) : null,
                })),
            });
            for (const n of moved) ledger.saved.set(n.id, geometryOf(n));
            // A change made while this save was in flight is not in it: save again.
            this.saveState = ledger.changes === changesAtSend ? 'saved' : 'unsaved';
            if (this.saveState === 'unsaved') this._scheduleSave();
        } catch (error) {
            this.saveState = 'failed';
            this.toast(`Board not saved: ${error.message}. Retrying.`, 'alert');
            clearTimeout(ledger.timer);
            ledger.timer = setTimeout(() => this.saveNow(), RETRY);
        }
    },

    saveLabel() {
        return { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', failed: 'Save failed, retrying' }[this.saveState];
    },
};

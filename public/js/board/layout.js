// "Tidy": pushes overlapping cards down using their real, rendered heights.
// Runs on open and after every Director turn; one undo step, saved like a drag.
import { untangle } from '/shared/layout.js';

const TIDY_SETTLE_MS = 150;

export const layoutMethods = {
    /** Moves overlapping cards apart. Returns how many moved. */
    tidyLayout({ announce = true } = {}) {
        // One query, then all the reads together: a single layout pass, not one per card.
        const cards = new Map([...this.$refs.board.querySelectorAll('.card[data-node-id]')].map((el) => [Number(el.dataset.nodeId), el]));
        const boxes = this.nodes.flatMap((n) => {
            const el = cards.get(n.id);
            return el ? [{ id: n.id, x: n.position_x, y: n.position_y, w: el.offsetWidth, h: el.offsetHeight }] : [];
        });
        const moves = untangle(boxes);
        if (!moves.size) {
            if (announce) this.toast('Nothing overlaps.');
            return 0;
        }

        const starts = new Map([...moves.keys()].map((id) => [id, this.nodeById(id).position_y]));
        const place = (positions) => {
            for (const [id, y] of positions) {
                const n = this.nodeById(id);
                if (n) n.position_y = y;
            }
            this.markGeometryChanged();
        };
        place(moves);
        this.history.push({ label: 'Tidy layout', undo: () => place(starts), redo: () => place(moves) });
        this.toast(`Moved ${moves.size} card${moves.size === 1 ? '' : 's'} so nothing overlaps.`);
        return moves.size;
    },

    /**
     * After cards render (heights are only known once they are on screen). Every picture that loads asks for
     * one; they are folded into a single pass once the board settles, not one whole-board pass per picture.
     */
    tidyAfterRender() {
        clearTimeout(this._tidyTimer);
        this._tidyTimer = setTimeout(() => this.$nextTick(() => requestAnimationFrame(() => this.tidyLayout({ announce: false }))), TIDY_SETTLE_MS);
    },
};

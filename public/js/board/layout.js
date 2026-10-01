// "Tidy": pushes overlapping cards down using their real, rendered heights.
// Runs on open and after every Director turn; one undo step, saved like a drag.
import { untangle } from '/shared/layout.js';

export const layoutMethods = {
    /** Moves overlapping cards apart. Returns how many moved. */
    tidyLayout({ announce = true } = {}) {
        const boxes = this.nodes.flatMap((n) => {
            const el = this.$refs.board.querySelector(`.card[data-node-id="${n.id}"]`);
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

    /** After cards render (heights are only known once they are on screen). */
    tidyAfterRender() {
        this.$nextTick(() => requestAnimationFrame(() => this.tidyLayout({ announce: false })));
    },
};

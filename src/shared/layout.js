// Overlap removal for board cards. Pure: takes boxes, returns the moves, touches nothing.
// Only cards that actually overlap move, and only downward, so a person's own layout stays put.

export const CARD_GAP = 40;
const SNAP = 20;

const sideBySide = (a, b) => a.x + a.w <= b.x || b.x + b.w <= a.x;

/**
 * @param {{ id: number, x: number, y: number, w: number, h: number }[]} boxes
 * @returns {Map<number, number>} card id -> new y, for the cards that must move
 */
export function untangle(boxes, gap = CARD_GAP) {
    const order = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id);
    const placed = [];
    const moves = new Map();

    for (const box of order) {
        const card = { ...box };
        let blocker;
        // A card above that this one runs into pushes it below that card (repeat: the push can hit another).
        while ((blocker = placed.find((p) => !sideBySide(p, card) && p.y <= card.y && card.y < p.y + p.h))) {
            card.y = Math.ceil((blocker.y + blocker.h + gap) / SNAP) * SNAP;
        }
        if (card.y !== box.y) moves.set(card.id, card.y);
        placed.push(card);
    }
    return moves;
}

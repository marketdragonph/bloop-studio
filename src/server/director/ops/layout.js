// Lane and stage to board coordinates (bloop's BoardLayout): lane = row, stage = column, the canvas owns x/y.
// Cards in one lane share a y, so wires run straight; the lane pitch follows the board's shape, so a 9:16
// clip card never overruns the lane below it.
import { DEFAULT_WIDTH } from '../../../shared/node-types.js';

export const STAGE_PITCH = 380; // a 280 px card and its sockets, with room for the wires between columns
const SNAP = 20;
const MEDIA_WIDTH = 256; // a card's media box: its width minus padding
const CARD_CHROME = 360; // head, model, knobs and Generate under the media box

const snap = (v) => Math.round(v / SNAP) * SNAP;

/** Row height for a board whose cards are `aspect` ("9:16"), tall enough for its tallest card. */
export function lanePitch(aspect) {
    const [w, h] = String(aspect ?? '16:9').split(':').map(Number);
    const media = w > 0 && h > 0 ? (MEDIA_WIDTH * h) / w : (MEDIA_WIDTH * 9) / 16;
    return Math.max(580, Math.ceil((media + CARD_CHROME) / SNAP) * SNAP);
}

/** Where a plan's block starts: (0, 0) on an empty board, else to the right of everything, level with its top. */
export function originFor(nodes) {
    if (!nodes.length) return { x: 0, y: 0 };
    const right = Math.max(...nodes.map((n) => n.position_x + (n.width || DEFAULT_WIDTH)));
    const top = Math.min(...nodes.map((n) => n.position_y));
    return { x: snap(right + 160), y: snap(top) };
}

export function place(origin, lane, stage, pitch) {
    return { x: snap(origin.x + (Math.max(1, stage) - 1) * STAGE_PITCH), y: snap(origin.y + (lane - 1) * pitch) };
}

const GAP = 160; // between a new block and the cards it sits beside
const MAX_SLIDES = 400;

/**
 * A free turn's cards keep their shape but start at lane 1, stage 1: "lane 4, stage 7" in a one-off turn
 * means "a new row, further right", not 2,000 px of empty board.
 */
export function compactSlots(cards) {
    if (!cards.length) return new Map();
    const lane0 = Math.min(...cards.map((c) => c.lane ?? 1));
    const stage0 = Math.min(...cards.map((c) => Math.max(1, c.stage ?? 1)));
    return new Map(cards.map((c) => [c, { lane: (c.lane ?? 1) - lane0 + 1, stage: Math.max(1, c.stage ?? 1) - stage0 + 1 }]));
}

/**
 * Where a free turn's block starts: beside the cards it works with (`anchors`: the cards it wires to, else the
 * newest card), then slid down until none of its cards lands on a card already there.
 */
export function freeOrigin(nodes, anchors, slots, pitch) {
    if (!nodes.length) return { x: 0, y: 0 };
    const near = anchors.length ? anchors : [nodes.reduce((a, b) => (b.id > a.id ? b : a))];
    const height = pitch - 40; // a card is at most a lane tall
    const boxes = nodes.map((n) => ({ x: n.position_x, y: n.position_y, w: n.width || DEFAULT_WIDTH, h: n.height || height }));
    const origin = {
        x: snap(Math.max(...near.map((n) => n.position_x + (n.width || DEFAULT_WIDTH))) + GAP),
        y: snap(Math.min(...near.map((n) => n.position_y))),
    };
    const hits = (o) => slots.some(({ lane, stage }) => {
        const at = place(o, lane, stage, pitch);
        return boxes.some((b) => at.x < b.x + b.w + SNAP && at.x + DEFAULT_WIDTH + SNAP > b.x && at.y < b.y + b.h + SNAP && at.y + height + SNAP > b.y);
    });
    for (let i = 0; i < MAX_SLIDES && hits(origin); i++) origin.y += SNAP * 4;
    return origin;
}

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

/** Where a new block starts: (0, 0) on an empty board, else to the right of everything, level with its top. */
export function originFor(nodes) {
    if (!nodes.length) return { x: 0, y: 0 };
    const right = Math.max(...nodes.map((n) => n.position_x + (n.width || DEFAULT_WIDTH)));
    const top = Math.min(...nodes.map((n) => n.position_y));
    return { x: snap(right + 160), y: snap(top) };
}

export function place(origin, lane, stage, pitch) {
    return { x: snap(origin.x + (Math.max(1, stage) - 1) * STAGE_PITCH), y: snap(origin.y + (lane - 1) * pitch) };
}

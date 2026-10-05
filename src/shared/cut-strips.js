// Filmstrips on the Video lane (2026-10-06): the frames of a clip, drawn along it at the lane's scale, so a zoomed lane
// shows the picture under each moment. The server (src/server/cut/clip-strips.js) makes ONE sheet image per file: up
// to MAX_FRAMES frames, one every `every_ms`, each cropped to a 16:9 tile, laid out COLS to a row. The dock places
// tiles along a clip and shows in each the frame nearest the clip time under the tile's middle. Shared by both.

export const STRIP = Object.freeze({
    version: 1,
    tileW: 160,
    tileH: 90,
    cols: 16,
    maxFrames: 300,
    minEveryMs: 100, // 10 frames a second: at the deepest zoom (1200 px/s) a 16:9 tile on the lane spans ~0.12 s
    dir: '.bloop-cache/strips', // inside the media folder: served by /media/, never packed, never in the repo
});

/** The sheet for a file of `durationMs`: a frame every `every_ms` (a multiple of 100 ms), at most MAX_FRAMES. */
export function stripLayout(durationMs) {
    const ms = Math.max(1, Math.round(Number(durationMs) || 0));
    const every = Math.max(STRIP.minEveryMs, Math.ceil(ms / STRIP.maxFrames / 100) * 100);
    const frames = Math.max(1, Math.ceil(ms / every));
    const cols = Math.min(STRIP.cols, frames);
    return { duration_ms: ms, every_ms: every, frames, cols, rows: Math.ceil(frames / cols), tile_w: STRIP.tileW, tile_h: STRIP.tileH };
}

/** The sheet frame for a time in the file (frame k is the picture at k × every_ms). */
export const frameAt = (strip, ms) => Math.max(0, Math.min(strip.frames - 1, Math.round(ms / strip.every_ms)));

/**
 * The tiles along one clip on the lane, only those inside [from, to] (lane px; the view, when zoomed).
 * @param {{ x: number, w: number, in_ms: number, out_ms: number }} item  where the clip sits and what of the file plays
 * @param {object} strip  stripLayout() of the file
 * @param {{ height: number, from?: number, to?: number }} view  the tile height on screen (the clip's height)
 * @returns {{ k: number, x: number, w: number, bx: number, by: number }[]} x and w within the clip; bx/by the sheet offset
 */
export function stripTiles(item, strip, { height, from = -Infinity, to = Infinity }) {
    const tw = height * (strip.tile_w / strip.tile_h);
    if (!(item.w > 0) || !(tw > 0)) return [];
    const count = Math.ceil(item.w / tw);
    const first = Math.max(0, Math.floor((from - item.x) / tw));
    const last = Math.min(count - 1, Math.floor((to - item.x) / tw));
    const span = item.out_ms - item.in_ms;
    const tiles = [];
    for (let i = first; i <= last; i++) {
        const x = i * tw;
        const w = Math.min(tw, item.w - x);
        const f = frameAt(strip, item.in_ms + ((x + w / 2) / item.w) * span);
        tiles.push({ k: i, x: round(x), w: round(w), bx: round(-(f % strip.cols) * tw), by: round(-Math.floor(f / strip.cols) * height) });
    }
    return tiles;
}

/** The sheet's size on screen for a tile height (the CSS background-size). */
export const sheetSize = (strip, height) => ({ w: round(strip.cols * height * (strip.tile_w / strip.tile_h)), h: round(strip.rows * height) });

const round = (n) => Math.round(n * 100) / 100;

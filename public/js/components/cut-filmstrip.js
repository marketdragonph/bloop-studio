// The Video lane's filmstrips (2026-10-06): each clip shows the frames of its file along its length, at the lane's
// scale, from the sheet the server made (src/server/cut/clip-strips.js, src/shared/cut-strips.js). Each tile shows
// the frame nearest the clip time under its middle, so a trim or a zoom moves the pictures with the time. Zoomed in,
// only the tiles near the view are drawn (cutViewX, set with the ruler's window in cut-zoom.js). Before a sheet is
// made, the clip shows its first frame as before. Spread into CutDock.
import { sheetSize, stripTiles } from '/shared/cut-strips.js';

const CLIP_H_FALLBACK = 82;

export const cutFilmstripMethods = {
    cutStrips: {}, // media path → sheet layout + url (GET /spaces/:id/cut)
    cutViewX: { from: -Infinity, to: Infinity }, // lane px the tiles are drawn for
    _cutClipH: 0,

    cutStripFor(item) {
        return item?.ready && item.media_path ? this.cutStrips[item.media_path] ?? null : null;
    },

    /** The clip's height on screen: the tiles are that tall (measured once the lanes are on screen). */
    cutClipHeight() {
        if (!this._cutClipH) {
            const h = this.cutPart?.('scroll')?.querySelector?.('.cut-clip')?.clientHeight;
            if (h > 2) this._cutClipH = h - 2; // the clip's 1 px inset
        }
        return this._cutClipH || CLIP_H_FALLBACK;
    },

    /** The sheet as the clip's CSS: the image and its size at the tile height. */
    cutStripSheet(item) {
        const strip = this.cutStripFor(item);
        if (!strip) return {};
        const size = sheetSize(strip, this.cutClipHeight());
        return { '--cut-strip': `url("${strip.url}")`, '--cut-strip-size': `${size.w}px ${size.h}px` };
    },

    cutStripTiles(item) {
        const strip = this.cutStripFor(item);
        if (!strip) return [];
        return stripTiles(item, strip, { height: this.cutClipHeight(), from: this.cutViewX.from, to: this.cutViewX.to });
    },

    /** The tiles' window: everything at Fit; zoomed, one view either side of the scroll (as the ruler). */
    cutStripView(scroll, windowed) {
        const view = scroll?.clientWidth || 0;
        const next = windowed ? { from: scroll.scrollLeft - view, to: scroll.scrollLeft + 2 * view } : { from: -Infinity, to: Infinity };
        if (next.from !== this.cutViewX.from || next.to !== this.cutViewX.to) this.cutViewX = next;
    },
};

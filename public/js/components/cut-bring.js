// Bring my clips (05-irresistible.md §2.5): the person's own videos and one song become a cut with zero renders.
// Spread into CutDock (which sits in the SpaceBoard scope, so `nodes` and `base` are the board's). Files dropped on the
// empty dock, on the empty board (its `cut:bring` window event) or picked with Bring my clips: one Upload card per file
// in ONE row in drop order (the no-plan cut reads top to bottom, then left to right, so the cut keeps that order), each
// file streamed as the request body (sendFile) and measured by the server before it answers. A single song is
// labelled "music bed", so BoardCut lays it under the clips. Then Fill the cut runs, because the cut is empty and the
// person dropped the files. No GPU, no cloud, no render.
import { copy } from '/shared/katana-controls.js';
import { fmtClock } from '/shared/cut-lanes.js';
import { api } from '../board/api.js';
import { sendFile } from '../board/uploads.js';

export const BRING_VIDEO = Object.freeze(['video/mp4', 'video/webm']);
export const BRING_AUDIO = Object.freeze(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/mp4']);
const COLUMN = 340; // a 280 px card and the gap to the next one
const ROW_GAP = 600;

/** The files in the order they go on the board: clips in drop order, then the songs. Others are left out. */
export function bringOrder(files) {
    const list = [...(files ?? [])];
    return [...list.filter((f) => BRING_VIDEO.includes(f.type)), ...list.filter((f) => BRING_AUDIO.includes(f.type))];
}

/** One row below everything on the board (or at the top of an empty one), in drop order. */
export function bringRow(nodes, count) {
    const top = nodes.length ? Math.max(...nodes.map((n) => Number(n.position_y) || 0)) + ROW_GAP : 0;
    const left = nodes.length ? Math.min(...nodes.map((n) => Number(n.position_x) || 0)) : 0;
    return Array.from({ length: count }, (_, i) => ({ x: Math.round((left + i * COLUMN) / 20) * 20, y: Math.round(top / 20) * 20 }));
}

export const cutBringMethods = {
    cutBringing: null, // { done, n } while files copy

    cutBringText() {
        return this.cutBringing ? copy('bringCopying', { n: this.cutBringing.n, done: this.cutBringing.done }) : '';
    },

    /** Bring my clips: the hidden file picker (several files, videos and one song). */
    cutBringPick() {
        this.cutPart('bring-input')?.click();
    },

    cutBringPicked(event) {
        const files = [...(event.target.files ?? [])];
        event.target.value = '';
        this.cutBring(files);
    },

    /** Files dropped on the dock: only an empty cut takes them (the rest of the time, cards take drops). */
    cutBringDrop(event) {
        const files = event.dataTransfer?.files;
        if (!files?.length || !this.cutEmpty()) return;
        this.cutBring([...files]);
    },

    async cutBring(files) {
        if (this.cutBringing) return;
        const ordered = bringOrder(files);
        if (!ordered.some((f) => BRING_VIDEO.includes(f.type))) {
            this.cutAnnounce = copy('bringNoClips');
            this.toast?.(this.cutAnnounce, 'warn');
            return;
        }
        if (this.cutModel.length) {
            this.cutAnnounce = copy('bringNotEmpty');
            this.toast?.(this.cutAnnounce, 'warn');
            return;
        }
        const row = bringRow(this.nodes ?? [], ordered.length);
        const songs = ordered.filter((f) => BRING_AUDIO.includes(f.type));
        let song = false;
        this.cutBringing = { done: 0, n: ordered.length };
        this.cutAnnounce = this.cutBringText();
        for (const [i, file] of ordered.entries()) {
            try {
                const node = await api('POST', `${this.base}/nodes`, { type: 'upload', position_x: row[i].x, position_y: row[i].y });
                this.nodes?.push(node);
                const card = this.nodes?.find((n) => n.id === node.id) ?? node;
                card.status = 'generating';
                card.progressLabel = 'uploading';
                const data = await sendFile(`${this.base}/nodes/${node.id}/upload`, file);
                Object.assign(card, { media_path: data.media_path, media_mime: data.media_mime, label: data.label, status: 'done' });
                // The one song goes under the clips: BoardCut takes an audio card labelled "music bed" as the bed.
                if (songs.length === 1 && BRING_AUDIO.includes(file.type)) {
                    await api('PATCH', `${this.base}/nodes/${node.id}`, { label: 'music bed' });
                    card.label = 'music bed';
                    song = true;
                }
            } catch (error) {
                this.toast?.(copy('bringFailed', { name: file.name, reason: error.message }), 'alert');
            }
            this.cutBringing = { done: i + 1, n: ordered.length };
        }
        this.cutBringing = null;
        await this.cutBringFill(song);
    },

    /** The cut is empty and the person dropped the files: fill it, open the dock, say what is in. */
    async cutBringFill(song) {
        for (let waited = 0; this._cutLoading && waited < 5000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
        await this.cutLoad();
        if (!this.cutCanFill()) return;
        await this.cutFill('fill');
        if (!this.cutOpen) this.cutToggle();
        this.cutAnnounce = copy(song ? 'bringDoneSong' : 'bringDone', { length: fmtClock(this.cutLay().export_ms) });
        this.toast?.(this.cutAnnounce, 'info');
    },
};

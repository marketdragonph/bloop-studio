// Bring my clips (05-irresistible.md §2.5): the person's own videos and one song become a cut with zero renders.
// Spread into CutDock (which sits in the SpaceBoard scope, so `nodes` and `base` are the board's). Files dropped on the
// empty dock, on the empty board (its `cut:bring` window event) or picked with Bring my clips: one Upload card per file
// in ONE row in drop order (the no-plan cut reads top to bottom, then left to right, so the cut keeps that order), each
// file streamed as the request body (sendFile) and measured by the server before it answers. A single song is
// labelled "music bed", so BoardCut lays it under the clips. Then Fill the cut runs, because the cut is empty and the
// person dropped the files. No GPU, no cloud, no render.
// P5: a file that fails to copy takes its empty Upload card off the board again (the toast says so); the cards that
// came in are ONE step of the board's undo ("Bring 3 files"); with two or more songs none is guessed: the dock says
// so and offers each song as a key (or No song), and the pick becomes the bed in one dock undo step.
import { copy } from '/shared/katana-controls.js';
import { fmtClock } from '/shared/cut-lanes.js';
import { withLevel } from '/shared/cut-edit.js';
import { MUSIC_LEVEL } from '/shared/cut-rules.js';
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
    cutBringSongs: [], // [{ node_id, name }] when two or more songs came in: the person picks the bed

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
        if (!ordered.some((f) => BRING_VIDEO.includes(f.type))) return this.cutBringRefuse('bringNoClips');
        if (this.cutModel.length) return this.cutBringRefuse('bringNotEmpty');
        const row = bringRow(this.nodes ?? [], ordered.length);
        const single = ordered.filter((f) => BRING_AUDIO.includes(f.type)).length === 1;
        const cards = [];
        const songs = [];
        this.cutBringSongs = [];
        this.cutBringing = { done: 0, n: ordered.length };
        this.cutAnnounce = this.cutBringText();
        for (const [i, file] of ordered.entries()) {
            const card = await this.cutBringOne(file, row[i], { bed: single });
            if (card) cards.push(card);
            if (card && BRING_AUDIO.includes(file.type) && !single) songs.push({ node_id: card.id, name: card.label || file.name });
            this.cutBringing = { done: i + 1, n: ordered.length };
        }
        this.cutBringing = null;
        this.cutBringHistory(cards);
        await this.cutBringFill(single && cards.some((c) => c.label === 'music bed'));
        if (songs.length > 1) {
            this.cutBringSongs = songs;
            this.cutAnnounce = copy('bringSongs', { n: songs.length });
        }
    },

    cutBringRefuse(key) {
        this.cutAnnounce = copy(key);
        this.toast?.(this.cutAnnounce, 'warn');
    },

    /** One file: its Upload card, the file streamed in, the single song labelled. Null when it did not come in. */
    async cutBringOne(file, at, { bed }) {
        let node = null;
        try {
            node = await api('POST', `${this.base}/nodes`, { type: 'upload', position_x: at.x, position_y: at.y });
            this.nodes?.push(node);
            const card = this.nodes?.find((n) => n.id === node.id) ?? node;
            card.status = 'generating';
            card.progressLabel = 'uploading';
            const data = await sendFile(`${this.base}/nodes/${node.id}/upload`, file);
            Object.assign(card, { media_path: data.media_path, media_mime: data.media_mime, label: data.label, status: 'done' });
            // The one song goes under the clips: BoardCut takes an audio card labelled "music bed" as the bed.
            if (bed && BRING_AUDIO.includes(file.type)) {
                await api('PATCH', `${this.base}/nodes/${node.id}`, { label: 'music bed' });
                card.label = 'music bed';
            }
            return card;
        } catch (error) {
            // Nothing came in: the empty Upload card goes off the board again, so no blank card is left behind.
            const removed = node ? await this.cutBringRemoveCard(node.id) : false;
            this.toast?.(copy(removed ? 'bringFailedRemoved' : 'bringFailed', { name: file.name, reason: error.message }), 'alert');
            return null;
        }
    },

    /** Takes a failed upload's empty card off the board. True when it is gone. */
    async cutBringRemoveCard(nodeId) {
        try {
            await api('DELETE', `${this.base}/nodes/${nodeId}`);
        } catch {
            return false;
        }
        if (Array.isArray(this.nodes)) this.nodes = this.nodes.filter((n) => n.id !== nodeId);
        return true;
    },

    /** The cards that came in are one step of the board's undo history (cards.js removeCard / restoreCard). */
    cutBringHistory(cards) {
        if (!cards.length || typeof this.history?.push !== 'function' || !this.removeCard || !this.restoreCard) return;
        let current = cards.map((card) => ({ ...card }));
        this.history.push({
            label: copy('bringUndo', { n: cards.length }),
            undo: async () => {
                const gone = [];
                for (const card of current) gone.push((await this.removeCard(card.id, { record: false })) ?? card);
                current = gone;
            },
            redo: async () => {
                const back = [];
                for (const card of current) back.push(await this.restoreCard(card, []));
                current = back;
            },
        });
    },

    /** Two or more songs came in: the person's pick becomes the music bed (labelled, then one dock undo step). */
    async cutBringPickSong(choice) {
        const songs = this.cutBringSongs;
        this.cutBringSongs = [];
        if (!choice) {
            this.cutAnnounce = copy('bringNoSong');
            return;
        }
        try {
            await api('PATCH', `${this.base}/nodes/${choice.node_id}`, { label: 'music bed' });
        } catch (error) {
            this.cutBringSongs = songs;
            this.toast?.(error.message, 'alert');
            return;
        }
        const card = this.nodes?.find((n) => n.id === choice.node_id);
        if (card) card.label = 'music bed';
        await this.cutLoad();
        // On the lane already (an empty cut's draft), or offered for it (a cut with no music yet: cut-beds.js).
        const bed = [this.cutBeds?.music, this.cutOffered?.music].find((b) => b?.node_id === choice.node_id);
        if (!bed) return;
        const { music: _old, ...rest } = this.cutSound ?? {};
        const said = copy('bringSongPicked', { name: choice.name });
        this.cutCommit(said, { sound: withLevel(rest, 'music', bed, MUSIC_LEVEL.default) });
        this.cutAnnounce = said;
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

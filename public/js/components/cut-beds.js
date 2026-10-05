// The Music and Voice lanes (bug 2026-10-06): they show what the export plays, the cut's own sound, never the board's
// music card on its own. BoardCut sends each kind's bed: the one the cut holds (in_cut) or the board's newest card of
// that kind (offered). An empty cut's draft also plays the offered music, as a fill takes it in. An offered card
// gets Use as music / Use as voice; a bed on the cut can be taken off. Each is ONE history command and autosaves.
// Spread into CutDock.
import { copy } from '/shared/katana-controls.js';
import { mediaUrlOf, withBed, withoutBed } from '/shared/cut-edit.js';

const NAME = { music: 'Music', voice: 'Voice' };

export const cutBedMethods = {
    /** The lanes from the cut's sound and BoardCut's cards. Runs on every layout; keeps a bed object while it holds. */
    cutSyncBeds() {
        const cards = this._cutBedCards ?? [];
        const beds = {};
        const offered = {};
        for (const kind of ['music', 'voice']) {
            const held = this.cutSound?.[kind];
            const offer = cards.find((b) => b.kind === kind && !b.in_cut) ?? null;
            let bed = null;
            if (held) {
                const card = cards.find((b) => b.node_id === held.node_id) ?? null;
                bed = { label: NAME[kind], seconds: null, ...(card ?? {}), kind, in_cut: true, node_id: held.node_id, take_id: held.take_id ?? null, media_url: mediaUrlOf(held.media_path) ?? card?.media_url ?? null };
                offered[kind] = offer?.node_id === held.node_id ? null : offer;
            } else {
                bed = this.cutDraft && kind === 'music' ? offer : null;
                offered[kind] = this.cutDraft ? null : offer;
            }
            const now = this.cutBeds?.[kind];
            beds[kind] = bed && now && now.node_id === bed.node_id && now.media_url === bed.media_url ? now : bed;
        }
        const waveChanged = beds.music?.media_url !== this.cutBeds?.music?.media_url;
        this.cutBeds = beds;
        this.cutOffered = offered;
        if (waveChanged && this.cutOpen && this.cutPart?.('scroll')) queueMicrotask(() => this.cutLoadWave());
    },

    /** Use as music / Use as voice: the offered card goes on its lane at the default level. */
    cutUseBed(kind) {
        const bed = this.cutOffered?.[kind];
        if (!bed || this.cutDraft) return;
        if (this.cutCommit(`${NAME[kind]}: ${bed.label}`, { sound: withBed(this.cutSound, kind, bed) })) {
            this.cutAnnounce = copy(kind === 'voice' ? 'voiceOn' : 'musicOn', { label: bed.label });
        }
    },

    /** Take the music (or voice) off the cut. The card stays on the board and is offered again. */
    cutBedOff(kind) {
        if (!this.cutSound?.[kind] || this.cutDraft) return;
        this.cutLevelOpen = null;
        if (this.cutCommit(`${NAME[kind]} off`, { sound: withoutBed(this.cutSound, kind) })) {
            this.cutAnnounce = copy(kind === 'voice' ? 'voiceOff' : 'musicOff');
        }
    },
};

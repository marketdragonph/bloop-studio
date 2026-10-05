// The Cut dock (Mini Katana, 02-dock.md), P1: read-only. It sits inside the SpaceBoard scope (editor.edge),
// so Go to card can use the board's own bringIntoView and selection. It loads GET /spaces/:id/cut, folds to
// a rail, remembers open/folded per viewer and space, and follows the board's ONE event stream: generation.js
// re-dispatches `cut` and `node` as `board:cut` / `board:node` window events. No watcher reads `nodes`
// (the board must not lag): the dock keeps its own small item list, changed only by those events.
// It never starts a render: Go to card takes the person to the card, where they press Generate.
import { EMPTY_TEXT, SLOT_TEXT } from '/shared/katana-controls.js';
import {
    BED_DECODE_CAP_MS, bedSegments, fitScale, fmtLength, gapBlocks, ghostPeaks, laneLayout, readout,
    rulerTicks, toBoardMs, totals, waveBars, wavePath, waveWindow,
} from '/shared/cut-lanes.js';
import { mono, reduceTrack } from './audio-player.js';

const REFETCH_MS = 300;
const CALL_MS = 1600; // how long a card Go to card lands on stays lit
const BUSY = new Set(['queued', 'generating']);
const WAVES = new Map(); // media url → peaks (decoded once per bed, per page)
const GHOST_WAVE = wavePath(ghostPeaks());
const LOADING = 'Loading the cut';
const LOAD_ERROR = 'Could not load the cut. The board still works.';

const openKey = (spaceId) => `bloop-studio:cut-open:${spaceId}`;

function readOpen(spaceId) {
    try { return localStorage.getItem(openKey(spaceId)) === '1'; } catch { return false; }
}

function saveOpen(spaceId, open) {
    try { localStorage.setItem(openKey(spaceId), open ? '1' : '0'); } catch { /* private window: the dock still folds */ }
}

export default function CutDock() {
    return {
        cutOpen: false,
        cutStatus: 'loading', // loading | ready | error
        cutError: '',
        cutRevision: 0,
        cutServerTotal: null,
        cutItems: [],
        cutIndex: {}, // node id → item index: a node event for a card not in the cut costs one lookup
        cutBeds: { music: null, voice: null },
        cutLevel: '',
        cutVoiceStart: 0,
        cutBeatsMs: [],
        cutPps: 0,
        cutSpan: 0,
        cutTicks: [],
        cutBeats: [],
        cutMusic: [],
        cutVoice: [],
        cutPauses: [],
        cutWave: '',
        cutWaveBars: 0,
        cutSelectedKey: null,
        cutAnnounce: '',
        cutEmptyText: EMPTY_TEXT,
        cutLoadError: LOAD_ERROR,
        cutGhostWave: GHOST_WAVE,
        _cutTimer: null,
        _cutLoading: false,
        _cutResize: null,
        _cutSlots: [],

        init() {
            this.cutOpen = readOpen(this.spaceId);
            this.cutLoad();
            if (this.cutOpen) this.$nextTick(() => this.cutWatchSize());
        },

        destroy() {
            this._cutResize?.disconnect();
            clearTimeout(this._cutTimer);
        },

        // ── Loading ─────────────────────────────────────────────────────────

        async cutLoad() {
            if (this._cutLoading) return this.cutRefetchSoon();
            this._cutLoading = true;
            try {
                const res = await fetch(`/spaces/${this.spaceId}/cut`, { headers: { Accept: 'application/json' } });
                if (!res.ok) throw new Error(`cut ${res.status}`);
                this.cutApply(await res.json());
                this.cutStatus = 'ready';
                this.cutError = '';
            } catch {
                // A refetch that fails keeps what is on screen; only a first load shows the error state.
                if (this.cutStatus !== 'ready') this.cutStatus = 'error';
                this.cutError = LOAD_ERROR;
            } finally {
                this._cutLoading = false;
            }
        },

        cutRetry() {
            this.cutStatus = 'loading';
            this.cutLoad();
        },

        /** At most one reload per 300 ms, the last one after the final change (like the board's refreshSoon). */
        cutRefetchSoon() {
            if (this._cutTimer) return;
            this._cutTimer = setTimeout(() => {
                this._cutTimer = null;
                this.cutLoad();
            }, REFETCH_MS);
        },

        cutApply(data) {
            const cut = data.cut ?? {};
            this.cutRevision = cut.revision ?? 0;
            this.cutServerTotal = data.clock?.total_ms ?? data.total_ms ?? null;
            this.cutBeatsMs = Array.isArray(data.beats_ms) ? data.beats_ms : [];
            this._cutSlots = Array.isArray(data.slots) ? data.slots : [];
            const beds = Array.isArray(data.beds) ? data.beds : [];
            this.cutBeds = {
                music: beds.find((b) => b.kind === 'music') ?? null,
                voice: beds.find((b) => b.kind === 'voice') ?? null,
            };
            this.cutVoiceStart = Number(cut.sound?.voice?.start_ms) || 0;
            const gain = cut.sound?.music?.gain_db;
            this.cutLevel = Number.isFinite(gain) ? `${gain > 0 ? '+' : gain < 0 ? '−' : ''}${Math.abs(gain)} dB` : '';
            this.cutLayout();
            // With the lanes on screen, decode now; else the lanes' x-init does it once they render.
            if (this.cutOpen && this.$refs.cutScroll) this.cutLoadWave();
        },

        /** Lays the items out at the current lane width (Fit). Runs on load, unfold and resize only. */
        cutLayout() {
            const width = this.$refs.cutScroll?.clientWidth || 0;
            this.cutPps = fitScale(width, this._cutSlots);
            const items = laneLayout(this._cutSlots, this.cutPps).map((i) => ({ ...i, live: i.state === 'rendering' }));
            const t = totals(items);
            const pps = this.cutPps;
            this.cutItems = items;
            this.cutIndex = Object.fromEntries(items.filter((i) => i.node_id != null).map((i) => [i.node_id, i.index]));
            this.cutSpan = Math.max(width, Math.ceil(t.board_ms / 1000 * pps));
            this.cutTicks = rulerTicks(t.board_ms, pps);
            this.cutBeats = this.cutBeatsMs.map((ms, i) => ({ key: i, x: toBoardMs(items, ms) / 1000 * pps }));
            this.cutPauses = gapBlocks(items);
            const music = this.cutBeds.music;
            this.cutMusic = music ? bedSegments(items, 0, this.cutBedMs(music), pps) : [];
            const voice = this.cutBeds.voice;
            this.cutVoice = voice ? bedSegments(items, this.cutVoiceStart, this.cutBedMs(voice), pps) : [];
            if (!items.some((i) => i.key === this.cutSelectedKey)) this.cutSelectedKey = items.find((i) => i.ready)?.key ?? null;
        },

        /** A bed's length; unmeasured, it is drawn under the whole cut (it plays once, never loops). */
        cutBedMs(bed) {
            const ms = Math.round((Number(bed.seconds) || 0) * 1000);
            return Math.max(1, ms || totals(this.cutItems).export_ms);
        },

        // ── Fold ────────────────────────────────────────────────────────────

        cutToggle() {
            this.cutOpen = !this.cutOpen;
            saveOpen(this.spaceId, this.cutOpen);
            // Opening renders the lanes, whose x-init lays them out at their width and decodes the bed.
            if (!this.cutOpen) {
                this._cutResize?.disconnect();
                this._cutResize = null;
            }
        },

        cutWatchSize() {
            const el = this.$refs.cutScroll;
            if (!el || this._cutResize || typeof ResizeObserver === 'undefined') return;
            let last = el.clientWidth;
            this._cutResize = new ResizeObserver(() => {
                if (Math.abs(el.clientWidth - last) < 8) return;
                last = el.clientWidth;
                this.cutLayout();
            });
            this._cutResize.observe(el);
        },

        // ── Music waveform: decoded only while the dock is open, once per bed ──

        async cutLoadWave() {
            const bed = this.cutBeds.music;
            if (!bed?.media_url) { this.cutWave = ''; return; }
            const bedMs = this.cutBedMs(bed);
            if (bedMs > BED_DECODE_CAP_MS) { this.cutWave = ''; return; }
            let wave = WAVES.get(bed.media_url);
            if (!wave) {
                try {
                    const res = await fetch(bed.media_url);
                    if (!res.ok) throw new Error(`media ${res.status}`);
                    const ctx = new AudioContext();
                    let buffer;
                    try { buffer = await ctx.decodeAudioData(await res.arrayBuffer()); } finally { ctx.close().catch(() => {}); }
                    const ms = Math.round(buffer.duration * 1000);
                    wave = { ms, peaks: reduceTrack(mono(buffer), buffer.sampleRate, waveBars(ms, this.cutPps)).peaks };
                    WAVES.set(bed.media_url, wave);
                } catch {
                    this.cutWave = '';
                    return;
                }
            }
            const current = this.cutBeds.music;
            if (current?.media_url !== bed.media_url) return; // the bed changed while decoding
            // Not measured on the server yet: the decoded length places the bed (display only).
            if (!(Number(current.seconds) > 0) && wave.ms > 0) {
                this.cutBeds = { ...this.cutBeds, music: { ...current, seconds: wave.ms / 1000 } };
                this.cutLayout();
            }
            this.cutWaveBars = wave.peaks.length;
            this.cutWave = wavePath(wave.peaks);
        },

        cutWaveBox(segment) {
            return waveWindow(segment, this.cutBedMs(this.cutBeds.music), this.cutWaveBars || 1);
        },

        // ── Events from the board's stream ──────────────────────────────────

        onCutEvent(detail) {
            const space = detail?.spaceId ?? detail?.space_id;
            if (space != null && space !== this.spaceId) return;
            // Even at the same revision a slot may have changed (a take landed, a card was deleted): reload.
            // Not announced: takes land and get measured all through a build, and the live region stays quiet for that.
            this.cutRefetchSoon();
        },

        onCutNode(update) {
            const index = this.cutIndex[update?.nodeId];
            if (index === undefined) return;
            const item = this.cutItems[index];
            if (!item) return;
            item.live = BUSY.has(update.status);
            if (update.status === 'failed' && !item.ready) item.state = 'failed';
            if (update.status === 'done') this.cutRefetchSoon();
        },

        // ── Items ───────────────────────────────────────────────────────────

        cutSelected() {
            return this.cutItems.find((i) => i.key === this.cutSelectedKey) ?? null;
        },

        cutSelect(item) {
            this.cutSelectedKey = item.key;
        },

        /** "Beat 3, The letter, 7.5 seconds, selected" / "Beat 4, Flashback, not rendered" (02-dock.md §10). */
        cutItemLabel(item) {
            const name = String(item.title || item.beat_tag || '').replace(/^\d+ · /, '');
            const state = item.ready ? `${(item.ms / 1000).toFixed(1)} seconds` : this.cutStateText(item);
            return `Beat ${item.index + 1}, ${name}, ${state}${item.key === this.cutSelectedKey ? ', selected' : ''}`;
        },

        /** "not rendered", "rendering", "render failed", "card deleted", "file missing" (BoardCut's reason). */
        cutStateText(item) {
            if (item.live || item.state === 'rendering') return SLOT_TEXT.rendering;
            if (item.state === 'failed') return SLOT_TEXT.failed;
            if (item.state === 'deleted') return SLOT_TEXT.card_deleted;
            return SLOT_TEXT[item.reason] ?? SLOT_TEXT.never_rendered;
        },

        /** Which look a slot wears: clip, gap (hatched), busy (blue light), failed, deleted. */
        cutKind(item) {
            if (item.ready) return 'clip';
            if (item.live || item.state === 'rendering') return 'busy';
            if (item.state === 'failed') return 'failed';
            if (item.state === 'deleted') return 'deleted';
            return 'gap';
        },

        cutLength(item) {
            return fmtLength(item.ms);
        },

        cutCanGo(item) {
            return item.node_id != null && item.state !== 'deleted';
        },

        /** Pans the board to the beat's card, selects it and lights its Generate key. Never renders. */
        cutGoToCard(item) {
            const node = this.nodeById(item.node_id);
            if (!node) return;
            this.selectedNodeIds = [node.id];
            this.selectedConnectionId = null;
            this.bringIntoView(node);
            this.$nextTick(() => {
                const card = this.$refs.board?.querySelector(`[data-node-id="${node.id}"]`);
                if (!card) return;
                card.classList.add('is-cut-called');
                card.focus({ preventScroll: true });
                setTimeout(() => card.classList.remove('is-cut-called'), CALL_MS);
            });
            this.cutAnnounce = `Showing the card for ${item.title}.`;
        },

        cutAskDirector() {
            if (!this.directorOpen) this.toggleDirector();
            else this.$nextTick(() => this.$refs.directorInput?.focus());
        },

        // ── Rail ────────────────────────────────────────────────────────────

        cutReadout() {
            if (this.cutStatus === 'loading') return LOADING;
            if (this.cutStatus === 'error') return 'Not loaded';
            if (!this.cutItems.length) return 'No clips yet';
            const t = totals(this.cutItems);
            if (!t.ready) return `0 of ${t.count} beats rendered`;
            // The server's clock wins; 0 means nothing measured yet, so the asked lengths stand in.
            return readout(this.cutItems, this.cutServerTotal || null);
        },

        cutEmpty() {
            return this.cutStatus === 'ready' && !this.cutItems.length;
        },

        cutAllGaps() {
            return this.cutStatus === 'ready' && this.cutItems.length > 0 && !this.cutItems.some((i) => i.ready);
        },
    };
}

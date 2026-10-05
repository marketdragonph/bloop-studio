// The Cut dock (Mini Katana, 02-dock.md). It sits inside the SpaceBoard scope (editor.edge), so Go to card
// can use the board's own bringIntoView and selection. It loads GET /spaces/:id/cut, folds to a rail,
// remembers open/folded per viewer and space, and follows the board's ONE event stream: generation.js
// re-dispatches `cut` and `node` as `board:cut` / `board:node` window events. No watcher reads `nodes`
// (the board must not lag): the dock keeps its own small item list, changed only by those events and edits.
// P2 edits (cut-actions.js, cut-strip.js), undo (cut-history.js) and autosave (cut-persistence.js) are method
// modules spread in here, so one scope holds one copy of the items; the preview is CutPlayer (cut-player.js).
// It never starts a render by itself: Go to card takes the person to the card, where they press Generate; Render
// missing beats (cut-render.js) queues only on the person's press in its sheet. Export and Pack (cut-export.js) start
// only on the person's press. P2b: the live cut (cut-auto.js) and Bring my clips (cut-bring.js).
import { EMPTY_TEXT, SLOT_TEXT, copy } from '/shared/katana-controls.js';
import { BED_DECODE_CAP_MS, bedSegments, fitScale, fmtClock, fmtLength, gapBlocks, ghostPeaks, rulerTicks, waveBars, wavePath, waveWindow } from '/shared/cut-lanes.js';
import { entryKey, laneEntries, layoutLane, toScreen } from '/shared/cut-timeline.js';
import { mono, reduceTrack } from './audio-player.js';
import { cutHistoryMethods } from './cut-history.js';
import { cutPersistenceMethods } from './cut-persistence.js';
import { cutActionMethods } from './cut-actions.js';
import { cutStripMethods } from './cut-strip.js';
import { cutExportMethods } from './cut-export.js';
import { cutAutoMethods } from './cut-auto.js';
import { cutRenderMethods } from './cut-render.js';
import { cutBringMethods } from './cut-bring.js';

const REFETCH_MS = 300;
const CALL_MS = 1600; // how long a card Go to card lands on stays lit
const RING_MS = 2000; // items another window or the Director changed glow sensor blue this long
const MAX_PPS = 160; // a 0.1 s clip never stretches the lane past this many px per second
const BUSY = new Set(['queued', 'generating']);
const WAVES = new Map(); // media url → peaks (decoded once per bed, per page)
const GHOST_WAVE = wavePath(ghostPeaks());
const LOADING = 'Loading the cut';
const LOAD_ERROR = 'Could not load the cut. The board still works.';
const pad = (n) => String(n).padStart(2, '0');

const openKey = (spaceId) => `bloop-studio:cut-open:${spaceId}`;

function readOpen(spaceId) {
    try { return localStorage.getItem(openKey(spaceId)); } catch { return null; }
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
        cutModel: [], // the cut's items, the ONE copy (saved by cut-persistence.js)
        cutSound: null,
        cutSettings: { resolution: 1080, fps: 30 },
        cutDraft: true, // no items yet: the lane shows the board's ready beats, read only, until Fill
        cutAuto: true, // the live cut: the server fills the cut as clips land, until the person's first edit (P2b)
        cutGuessed: false, // no plan on this board: the live cut never runs here
        cutAsExported: false,
        cutItems: [], // what the lanes draw (cut-timeline.js), rebuilt only on load, edit, resize
        cutIndex: {}, // node id → lane index: a node event for a card not in the cut costs one lookup
        cutBeds: { music: null, voice: null },
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
        cutCanUndo: false,
        cutCanRedo: false,
        cutSaveState: 'saved', // saved | unsaved | saving | failed
        cutSaveError: '',
        cutBanner: null, // conflict | director | restore | replace
        cutRemoved: null, // { title } for the 8 s Undo line in the rail
        cutUnplayable: [], // lane keys the preview could not play
        cutRung: [], // lane keys glowing after a change from elsewhere
        cutDrag: null, // { kind: 'move' | 'in' | 'out', key, ... } while a pointer drags
        cutLevelOpen: null, // 'music' | 'voice' while its level popover is open
        cutFilling: false,
        _cutEdge: 'out', // which edge Shift+arrow and the handles' keys move
        _cutLay: null, // the timed lane (layoutLane) the player plays
        _cutBoardMs: 0,
        _cutPlayer: null, // CutPlayer's handle, set while the dock is open
        _cutPlayOnOpen: false,
        _cutTimer: null,
        _cutLoading: false,
        _cutResize: null,
        _cutSlots: [],
        _cutHistory: null,
        _cutBooted: false,

        init() {
            this.cutOpen = readOpen(this.spaceId) === '1';
            this.cutInitHistory();
            this.cutInitPersistence();
            this.cutLoad();
            this.cutInitExport();
            if (this.cutOpen) this.$nextTick(() => this.cutWatchSize());
        },

        destroy() {
            this._cutResize?.disconnect();
            clearTimeout(this._cutTimer);
            clearTimeout(this._cutRemovedTimer);
            this.cutDestroyPersistence();
        },

        /**
         * A part of the open lanes (scroll, playhead, cap). Not $refs: the lanes sit under an x-init wrapper, which
         * Alpine counts as a root, so its refs never reach this scope. One dock per page.
         */
        cutPart(name) {
            return document.querySelector(`.cut-dock [data-cut-part="${name}"]`);
        },

        cutCopy(key, vars) {
            return copy(key, vars);
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
            this.cutBeatsMs = Array.isArray(data.beats_ms) ? data.beats_ms : [];
            this._cutSlots = Array.isArray(data.slots) ? data.slots : [];
            this.cutFindings = Array.isArray(data.findings) ? data.findings : [];
            this.cutGuessed = Boolean(data.guessed);
            const beds = Array.isArray(data.beds) ? data.beds : [];
            this.cutBeds = {
                music: beds.find((b) => b.kind === 'music') ?? null,
                voice: beds.find((b) => b.kind === 'voice') ?? null,
            };
            if (cut.settings) this.cutSettings = cut.settings;
            this.cutReceive(cut, { by: cut.updated_by }); // adopts, keeps the person's edits, or asks (cut-persistence.js)
            this.cutLayout();
            // With the lanes on screen, decode now; else the lanes' x-init does it once they render.
            if (this.cutOpen && this.cutPart('scroll')) this.cutLoadWave();
        },

        /** Lays the lane out at the current width (Fit). Runs on load, edit, unfold, resize and the As exported toggle. */
        cutLayout() {
            const width = this.cutPart('scroll')?.clientWidth || 0;
            const { entries, draft } = laneEntries(this.cutModel, this._cutSlots);
            const layout = layoutLane(entries, { gaps: !this.cutAsExported });
            this.cutDraft = draft;
            this._cutLay = layout;
            this._cutBoardMs = this.cutAsExported ? layoutLane(entries).total_ms : layout.total_ms;
            const shown = layout.entries.filter((e) => !e.hidden);
            const pps = Math.min(MAX_PPS, fitScale(width, shown.map((e) => ({ seconds: e.ms / 1000 }))));
            this.cutPps = Math.max(pps, width > 0 && layout.total_ms > 0 ? width / (layout.total_ms / 1000) : 0);
            const items = shown.map((e) => this.cutViewItem(e, this.cutPps));
            this.cutItems = items;
            const index = {};
            items.forEach((i, k) => { if (i.node_id != null) index[i.node_id] = k; });
            this.cutIndex = index;
            this.cutSpan = Math.max(width, Math.ceil(layout.total_ms / 1000 * this.cutPps));
            this.cutTicks = rulerTicks(layout.total_ms, this.cutPps);
            this.cutBeats = this.cutBeatsMs.map((ms, i) => ({ key: i, x: toScreen(layout, ms) / 1000 * this.cutPps }));
            this.cutPauses = gapBlocks(items);
            const music = this.cutBeds.music;
            this.cutMusic = music ? bedSegments(items, 0, this.cutBedMs(music), this.cutPps) : [];
            const voice = this.cutBeds.voice;
            this.cutVoice = voice ? bedSegments(items, Number(this.cutSound?.voice?.start_ms) || 0, this.cutBedMs(voice), this.cutPps) : [];
            if (!items.some((i) => i.key === this.cutSelectedKey)) this.cutSelectedKey = items.find((i) => i.ready)?.key ?? null;
            if (!this.cutDrag) this._cutPlayer?.refresh(); // a trim drag refreshes once, on release
            this.cutTellMissing(); // the board's render readout (cut-render.js)
        },

        /** One lane entry as the views draw it (positions in px from the shared time map). */
        cutViewItem(e, pps) {
            const slot = e.slot ?? {};
            const item = e.item;
            const ready = e.kind === 'clip';
            const beat = e.beat || e.index + 1;
            const newer = ready && !this.cutDraft && slot.take_id && item.take_id && slot.take_id > item.take_id && slot.media_url;
            return {
                key: entryKey(e),
                lane: e.index,
                clip: ready ? e.clip : -1, // index in cutModel
                beat,
                title: slot.label ?? `${pad(beat)} · ${item?.beat_tag ?? 'Beat'}`,
                ready,
                state: ready ? (e.gone ? 'deleted' : 'ready') : slot.state,
                reason: ready ? null : slot.reason,
                live: slot.state === 'rendering',
                node_id: item?.node_id ?? slot.node_id ?? null,
                poster_url: slot.poster_url ?? null,
                measured: slot.measured,
                ms: e.ms,
                board_ms: e.start_ms,
                export_ms: ready ? e.export_ms : null,
                x: Math.round(e.start_ms / 1000 * pps * 100) / 100,
                w: Math.round(e.ms / 1000 * pps * 100) / 100,
                join: ready ? e.join.type : null,
                joinMs: ready ? e.join.ms : 0,
                in_ms: ready ? item.in_ms : 0,
                out_ms: ready ? item.out_ms : 0,
                seconds_ms: ready ? item.seconds_ms : 0,
                sound: ready ? item.sound !== false : true,
                note: ready ? item.note ?? '' : '',
                gone: e.gone,
                newTake: newer ? { take_id: slot.take_id, media_url: slot.media_url, seconds_ms: Math.round((slot.seconds ?? 0) * 1000) || null } : null,
            };
        },

        cutLay() {
            return this._cutLay ?? { entries: [], total_ms: 0, export_ms: 0 };
        },

        /** A bed's length; unmeasured, it is drawn under the whole cut (it plays once, never loops). */
        cutBedMs(bed) {
            const ms = Math.round((Number(bed.seconds) || 0) * 1000);
            return Math.max(1, ms || this.cutLay().export_ms);
        },

        // ── Fold ────────────────────────────────────────────────────────────

        cutToggle() {
            this.cutOpen = !this.cutOpen;
            saveOpen(this.spaceId, this.cutOpen);
            // Opening renders the lanes, whose x-init lays them out at their width and decodes the bed.
            // Folding removes the body (x-if): the player's videos and audio go with it.
            if (!this.cutOpen) {
                this._cutResize?.disconnect();
                this._cutResize = null;
            }
        },

        /** The first draft that lands opens the dock once, unless the person already chose open or folded. */
        cutFirstDraftLanded() {
            if (readOpen(this.spaceId) !== null || this.cutOpen) return;
            this.cutOpen = true;
            saveOpen(this.spaceId, true);
        },

        cutWatchSize() {
            const el = this.cutPart('scroll');
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
            if (detail?.offer === 'replace' && !this.cutBanner) this.cutBanner = 'replace';
            if (Array.isArray(detail?.changed) && detail.changed.length) this._cutRingIds = detail.changed;
            // Our own save sends a `cut` event too; while it is in flight, wait and reload after it.
            if (this.cutSaveState === 'saving') { this._cutEventWaiting = true; return; }
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

        /** Items another window or the Director changed glow for 2 s (none under reduced motion: static ring). */
        cutRing(keys) {
            this.cutRung = keys;
            clearTimeout(this._cutRingTimer);
            this._cutRingTimer = setTimeout(() => { this.cutRung = []; }, RING_MS);
        },

        // ── Items ───────────────────────────────────────────────────────────

        cutSelected() {
            return this.cutItems.find((i) => i.key === this.cutSelectedKey) ?? null;
        },

        /** "Beat 3, The letter, 7.5 seconds, dissolve in, selected" / "Beat 4, Flashback, not rendered" (02-dock.md §10). */
        cutItemLabel(item) {
            const name = String(item.title || '').replace(/^\d+ · /, '');
            const parts = [`Beat ${item.beat}`, name];
            if (item.ready) {
                parts.push(`${(item.ms / 1000).toFixed(1)} seconds`);
                if (item.join === 'dissolve' && item.clip > 0) parts.push('dissolve in');
                if (!item.sound) parts.push('sound off');
                if (item.gone) parts.push(SLOT_TEXT.card_deleted);
                if (this.cutUnplayable.includes(item.key)) parts.push(copy('unplayable'));
            } else {
                parts.push(this.cutStateText(item));
            }
            if (item.key === this.cutSelectedKey) parts.push('selected');
            return parts.join(', ');
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

        cutCounts() {
            const all = this.cutLay().entries;
            return { ready: all.filter((e) => e.kind === 'clip').length, count: all.length };
        },

        cutReadout() {
            if (this.cutStatus === 'loading') return LOADING;
            if (this.cutStatus === 'error') return 'Not loaded';
            const { ready, count } = this.cutCounts();
            if (!count) return 'No clips yet';
            if (!ready) return `0 of ${count} beats rendered`;
            // "All 7 beats are in · 0:47" once every planned beat has its clip (05 §2.1).
            const head = ready === count && count > 1 && !this.cutGuessed ? copy('allIn', { n: count }) : copy('beats', { ready, n: count });
            const parts = [head, fmtClock(this.cutLay().export_ms)];
            if (ready < count) parts.push(copy('withGaps', { total: fmtClock(this._cutBoardMs) }));
            return parts.join(' · ');
        },

        cutEmpty() {
            return this.cutStatus === 'ready' && !this.cutItems.length && !this.cutLay().entries.length;
        },

        cutAllGaps() {
            return this.cutStatus === 'ready' && this.cutItems.length > 0 && !this.cutItems.some((i) => i.ready);
        },

        ...cutHistoryMethods,
        ...cutPersistenceMethods,
        ...cutActionMethods,
        ...cutStripMethods,
        ...cutExportMethods,
        ...cutAutoMethods,
        ...cutRenderMethods,
        ...cutBringMethods,
    };
}

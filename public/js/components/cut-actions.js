// The Cut dock's edit actions (02-dock.md §6): select, move, trim, remove with an 8 s Undo, joins, clip
// sound, Use new take, Fill the cut, the bed levels, Fit, As exported, Play, and the dock's keys.
// Spread into CutDock. Every edit is ONE history command (cut-history.js) and autosaves (cut-persistence.js).
// Keys only reach here from inside the dock: the board's onKeyDown (cards.js) returns early there.
import { KEYS, copy } from '/shared/katana-controls.js';
import {
    NUDGE_MS, itemsRefusal, levelOf, levelRange, mediaPathOf, moveItem, nudgeItem, removeItem, setEdgeAt,
    toggleJoin, toggleSound, trimItem, useTake, withLevel,
} from '/shared/cut-edit.js';
import { levelText } from '/shared/cut-rules.js';
import { sourceAt } from '/shared/cut-timeline.js';

const REMOVED_MS = 8000;
const TYPING = 'input, textarea, select, [contenteditable="true"]';
const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content ?? '';

export const cutActionMethods = {
    // ── Selection ───────────────────────────────────────────────────────

    cutSelect(item) {
        this.cutSelectedKey = item.key;
    },

    /** The selected clip when it can be edited (a stored cut, not the read-only draft lane). */
    cutEditable() {
        const item = this.cutSelected();
        return item?.ready && !this.cutDraft ? item : null;
    },

    /** ←/→: the next clip, focused, so Tab + arrows walk the strip. */
    cutSelectStep(step) {
        const clips = this.cutItems.filter((i) => i.ready);
        if (!clips.length) return;
        const at = clips.findIndex((i) => i.key === this.cutSelectedKey);
        const next = clips[Math.max(0, Math.min(clips.length - 1, at < 0 ? 0 : at + step))];
        this.cutSelectedKey = next.key;
        this.cutFocusItem(next.key);
    },

    cutFocusItem(key) {
        this.$nextTick(() => this.cutPart('scroll')?.querySelector(`[data-cut-key="${CSS.escape(key)}"] .cut-clip`)?.focus());
    },

    // ── Edits ───────────────────────────────────────────────────────────

    /** Runs a pure edit on the items; refused when the result breaks a rule (the server checks again). */
    cutEdit(label, items, announce = '') {
        const refused = itemsRefusal(items);
        if (refused) { this.cutAnnounce = refused; return false; }
        const changed = this.cutCommit(label, { items });
        if (changed && announce) this.cutAnnounce = announce;
        return changed;
    },

    cutMove(step) {
        const item = this.cutEditable();
        if (!item) return;
        const to = item.clip + step;
        if (to < 0 || to >= this.cutModel.length) return;
        this.cutEdit('Move', moveItem(this.cutModel, item.clip, to), copy('moved', { beat: item.beat, to: to + 1 }));
        this.cutFocusItem(item.key);
    },

    cutCanMove(step) {
        const item = this.cutEditable();
        return Boolean(item) && item.clip + step >= 0 && item.clip + step < this.cutModel.length;
    },

    cutMoveTo(item, to) {
        if (to === item.clip) return;
        this.cutEdit('Move', moveItem(this.cutModel, item.clip, to), copy('moved', { beat: item.beat, to: to + 1 }));
    },

    cutNudge(edge, delta) {
        const item = this.cutEditable();
        if (!item) return;
        this.cutEdit(edge === 'in' ? 'Trim in' : 'Trim out', nudgeItem(this.cutModel, item.clip, edge, delta));
    },

    /** [ / ]: the edge lands where the playhead is, when the playhead is over the selected clip. */
    cutEdgeAtPlayhead(edge) {
        const item = this.cutEditable();
        if (!item) return;
        const entry = this.cutLay().entries[item.lane];
        const t = this._cutPlayer?.time() ?? entry.start_ms;
        if (t < entry.start_ms || t > entry.end_ms) { this.cutAnnounce = 'Move the playhead over the clip first.'; return; }
        this.cutEdit(edge === 'in' ? 'Set in' : 'Set out', setEdgeAt(this.cutModel, item.clip, edge, sourceAt(entry, t)));
    },

    cutRemove(item = this.cutEditable()) {
        if (!item?.ready || this.cutDraft) return;
        if (!this.cutEdit('Remove', removeItem(this.cutModel, item.clip), copy('removed', { title: item.title }))) return;
        this.cutRemoved = { title: item.title };
        clearTimeout(this._cutRemovedTimer);
        this._cutRemovedTimer = setTimeout(() => { this.cutRemoved = null; }, REMOVED_MS);
        const next = this.cutItems.find((i) => i.ready && i.clip === item.clip) ?? this.cutItems.filter((i) => i.ready).at(-1);
        this.cutSelectedKey = next?.key ?? null;
    },

    /** The rail's Undo after a remove: undoes the last edit (the remove, unless more came after it). */
    cutUndoRemove() {
        this.cutRemoved = null;
        clearTimeout(this._cutRemovedTimer);
        this.cutUndo();
    },

    cutToggleJoin(item) {
        if (!item?.ready || this.cutDraft || item.clip < 1) return;
        const { items, refused } = toggleJoin(this.cutModel, item.clip);
        if (refused) { this.cutAnnounce = refused; return; }
        const type = items[item.clip].join.type;
        this.cutEdit('Join', items, `Join before beat ${item.beat}: ${type}`);
    },

    cutJoinLabel(item) {
        const before = this.cutItems.filter((i) => i.ready && i.clip === item.clip - 1)[0];
        return `Join between beat ${before?.beat ?? item.beat - 1} and ${item.beat}: ${item.join}`;
    },

    cutToggleSound(item = this.cutEditable()) {
        if (!item?.ready || this.cutDraft) return;
        this.cutEdit('Clip sound', toggleSound(this.cutModel, item.clip), `${item.title}: sound ${item.sound ? 'off' : 'on'}`);
    },

    cutUseNewTake(item) {
        if (!item?.newTake) return;
        const take = { take_id: item.newTake.take_id, media_path: mediaPathOf(item.newTake.media_url), seconds_ms: item.newTake.seconds_ms };
        const { items, clamped } = useTake(this.cutModel, item.clip, take);
        this.cutEdit('Use new take', items, clamped ? copy('trimReset') : `${item.title}: new take in`);
    },

    /** Handle keys (role=slider): ←/→ 0.1 s, Shift 1 s. */
    cutHandleKey(event, item, edge) {
        const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
        if (!step) return;
        event.preventDefault();
        event.stopPropagation();
        this.cutSelectedKey = item.key;
        this._cutEdge = edge;
        this.cutEdit(edge === 'in' ? 'Trim in' : 'Trim out', nudgeItem(this.cutModel, item.clip, edge, step * (event.shiftKey ? 1000 : NUDGE_MS)));
    },

    cutHandleText(item, edge) {
        const ms = edge === 'in' ? item.in_ms : item.out_ms;
        return `${edge === 'in' ? 'In' : 'Out'} ${this.cutTenths(ms)}`;
    },

    cutTenths(ms) {
        const tenths = Math.max(0, Math.round((Number(ms) || 0) / 100));
        const s = Math.floor(tenths / 10);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`;
    },

    // ── Fill the cut / Replace my cut (POST /spaces/:id/cut/draft, the service stitch_cut calls) ──

    async cutFill(mode = 'fill') {
        if (this.cutFilling) return;
        this.cutFilling = true;
        try {
            const res = await fetch(`/spaces/${this.spaceId}/cut/draft`, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
                body: JSON.stringify({ mode, revision: this.cutRevision }),
            });
            const data = await res.json().catch(() => null);
            if (res.status === 409 && data?.cut) { this.cutHoldServer(data.cut, 'conflict'); return; }
            if (!res.ok || !data?.cut) { this.cutAnnounce = data?.error ?? copy('draftFailed'); return; }
            if (this.cutBanner === 'replace') this.cutBanner = null;
            const before = this.cutSnapshot();
            this.cutRevision = data.cut.revision;
            // One undo step: undoing a draft saves the cut as it was (the server also keeps previous_items).
            this.cutCommit(mode === 'replace' ? 'Replace my cut' : 'Fill the cut', { items: data.cut.items, sound: data.cut.sound }, { before, save: false });
            this.cutSaveState = 'saved';
            if (data.drafted === false && data.reason) this.cutAnnounce = data.reason;
            else this.cutAnnounce = `${data.cut.items.length} clips in the cut.`;
            this.cutFirstDraftLanded();
            this.cutRefetchSoon();
        } catch {
            this.cutAnnounce = copy('draftFailed');
        } finally {
            this.cutFilling = false;
        }
    },

    cutCanFill() {
        return this.cutStatus === 'ready' && this.cutDraft && this.cutItems.some((i) => i.ready);
    },

    cutDismissBanner() {
        this.cutBanner = null;
    },

    // ── Bed levels (05 §3.5): −24..+6 dB; the preview follows at once, one undo step per change ──

    cutLevelDb(kind) {
        return levelOf(this.cutSound, kind);
    },

    cutLevelText(kind) {
        return levelText(kind === 'voice' ? 'Voice' : 'Music', this.cutLevelDb(kind));
    },

    cutLevelRange(kind) {
        return levelRange(kind);
    },

    /** `input` moves the preview; `change` commits one undo step from the level the drag started at. */
    cutSetLevel(kind, value, { commit = false } = {}) {
        const sound = withLevel(this.cutSound, kind, this.cutBeds[kind], Number(value));
        if (!commit) {
            this._cutLevelBefore ??= this.cutSnapshot();
            this.cutSound = sound;
            this._cutPlayer?.levels();
            return;
        }
        const before = this._cutLevelBefore ?? this.cutSnapshot();
        this._cutLevelBefore = null;
        this.cutCommit(`${kind === 'voice' ? 'Voice' : 'Music'} level`, { sound }, { before });
        this._cutPlayer?.levels();
    },

    cutLevelToggle(kind) {
        this.cutLevelOpen = this.cutLevelOpen === kind ? null : kind;
    },

    // ── View ────────────────────────────────────────────────────────────

    /** Fit: back to the lane width, scrolled to the start. */
    cutFit() {
        this.cutLayout();
        this.cutPart('scroll')?.scrollTo({ left: 0 });
    },

    /** As exported hides the gaps; the playhead keeps its place in the export. */
    cutToggleExported() {
        const at = this._cutPlayer?.exportTime() ?? null;
        this.cutAsExported = !this.cutAsExported;
        this.cutLayout();
        if (at != null) this._cutPlayer?.seekExport(at);
    },

    /** Play from the rail: a folded dock opens first (it holds no video while folded). */
    cutPlay() {
        if (this._cutPlayer) return this._cutPlayer.toggle();
        this._cutPlayOnOpen = true;
        if (!this.cutOpen) this.cutToggle();
    },

    cutPlaying() {
        return Boolean(this._cutPlayer?.playing());
    },

    // ── Keys (focus inside the dock) ────────────────────────────────────

    cutOnKey(event) {
        if (event.target.closest?.(TYPING) || event.defaultPrevented) return;
        const key = event.key;
        const mod = event.ctrlKey || event.metaKey;
        if (mod && key.toLowerCase() === 'z') return this.cutKey(event, () => (event.shiftKey ? this.cutRedo() : this.cutUndo()));
        if (mod && key.toLowerCase() === 'y') return this.cutKey(event, () => this.cutRedo());
        if (mod) return;
        if (key === ' ' || event.code === 'Space') return this.cutKey(event, () => this.cutPlay());
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
            const step = key === 'ArrowLeft' ? -1 : 1;
            if (event.altKey) return this.cutKey(event, () => this.cutMove(step));
            if (event.shiftKey) return this.cutKey(event, () => this.cutNudge(this._cutEdge ?? 'out', step * NUDGE_MS));
            return this.cutKey(event, () => this.cutSelectStep(step));
        }
        const join = event.target.closest?.('[data-cut-join]');
        const actions = {
            [KEYS.inPoint]: () => { this._cutEdge = 'in'; this.cutEdgeAtPlayhead('in'); },
            [KEYS.outPoint]: () => { this._cutEdge = 'out'; this.cutEdgeAtPlayhead('out'); },
            [KEYS.join.toLowerCase()]: () => this.cutToggleJoin(join ? this.cutItems.find((i) => i.key === join.dataset.cutJoin) : this.cutEditable()),
            [KEYS.mute.toLowerCase()]: () => this.cutToggleSound(),
            [KEYS.remove]: () => this.cutRemove(),
            Backspace: () => this.cutRemove(),
            Escape: () => { this.cutLevelOpen = null; },
        };
        const fn = actions[key.length === 1 ? key.toLowerCase() : key] ?? actions[key];
        if (fn) this.cutKey(event, fn);
    },

    cutKey(event, fn) {
        event.preventDefault();
        event.stopPropagation();
        fn();
    },
};

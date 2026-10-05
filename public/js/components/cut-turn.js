// The Director's turn, shown in the dock (05-irresistible.md §3.1–§3.3, 03-director.md §3). Spread into CutDock.
// After a Director turn the strip under the rail reads "Director · 14 edits · 1:42 → 1:31", with Show edits (one
// row per change; a row selects that clip and moves the playhead) and Undo turn (POST /cut/undo-turn, the one
// undo for the whole turn). The rows, the "why" of each cut point and the before lengths come from the GET's
// `turn` (the cut_turns row); changed clips keep their sensor-blue note until the person edits them. Trimmed clips
// show the frames the turn took as a faint blue ghost; clips the Director left alone because the person owns them
// show "Yours, untouched". The strip goes the moment the person edits (it is then one step in Ctrl+Z's history).
// Nothing here renders, exports or saves on its own: Undo turn is the person's press.
import { copy } from '/shared/katana-controls.js';
import { fmtClock, fmtLength } from '/shared/cut-lanes.js';

const csrfToken = () => globalThis.document?.querySelector?.('meta[name="csrf-token"]')?.content ?? '';
const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
const list = (v) => (Array.isArray(v) ? v : []);
const reduced = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * The GET's `turn` (a cut_turns row) in the one shape the dock reads, or null. Tolerant on names
 * (`id`/`turn`, `after_rev`/`revision`, `*_total_ms`/`*_ms`, `ops_summary`/`sound_rows`). Rows get their `why` from the reasons ledger;
 * sound rows come from `ops_summary`; with no rows at all, the changed clips' notes stand in.
 */
export function readTurn(raw, items = []) {
    if (!raw || typeof raw !== 'object' || raw.undone_at || raw.undone) return null;
    const id = raw.id ?? raw.turn;
    const revision = int(raw.after_rev ?? raw.revision);
    if (id == null || revision == null) return null;
    const changed = list(raw.changed).map(String);
    const reasons = list(raw.reasons);
    const whyFor = (r) => reasons.find((x) => (r.item_id && x.item_id === r.item_id) || (!r.item_id && r.beat_tag && x.beat_tag === r.beat_tag))?.why ?? null;
    const byItem = new Map(items.map((i) => [String(i.id), i]));
    const byNode = new Map(items.map((i) => [String(i.node_id), i]));
    const itemOf = (r) => byItem.get(String(r.item_id)) ?? byNode.get(String(r.node_id)) ?? null;
    let rows = list(raw.rows).filter((r) => r && (r.text || r.note)).map((r) => {
        const item = itemOf(r);
        return {
            kind: r.kind ?? 'edit', item_id: item?.id ?? r.item_id ?? null, node_id: item?.node_id ?? int(r.node_id),
            beat_tag: r.beat_tag ?? item?.beat_tag ?? null, text: String(r.text ?? r.note), at_ms: int(r.at_ms),
            why: r.why ?? whyFor(r), was: r.was && typeof r.was === 'object' ? { in_ms: int(r.was.in_ms), out_ms: int(r.was.out_ms) } : null,
        };
    });
    if (!rows.length) {
        rows = items.filter((i) => i.note && (changed.includes(String(i.node_id)) || changed.includes(String(i.id))))
            .map((i) => ({ kind: 'edit', item_id: i.id, node_id: i.node_id, beat_tag: i.beat_tag ?? null, text: i.note, at_ms: null, why: whyFor({ item_id: i.id, beat_tag: i.beat_tag }), was: null }));
    }
    for (const s of list(raw.ops_summary ?? raw.sound_rows)) {
        const text = typeof s === 'string' ? s : s?.text;
        if (text) rows.push({ kind: 'sound', item_id: null, node_id: null, beat_tag: null, text: String(text), at_ms: int(s?.at_ms), why: s?.why ?? null, was: null });
    }
    rows = rows.map((r, i) => ({ ...r, key: `t${id}:${i}` }));
    const edits = int(raw.edits) ?? rows.length;
    const lockedIds = Array.isArray(raw.locked) ? raw.locked.map(String) : null;
    const touched = (i) => changed.includes(String(i.node_id)) || changed.includes(String(i.id)) || rows.some((r) => r.item_id === i.id);
    const locked = lockedIds ?? items.filter((i) => !touched(i) && (i.placed_by === 'person' || int(i.person_rev) > 0)).map((i) => String(i.id));
    return {
        id: String(id), revision, edits, changed, rows, locked, undoable: raw.undoable !== false,
        before_ms: int(raw.before_total_ms ?? raw.before_ms), after_ms: int(raw.after_total_ms ?? raw.after_ms),
    };
}

/** "Director · 14 edits · 1:42 → 1:31" (the lengths only when both are known). */
export function turnHead(turn) {
    if (!turn) return '';
    const head = turn.edits === 1 ? copy('turnHeadOne') : copy('turnHead', { n: turn.edits });
    if (turn.before_ms == null || turn.after_ms == null) return head;
    // A trim under a second can round both lengths to the same second: then tenths, so the change shows.
    const fmt = fmtClock(turn.before_ms) === fmtClock(turn.after_ms) && turn.before_ms !== turn.after_ms ? fmtLength : fmtClock;
    return `${head} · ${fmt(turn.before_ms)} → ${fmt(turn.after_ms)}`;
}

export const cutTurnMethods = {
    cutTurn: null, // readTurn(): the latest Director turn the server still holds
    cutTurnOpen: false, // Show edits: the rows are listed and the changed clips marked
    cutTurnBusy: false,
    _cutTurnSeen: null, // the turn already announced
    _cutTurnDropped: null, // the turn the person edited past (the strip stays gone)

    /** From GET /spaces/:id/cut (after cutReceive, so the revision is the one on screen). */
    cutApplyTurn(raw) {
        const turn = readTurn(raw, this.cutModel);
        this.cutTurn = turn;
        if (!turn) { this.cutTurnOpen = false; return; }
        if (turn.id !== this._cutTurnSeen && this.cutTurnShown()) {
            this._cutTurnSeen = turn.id;
            this.cutTurnOpen = false;
            this.cutAnnounce = turn.edits === 1 ? copy('turnArrivedOne') : copy('turnArrived', { n: turn.edits });
        }
    },

    /** The strip shows while the turn is still on top: the cut is at its revision, saved, and not edited since. */
    cutTurnShown() {
        const turn = this.cutTurn;
        return Boolean(turn) && turn.undoable && !this.cutDraft && turn.id !== this._cutTurnDropped
            && turn.revision === this.cutRevision && this.cutIsClean();
    },

    cutTurnHead() {
        return turnHead(this.cutTurn);
    },

    /** The person's own edit: the strip folds into the undo history (Ctrl+Z still steps back through the turn). */
    cutTurnEdited() {
        if (!this.cutTurn) return;
        this._cutTurnDropped = this.cutTurn.id;
        this.cutTurnOpen = false;
    },

    /** Show edits: lists the rows, marks every changed clip, selects the first and scrolls the lane to it. */
    cutTurnToggle() {
        this.cutTurnOpen = !this.cutTurnOpen;
        if (!this.cutTurnOpen) return;
        const keys = this.cutTurnKeys();
        if (keys.length) {
            this.cutSelectedKey = keys[0];
            this.cutReveal(keys[0]);
        }
        this.cutAnnounce = copy('turnMarked', { n: this.cutTurn?.edits ?? keys.length });
    },

    /** Lane keys of the clips this turn changed. */
    cutTurnKeys() {
        const turn = this.cutTurn;
        if (!turn) return [];
        const ids = new Set([...turn.changed, ...turn.rows.map((r) => r.item_id).filter(Boolean).map(String), ...turn.rows.map((r) => r.node_id).filter((n) => n != null).map(String)]);
        return this.cutItems.filter((i) => i.ready && (ids.has(String(i.node_id)) || ids.has(String(this.cutModel[i.clip]?.id)))).map((i) => i.key);
    },

    cutTurnRowItem(row) {
        if (!row) return null;
        return this.cutItems.find((i) => i.ready && ((row.item_id && this.cutModel[i.clip]?.id === row.item_id) || (row.node_id != null && i.node_id === row.node_id))) ?? null;
    },

    /** "s3-door  Trimmed −0.6 s" / "Music  Ducked −10 dB under 3 lines". */
    cutTurnRowLabel(row) {
        return row.beat_tag ? row.beat_tag : row.kind === 'sound' ? 'Music' : 'Cut';
    },

    /** A row: selects its clip, scrolls to it and moves the playhead there (a sound row seeks to its time). */
    cutTurnGo(row) {
        const item = this.cutTurnRowItem(row);
        if (!this.cutOpen) this.cutToggle();
        if (item) {
            this.cutSelectedKey = item.key;
            this.cutReveal(item.key);
        }
        this.$nextTick(() => {
            if (row.at_ms != null) this._cutPlayer?.seekExport(row.at_ms);
            else if (item) this._cutPlayer?.seek(item.board_ms);
        });
        this.cutAnnounce = `${this.cutTurnRowLabel(row)}: ${row.text}${row.why ? `. ${copy('turnWhy', { why: row.why })}` : ''}`;
    },

    /** Scrolls the lanes so a clip is in view (no smooth scroll under reduced motion). */
    cutReveal(key) {
        this.$nextTick(() => {
            const el = this.cutPart('scroll')?.querySelector?.(`[data-cut-key="${CSS.escape(key)}"]`);
            el?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: reduced() ? 'auto' : 'smooth' });
        });
    },

    /** What the item view draws for this turn: marked, locked, and the trimmed frames as ghosts (px). */
    cutTurnMark(item) {
        const none = { marked: false, locked: false, ghostIn: 0, ghostOut: 0 };
        if (!item?.ready || !this.cutTurnShown()) return none;
        const id = String(this.cutModel[item.clip]?.id ?? '');
        const turn = this.cutTurn;
        const row = turn.rows.find((r) => r.was && (String(r.item_id) === id || r.node_id === item.node_id));
        const pps = this.cutPps || 0;
        const ghostIn = row?.was?.in_ms != null ? Math.max(0, item.in_ms - row.was.in_ms) / 1000 * pps : 0;
        const ghostOut = row?.was?.out_ms != null ? Math.max(0, row.was.out_ms - item.out_ms) / 1000 * pps : 0;
        return {
            marked: this.cutTurnOpen && this.cutTurnKeys().includes(item.key),
            locked: turn.locked.includes(id),
            ghostIn: Math.round(ghostIn * 100) / 100,
            ghostOut: Math.round(ghostOut * 100) / 100,
        };
    },

    /** The stored reason for the selected clip's last Director edit ("why did you cut there?"), or ''. */
    cutTurnWhy(item) {
        if (!item?.ready || !this.cutTurn) return '';
        const id = this.cutModel[item.clip]?.id;
        const row = this.cutTurn.rows.find((r) => r.why && ((r.item_id && r.item_id === id) || (r.node_id != null && r.node_id === item.node_id)));
        return row ? copy('turnWhy', { why: row.why }) : '';
    },

    /** Undo turn: one press puts the whole turn back, only while it is still on top (the server checks the revision). */
    async cutUndoTurn() {
        const turn = this.cutTurn;
        if (!turn || this.cutTurnBusy || !this.cutTurnShown()) return;
        this.cutTurnBusy = true;
        try {
            const res = await fetch(`/spaces/${this.spaceId}/cut/undo-turn`, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
                body: JSON.stringify({ turn: Number.isFinite(Number(turn.id)) ? Number(turn.id) : turn.id, revision: this.cutRevision }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.cut) {
                const before = this.cutSnapshot();
                this.cutRevision = data.cut.revision ?? this.cutRevision + 1;
                this.cutSetBase(data.cut);
                this.cutCommit(copy('turnUndone'), { items: data.cut.items ?? [], sound: data.cut.sound ?? null }, { before, save: false });
                this.cutSaveState = 'saved';
                this.cutTurn = null;
                this.cutTurnOpen = false;
                this.cutAnnounce = copy('turnUndone');
                this.cutRefetchSoon();
                return;
            }
            // Refused (409 with the newer cut, or 422: later edits came after it): the strip goes; a newer cut is taken.
            if (res.status === 409 || res.status === 422) {
                this._cutTurnDropped = turn.id;
                this.cutTurnOpen = false;
                if (data?.cut) this.cutReceive(data.cut, { by: data.cut.updated_by ?? 'person' });
                this.cutAnnounce = copy('turnGone');
                return;
            }
            this.cutAnnounce = copy('turnFailed');
        } catch {
            this.cutAnnounce = copy('turnFailed');
        } finally {
            this.cutTurnBusy = false;
        }
    },

    /** Lane keys for the `changed` ids of a cut event (node ids from CutEdits; item ids also accepted). */
    cutKeysFor(ids) {
        const set = new Set(list(ids).map(String));
        return this.cutItems.filter((i) => i.ready && (set.has(String(i.node_id)) || set.has(String(this.cutModel[i.clip]?.id)))).map((i) => i.key);
    },
};

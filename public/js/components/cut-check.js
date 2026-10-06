// Check your cut (05-irresistible.md §3.6, 03-director.md §6): an honest checklist, never a virality guess.
// Spread into CutDock. The findings come from the server (BoardCut, P3; the timed P4 codes LINE_CUT_OFF,
// DEAD_AIR, LOUDNESS_OFF, MUSIC_ENDS_EARLY, SHORT carry `at_ms`, export time), so the list works with no
// Director key. It shows on the rail ("Check your cut · 3", its own sheet) and in the export sheet. Each line
// with a place has Show me (selects the clip, scrolls to it, puts the playhead on the time). A line whose fix
// needs a new take shows Go to card, never a render. Nothing to fix: "Ready" with a check mark, seam grey.
import { controlLabel } from '/shared/katana-controls.js';
import { fmtClock } from '/shared/cut-lanes.js';
import { toScreen } from '/shared/cut-timeline.js';

/** Codes whose fix is on the card (a new take), not in the cut: Go to card, never a render. */
export const CARD_FIXES = Object.freeze(['GAP', 'MISSING_FILE', 'STALE', 'SHORT', 'TAKES']);

const atMs = (f) => (Number.isFinite(Number(f?.at_ms)) && f.at_ms !== null ? Math.max(0, Math.round(Number(f.at_ms))) : null);

export const cutCheckMethods = {
    /** The findings as lines: timed ones first, in time order; the rest after, in the server's order. */
    cutChecks() {
        const lines = (this.cutFindings ?? []).map((f, i) => {
            const target = this.cutFindingItem(f);
            const at = atMs(f);
            return {
                key: `${f.code}:${i}`, code: f.code, text: f.text, target, at_ms: at,
                time: at != null ? fmtClock(at) : '',
                card: CARD_FIXES.includes(f.code) && (target?.node_id ?? f.node_id) != null,
                order: i,
            };
        });
        return lines.sort((a, b) => (a.at_ms ?? Infinity) - (b.at_ms ?? Infinity) || a.order - b.order);
    },

    /** The lane item a finding is about: by clip id (a split card's part), node id, beat tag; null for a whole-cut finding. */
    cutFindingItem(f) {
        if (f?.item_id != null) {
            const byId = this.cutItems.find((i) => i.ready && this.cutModel[i.clip]?.id === f.item_id);
            if (byId) return byId;
        }
        if (f?.node_id != null) {
            const byNode = this.cutItems.find((i) => i.node_id === f.node_id);
            if (byNode) return byNode;
        }
        if (f?.beat_tag) return this.cutItems.find((i) => i.ready && this.cutModel[i.clip]?.beat_tag === f.beat_tag) ?? null;
        return null;
    },

    cutCheckTitle() {
        const n = this.cutChecks().length;
        return n ? `${controlLabel('cut.check')} · ${n}` : controlLabel('cut.check');
    },

    /** The rail key shows when there is a cut to check. */
    cutCheckOnRail() {
        return this.cutStatus === 'ready' && !this.cutEmpty();
    },

    /** Show me: closes the sheet, opens the dock, selects the clip, scrolls to it and seeks to the finding's time. */
    cutShowMe(check) {
        const item = check?.target;
        if (!item && check?.at_ms == null) return;
        this.cutSheet = null;
        if (!this.cutOpen) this.cutToggle();
        if (item) {
            this.cutSelectedKey = item.key;
            this.cutReveal(item.key);
        }
        this.$nextTick(() => {
            if (check.at_ms != null) this._cutPlayer?.seekExport(check.at_ms);
            else this._cutPlayer?.seek(item.board_ms);
        });
        this.cutAnnounce = check.time ? `${check.time}: ${check.text}` : check.text;
    },

    /** Go to card for a finding whose fix is a new take. Never renders. */
    cutCheckCard(check) {
        const item = check?.target ?? null;
        const nodeId = item?.node_id ?? this.cutFindings?.find((f) => f.code === check?.code)?.node_id;
        if (nodeId == null) return;
        this.cutSheet = null;
        this.cutGoToCard(item ?? { node_id: nodeId, title: check.text });
    },

    /** Where a timed finding sits on the ruler (px), for the marker under the ruler. */
    cutCheckX(check) {
        if (check?.at_ms == null) return null;
        return Math.round(toScreen(this.cutLay(), check.at_ms) / 1000 * (this.cutPps || 0) * 100) / 100;
    },
};

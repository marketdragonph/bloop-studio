// The live cut, on the dock's side (05-irresistible.md §2.1). Spread into CutDock.
// - While `cutAuto` is on (the person has not edited), clips the server placed by itself arrive as a `cut` event and
//   are adopted quietly as "Placed in beat order". The first save of the person's own edit turns auto off on the
//   server; the live region then says "You edited the cut. New clips now wait for you."
// - A placement that lands while the person's edit is unsaved is rebased (src/shared/cut-rebase.js): the edit stays,
//   the placed clips join it, and no "changed in another window" banner appears.
// - Afterwards, later clips light Add new clips (POST …/cut/draft add_new), which never moves the person's items.
import { controlLabel, copy } from '/shared/katana-controls.js';
import { rebaseAuto } from '/shared/cut-rebase.js';

export const cutAutoMethods = {
    /** The server copy the dock's items started from (what a rebase compares against). */
    cutSetBase(cut) {
        this._cutBase = cut ? { items: cut.items ?? [], sound: cut.sound ?? null } : null;
    },

    /** A 200 from our own save: remember the server copy, and say once that the live cut is now off. */
    cutAfterSave(cut) {
        this.cutSetBase(cut);
        if (this.cutAuto && cut?.auto === false) {
            this.cutAuto = false;
            this.cutAnnounce = copy('autoOff');
        }
    },

    /**
     * The server moved on while the person's edit is unsaved. Returns true when only live-cut placements differ:
     * the dock then shows the edit with those clips added, takes the revision, and saves on top.
     */
    cutTryRebase(server) {
        const merged = rebaseAuto(this._cutBase, this.cutSnapshot(), { items: server?.items ?? [], sound: server?.sound ?? null });
        if (!merged) return false;
        this.cutRevision = server.revision ?? this.cutRevision;
        this.cutSetBase(server);
        if (server.auto === false) this.cutAuto = false;
        this.cutRestore(merged); // saves, with the new revision
        return true;
    },

    /** Ready clips on the board that are not in the cut (Add new clips). */
    cutNewCount() {
        if (this.cutDraft) return 0;
        const inCut = new Set(this.cutModel.map((item) => item.node_id));
        return (this._cutSlots ?? []).filter((s) => s.state === 'ready' && s.node_id != null && !inCut.has(s.node_id)).length;
    },

    /** Add new clips shows once the live cut is off (or on a board with no plan, where it never runs). */
    cutCanAddNew() {
        return this.cutStatus === 'ready' && (!this.cutAuto || this.cutGuessed) && this.cutNewCount() > 0;
    },

    cutAddNewText() {
        return copy('addNewCount', { label: controlLabel('cut.addNew'), n: this.cutNewCount() });
    },
};

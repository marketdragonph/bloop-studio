// TurnLedger (ported from bloop): what a turn actually did, written by the tools as they run, so the closing
// words can never claim work that did not land (and a turn that changed the board but said nothing still speaks).
export class TurnLedger {
    constructor() {
        this.proposals = 0;
        this.refusals = 0;
        this.nodeIds = [];
        this.wires = 0;
        this.actions = [];
        this.questions = null; // set by plan_board: the questions asked this turn
        this.built = false; // build_board queued beats
        this.audited = false;
        // The Cut (P4): the turn's cut_turns row, its cut writes, a draft that landed, and the cut critic's one run.
        this.cutTurnId = null;
        this.cutEdits = [];
        this.cutProposals = 0;
        this.cutRefusals = 0;
        this.drafted = false;
        this.cutAudited = false;
    }

    planned(questions = []) { this.questions = questions; }
    queued() { this.built = true; }
    refused() { this.proposals += 1; this.refusals += 1; }

    /** A cut write that landed: propose_cut_ops, a draft, an undo. */
    recordCut({ edits = 0, changed = [], drafted = false, undo = false } = {}) {
        this.proposals += 1;
        this.cutProposals += 1;
        this.cutEdits.push({ edits, changed, undo });
        if (drafted) this.drafted = true;
    }

    /** A cut write that was refused (or a draft that wrote nothing). */
    cutRefused() {
        this.proposals += 1;
        this.refusals += 1;
        this.cutProposals += 1;
        this.cutRefusals += 1;
    }

    record(applied) {
        this.proposals += 1;
        this.nodeIds.push(...applied.nodes.map((n) => n.id), ...applied.updated.map((n) => n.id));
        this.wires += applied.connections.length;
        this.actions.push(...applied.actions);
    }

    /** The critic runs once per turn, on the first apply that lands. */
    claimAudit() {
        if (this.audited) return false;
        this.audited = true;
        return true;
    }

    /** The cut critic runs once per turn, on the first cut write that lands. */
    claimCutAudit() {
        if (this.cutAudited) return false;
        this.cutAudited = true;
        return true;
    }

    touchedCut() { return this.cutEdits.length > 0; }
    touched() { return this.nodeIds.length > 0 || this.wires > 0 || this.touchedCut(); }
    /** Every proposal this turn was a cut one (the closing words then speak of the cut, not the board). */
    onlyCut() { return this.cutProposals > 0 && this.cutProposals === this.proposals; }
    proposed() { return this.proposals > 0; }
    plannedThisTurn() { return this.questions !== null; }
}

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
    }

    planned(questions = []) { this.questions = questions; }
    queued() { this.built = true; }
    refused() { this.proposals += 1; this.refusals += 1; }

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

    touched() { return this.nodeIds.length > 0 || this.wires > 0; }
    proposed() { return this.proposals > 0; }
    plannedThisTurn() { return this.questions !== null; }
}

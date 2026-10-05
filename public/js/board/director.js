// The Director panel: chat log, a background run per request (it keeps going when the panel closes
// or the page reloads, and carries on by itself when it runs out of steps; its words and board
// changes arrive on the board's event stream), Stop, live board refresh as actions land, and one undo step per turn.
import { api } from './api.js';

export const directorMethods = {
    async toggleDirector() {
        this.directorOpen = !this.directorOpen;
        if (this.directorOpen && !this.directorLoaded) await this.loadDirector();
        if (this.directorOpen) this.$nextTick(() => this.$refs.directorInput?.focus());
    },

    /** The log, plus the run still going on this board (opened mid-turn, or after a reload). */
    async loadDirector() {
        try {
            const { log, running } = await api('GET', `${this.base}/director`);
            this.directorLog = log;
            this.directorLoaded = true;
            if (running) {
                // The person's message is already in the saved log: only the reply in progress is added.
                this.followRun(running.runId, { text: running.text, actions: [...running.actions], info: running.info, activity: running.activity });
            }
            this.scrollDirector();
        } catch (error) {
            this.toast(error.message, 'alert');
        }
    },

    /**
     * Brings the board in line with the server. Cards are updated in place and only new ones are added,
     * so a Director build redraws what changed, not all 60 cards for every card it adds (that lagged).
     */
    async refreshBoard({ tidy = true } = {}) {
        const board = await api('GET', `${this.base}/board.json`);
        const fresh = new Map(board.nodes.map((n) => [n.id, n]));
        this.nodes = this.nodes.filter((n) => fresh.has(n.id));
        for (const n of board.nodes) {
            const current = this.nodeById(n.id);
            // Live render state (progress, label) is the event stream's, not the saved row's.
            if (current) Object.assign(current, { ...n, progress: current.progress, progressLabel: current.progressLabel });
            else this.nodes.push(n);
        }
        const same = board.connections.length === this.connections.length && board.connections.every((c, i) => c.id === this.connections[i]?.id);
        if (!same) this.connections = board.connections;
        if (tidy) this.tidyAfterRender();
    },

    /** While the Director builds: at most two board refreshes a second, the last one after its final change. */
    refreshSoon() {
        if (this._refreshTimer) return;
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            this.refreshBoard({ tidy: false }).catch(() => {});
        }, 500);
    },

    async sendDirector() {
        const message = this.directorInput.trim();
        if (!message || this.directorBusy) return;
        this.directorInput = '';
        this.directorBusy = true;
        this.directorLog.push({ id: `u${Date.now()}`, role: 'user', text: message, actions: [] });
        this.scrollDirector();
        try {
            const { runId } = await api('POST', `${this.base}/director`, { message });
            this.followRun(runId);
        } catch (error) {
            this.directorBusy = false;
            this.directorLog.push({ id: `n${Date.now()}`, role: 'notice', text: error.message, actions: [] });
            this.scrollDirector();
        }
    },

    /** Shows a run's reply bubble; its events arrive through onDirectorStream. */
    followRun(runId, partial = {}) {
        this.directorBusy = true;
        this.directorRunId = runId;
        this.directorLog.push({ id: `a${runId}`, runId, role: 'assistant', text: partial.text ?? '', actions: partial.actions ?? [], info: partial.info ?? null, activity: partial.activity ?? null, streaming: true });
        this.scrollDirector();
    },

    /** One event of a Director run on this board, from the board's event stream (generation.js). */
    onDirectorStream({ runId, event, data }) {
        if (event === 'actions') this.refreshSoon();
        // Write through Alpine's reactive copy: mutating a plain object would never repaint the bubble.
        let reply = this.directorLog.find((entry) => entry.runId === runId);
        if (!reply) {
            if (!this.directorLoaded) return; // the panel loads the whole run when it opens
            this.followRun(runId);
            reply = this.directorLog.at(-1);
        }
        if (event === 'text') reply.text += data.delta;
        if (event === 'actions') reply.actions.push(...data.actions);
        if (event === 'notice') reply.info = data.message;
        if (event === 'activity') reply.activity = data.label;
        if (event === 'done' || event === 'error') {
            reply.streaming = false;
            reply.notice = event === 'error' ? data.message : data.notice;
            this.directorBusy = false;
            this.directorRunId = null;
            this.refreshBoard().catch(() => {});
            this.recordDirectorTurn(reply.actions);
        }
        this.scrollDirector();
    },

    async stopDirector() {
        try {
            await api('POST', `${this.base}/director/stop`);
        } catch (error) {
            this.toast(error.message, 'warn');
        }
    },

    /** One undo step for the whole turn: removes the cards and wires it added, restores edited text. */
    recordDirectorTurn(actions) {
        if (!actions.length) return;
        const cards = actions.filter((a) => a.kind === 'card').map((a) => a.nodeId);
        const wires = actions.filter((a) => a.kind === 'wire').map((a) => a.connectionId);
        const edits = actions.filter((a) => a.kind === 'update');
        let snapshots = [];
        this.history.push({
            label: 'Director turn',
            undo: async () => {
                snapshots = cards.map((id) => ({ node: JSON.parse(JSON.stringify(this.nodeById(id) ?? null)) })).filter((s) => s.node);
                const wireSnapshots = this.connections.filter((c) => wires.includes(c.id));
                snapshots.wires = wireSnapshots;
                for (const id of wires) await api('DELETE', `${this.base}/connections/${id}`).catch(() => {});
                for (const id of cards) await api('DELETE', `${this.base}/nodes/${id}`).catch(() => {});
                for (const e of edits) await api('PATCH', `${this.base}/nodes/${e.nodeId}`, e.before).catch(() => {});
                await this.refreshBoard();
            },
            redo: async () => {
                for (const { node } of snapshots) await api('POST', `${this.base}/nodes/${node.id}/restore`, { node, connections: [] });
                for (const w of snapshots.wires ?? []) await api('POST', `${this.base}/connections`, { from_node_id: w.from_node_id, to_node_id: w.to_node_id, to_socket: w.to_socket }).catch(() => {});
                await this.refreshBoard();
            },
        });
    },

    async clearDirector() {
        if (!window.confirm('Clear this conversation? The board stays as it is.')) return;
        try {
            await api('DELETE', `${this.base}/director`);
            this.directorLog = [];
        } catch (error) {
            this.toast(error.message, 'warn');
        }
    },

    onDirectorKey(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendDirector();
        }
    },

    scrollDirector() {
        this.$nextTick(() => {
            const log = this.$refs.directorLog;
            if (log) log.scrollTop = log.scrollHeight;
        });
    },

    /** "Adding cards · 12 cards · 8 wires": what the Director is doing, and what has landed so far. */
    workingLabel(entry) {
        const done = this.actionSummary(entry.actions || []);
        return [`${entry.activity || 'Reading the board'}…`, done].filter(Boolean).join(' · ');
    },

    actionSummary(actions) {
        const cards = actions.filter((a) => a.kind === 'card').length;
        const wires = actions.filter((a) => a.kind === 'wire').length;
        const edits = actions.filter((a) => a.kind === 'update').length;
        return [cards && `${cards} card${cards > 1 ? 's' : ''}`, wires && `${wires} wire${wires > 1 ? 's' : ''}`, edits && `${edits} edit${edits > 1 ? 's' : ''}`]
            .filter(Boolean).join(' · ');
    },
};

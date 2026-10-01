// The Director panel: chat log, a streamed turn over fetch (SSE body), live board refresh as
// actions land, Stop, and one undo step per turn (undo removes what the turn added).
import { api } from './api.js';

const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content ?? '';
const CONTROLLERS = new WeakMap();

/** Minimal SSE parser over a fetch body: calls onEvent(name, data) per event. */
async function readSSE(response, onEvent) {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const event = block.match(/^event: (.*)$/m)?.[1] ?? 'message';
            const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
            if (data) onEvent(event, JSON.parse(data));
        }
    }
}

export const directorMethods = {
    async toggleDirector() {
        this.directorOpen = !this.directorOpen;
        if (this.directorOpen && !this.directorLoaded) {
            try {
                this.directorLog = await api('GET', `${this.base}/director`);
                this.directorLoaded = true;
            } catch (error) {
                this.toast(error.message, 'alert');
            }
        }
        if (this.directorOpen) this.$nextTick(() => this.$refs.directorInput?.focus());
    },

    async refreshBoard() {
        const board = await api('GET', `${this.base}/board.json`);
        // Keep live render state for cards that are still rendering.
        const live = new Map(this.nodes.map((n) => [n.id, n]));
        this.nodes = board.nodes.map((n) => ({ ...n, progress: live.get(n.id)?.progress, progressLabel: live.get(n.id)?.progressLabel }));
        this.connections = board.connections;
        this.tidyAfterRender();
    },

    async sendDirector() {
        const message = this.directorInput.trim();
        if (!message || this.directorBusy) return;
        this.directorInput = '';
        this.directorBusy = true;
        this.directorLog.push({ id: `u${Date.now()}`, role: 'user', text: message, actions: [] });
        this.directorLog.push({ id: `a${Date.now()}`, role: 'assistant', text: '', actions: [], streaming: true });
        // Write through Alpine's reactive copy: mutating the plain object would never repaint the bubble.
        const reply = this.directorLog[this.directorLog.length - 1];
        this.scrollDirector();

        const controller = new AbortController();
        CONTROLLERS.set(this.$refs.board, controller);
        try {
            const response = await fetch(`${this.base}/director`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
                body: JSON.stringify({ message }),
                signal: controller.signal,
            });
            if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Request failed (${response.status}).`);
            await readSSE(response, (event, data) => this.onDirectorEvent(reply, event, data));
        } catch (error) {
            if (error.name !== 'AbortError') reply.notice = error.message;
        } finally {
            reply.streaming = false;
            this.directorBusy = false;
            await this.refreshBoard().catch(() => {});
            this.recordDirectorTurn(reply.actions);
            this.scrollDirector();
        }
    },

    onDirectorEvent(reply, event, data) {
        if (event === 'text') reply.text += data.delta;
        if (event === 'actions') {
            reply.actions.push(...data.actions);
            this.refreshBoard().catch(() => {});
        }
        if (event === 'notice') reply.info = data.message;
        if (event === 'done' && data.notice) reply.notice = data.notice;
        if (event === 'error') reply.notice = data.message;
        this.scrollDirector();
    },

    stopDirector() {
        CONTROLLERS.get(this.$refs.board)?.abort();
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
        await api('DELETE', `${this.base}/director`);
        this.directorLog = [];
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

    actionSummary(actions) {
        const cards = actions.filter((a) => a.kind === 'card').length;
        const wires = actions.filter((a) => a.kind === 'wire').length;
        const edits = actions.filter((a) => a.kind === 'update').length;
        return [cards && `${cards} card${cards > 1 ? 's' : ''}`, wires && `${wires} wire${wires > 1 ? 's' : ''}`, edits && `${edits} edit${edits > 1 ? 's' : ''}`]
            .filter(Boolean).join(' · ');
    },
};

// Cards: create, edit, delete (all undoable), selection and keyboard shortcuts.
import { api } from './api.js';
import { NODE_TYPES } from '/shared/node-types.js';

const TEXT_SAVE_DELAY = 600;
const textTimers = new Map();

export const cardMethods = {
    nodeById(id) {
        return this.nodes.find((n) => n.id === id);
    },

    selectedNodes() {
        return this.nodes.filter((n) => this.selectedNodeIds.includes(n.id));
    },

    isSelected(node) {
        return this.selectedNodeIds.includes(node.id);
    },

    clearSelection() {
        if (this.selectedNodeIds.length) this.selectedNodeIds = [];
        if (this.selectedConnectionId !== null) this.selectedConnectionId = null;
    },

    selectCard(event, node) {
        if (event.shiftKey) {
            this.selectedNodeIds = this.isSelected(node)
                ? this.selectedNodeIds.filter((id) => id !== node.id)
                : [...this.selectedNodeIds, node.id];
        } else if (!this.isSelected(node)) {
            this.selectedNodeIds = [node.id];
        }
        this.selectedConnectionId = null;
    },

    finishMarquee() {
        const m = this.marquee;
        this.marquee = null;
        if (!m) return;
        const [x1, x2] = [Math.min(m.x1, m.x2), Math.max(m.x1, m.x2)];
        const [y1, y2] = [Math.min(m.y1, m.y2), Math.max(m.y1, m.y2)];
        this.selectedNodeIds = this.nodes
            .filter((n) => n.position_x >= x1 && n.position_x <= x2 && n.position_y >= y1 && n.position_y <= y2)
            .map((n) => n.id);
    },

    /** Where a new card goes: right of the selected card (ready to wire), else the view's centre. */
    placementFor() {
        const anchor = this.selectedNodes().at(-1) ?? this.nodes.at(-1);
        if (anchor) return { x: anchor.position_x + (anchor.width || 280) + 100, y: anchor.position_y };
        const rect = this.$refs.board.getBoundingClientRect();
        const center = this.toBoard(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { x: center.x - 140, y: center.y - 80 };
    },

    /** Pans just enough to show a card that landed outside the visible board (never zooms). */
    bringIntoView(node, margin = 40) {
        const rect = this.$refs.board.getBoundingClientRect();
        const left = node.position_x * this.zoom + this.panX;
        const top = node.position_y * this.zoom + this.panY;
        const width = (node.width || 280) * this.zoom;
        const height = 240 * this.zoom;
        if (left + width > rect.width - margin) this.panX -= left + width - rect.width + margin;
        if (left < margin) this.panX += margin - left;
        if (top + height > rect.height - margin) this.panY -= top + height - rect.height + margin;
        if (top < margin) this.panY += margin - top;
        this.markViewChanged();
    },

    async addCard(type) {
        const at = this.placementFor();
        try {
            const node = await api('POST', `${this.base}/nodes`, {
                type,
                position_x: Math.round(at.x / 20) * 20,
                position_y: Math.round(at.y / 20) * 20,
            });
            this.nodes.push(node);
            this.selectedNodeIds = [node.id];
            this.applyStickyDefaults(node);
            this.bringIntoView(node);
            let current = node;
            this.history.push({
                label: `Add ${NODE_TYPES[type].label} card`,
                undo: async () => { await this.removeCard(current.id, { record: false }); },
                redo: async () => { current = await this.restoreCard(current, []); },
            });
        } catch (error) {
            this.toast(error.message, 'warn');
        }
    },

    async updateCard(node, changes) {
        Object.assign(node, changes);
        try {
            await api('PATCH', `${this.base}/nodes/${node.id}`, changes);
        } catch (error) {
            this.toast(`Not saved: ${error.message}`, 'alert');
        }
    },

    /** Typing saves after a short pause; the undo entry holds the text from before the burst. */
    editText(node, field, value) {
        const key = `${node.id}:${field}`;
        const pending = textTimers.get(key);
        const before = pending ? pending.before : node[field];
        node[field] = value;
        clearTimeout(pending?.timer);
        const timer = setTimeout(async () => {
            textTimers.delete(key);
            await this.updateCard(node, { [field]: value });
            this.history.push({
                label: 'Edit text',
                undo: () => this.updateCard(this.nodeById(node.id), { [field]: before }),
                redo: () => this.updateCard(this.nodeById(node.id), { [field]: value }),
            });
        }, TEXT_SAVE_DELAY);
        textTimers.set(key, { timer, before });
    },

    async removeCard(id, { record = true } = {}) {
        const node = this.nodeById(id);
        if (!node) return;
        const wires = this.connections.filter((c) => c.from_node_id === id || c.to_node_id === id);
        await api('DELETE', `${this.base}/nodes/${id}`);
        this.nodes = this.nodes.filter((n) => n.id !== id);
        this.connections = this.connections.filter((c) => !wires.includes(c));
        this.selectedNodeIds = this.selectedNodeIds.filter((sid) => sid !== id);
        if (record) {
            const snapshot = JSON.parse(JSON.stringify(node));
            this.history.push({
                label: 'Delete card',
                undo: async () => { await this.restoreCard(snapshot, wires); },
                redo: async () => { await this.removeCard(id, { record: false }); },
            });
        }
    },

    async restoreCard(snapshot, wires) {
        const node = await api('POST', `${this.base}/nodes/${snapshot.id}/restore`, { node: snapshot, connections: wires });
        this.nodes.push(node);
        // Only wires whose other end still exists come back.
        this.connections.push(...wires.filter((w) => this.nodeById(w.from_node_id) && this.nodeById(w.to_node_id)));
        return node;
    },

    async deleteSelection() {
        if (this.selectedConnectionId !== null) return this.disconnect(this.selectedConnectionId);
        for (const id of [...this.selectedNodeIds]) await this.removeCard(id);
    },

    /** Drag finished: one undo step for the whole move, then save the new geometry. */
    commitDrag(starts) {
        const ends = new Map(this.selectedNodes().map((n) => [n.id, { x: n.position_x, y: n.position_y }]));
        const place = (positions) => {
            for (const [id, p] of positions) {
                const n = this.nodeById(id);
                if (n) Object.assign(n, { position_x: p.x, position_y: p.y });
            }
            this.markGeometryChanged();
        };
        this.history.push({ label: 'Move cards', undo: () => place(starts), redo: () => place(ends) });
        this.markGeometryChanged();
    },

    async onKeyDown(event) {
        const typing = event.target.closest('input, textarea, [contenteditable="true"]');
        if (event.code === 'Space' && !typing) { this.spaceHeld = true; return; }
        if (typing) return;

        const mod = event.ctrlKey || event.metaKey;
        try {
            if (mod && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                await (event.shiftKey ? this.history.redo() : this.history.undo());
            } else if (mod && event.key.toLowerCase() === 'y') {
                event.preventDefault();
                await this.history.redo();
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                await this.deleteSelection();
            } else if (event.key === 'Escape') {
                if (this.viewer) return this.closeViewer();
                this.cancelWire();
                this.clearSelection();
            }
        } catch (error) {
            this.toast(error.message, 'alert');
        }
    },

    onKeyUp(event) {
        if (event.code === 'Space') this.spaceHeld = false;
    },
};

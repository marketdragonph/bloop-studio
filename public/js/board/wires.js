// Wires as circuit traces (straight runs, 45° chamfered bends), ported from bloop's
// connections.js. Each wire keeps its own SVG elements in a WeakMap and only changed
// attributes are rewritten, so dragging a card touches only its own wires.
import { api } from './api.js';
import { checkConnection, socketsOf, socketAccepts } from '/shared/node-types.js';

const SVG = 'http://www.w3.org/2000/svg';
const PORT_TOP = 8;
const PORT_PITCH = 40;
const PORT_HALF = 18;
const STUB = 22;
const CHAMFER = 14;
const WIRES = new WeakMap();

export function socketY(node, socketKey) {
    const index = Math.max(0, socketsOf(node.type).findIndex((s) => s.key === socketKey));
    return node.position_y + PORT_TOP + index * PORT_PITCH + PORT_HALF;
}

export const outputY = (node) => node.position_y + PORT_TOP + PORT_HALF;
// Sockets are centred on the card edge; wires run to the centre and the socket covers the end.
const outputX = (node) => node.position_x + (node.width || 280);

export function routeTrace(x1, y1, x2, y2) {
    if (Math.abs(y2 - y1) <= 6) y2 = y1; // within a few px of level is level
    const raw = [[x1, y1], [x1 + STUB, y1]];
    if (x2 - x1 >= STUB * 2 + 2) {
        const xm = (x1 + x2) / 2;
        raw.push([xm, y1], [xm, y2]);
    } else {
        const ym = (y1 + y2) / 2; // target is behind the source: cross at mid-height
        raw.push([x1 + STUB, ym], [x2 - STUB, ym]);
    }
    raw.push([x2 - STUB, y2], [x2, y2]);

    const pts = raw.filter((p, i) => i === 0 || Math.abs(p[0] - raw[i - 1][0]) > 0.01 || Math.abs(p[1] - raw[i - 1][1]) > 0.01);
    const turns = pts.filter((p, i) => {
        if (i === 0 || i === pts.length - 1) return true;
        const [ax, ay] = pts[i - 1];
        const [cx, cy] = pts[i + 1];
        return Math.abs((p[0] - ax) * (cy - p[1]) - (p[1] - ay) * (cx - p[0])) > 0.01;
    });
    return chamfer(turns);
}

function chamfer(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        const [cx, cy] = pts[i + 1];
        const inLen = Math.hypot(bx - ax, by - ay);
        const outLen = Math.hypot(cx - bx, cy - by);
        const c = Math.min(CHAMFER, inLen / 2, outLen / 2);
        if (c < 1) { out.push([bx, by]); continue; }
        out.push([bx + ((ax - bx) / inLen) * c, by + ((ay - by) / inLen) * c]);
        out.push([bx + ((cx - bx) / outLen) * c, by + ((cy - by) / outLen) * c]);
    }
    out.push(pts.at(-1));
    return out;
}

const toPath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

function makeWire(id) {
    const el = (tag, attrs) => {
        const node = document.createElementNS(SVG, tag);
        for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
        return node;
    };
    const group = el('g', { 'data-conn-id': id, class: 'wire' });
    const line = el('path', { class: 'wire__line' });
    const hit = el('path', { class: 'wire__hit' });
    group.append(line, hit);
    return { group, line, hit, d: null, cls: null };
}

export const wireMethods = {
    /** Called from an x-effect: reads every position, so it re-runs exactly when a wire could move. */
    syncWires() {
        const layer = this.$refs.wires;
        if (!layer) return;
        if (!WIRES.has(layer)) WIRES.set(layer, new Map());
        const wires = WIRES.get(layer);
        const byId = new Map(this.nodes.map((n) => [n.id, n]));
        const seen = new Set();

        for (const conn of this.connections) {
            const from = byId.get(conn.from_node_id);
            const to = byId.get(conn.to_node_id);
            if (!from || !to) continue;
            const d = toPath(routeTrace(outputX(from), outputY(from), to.position_x, socketY(to, conn.to_socket)));
            const cls = `wire${this.selectedConnectionId === conn.id ? ' is-selected' : ''}${from.status === 'generating' ? ' is-live' : ''}`;

            let wire = wires.get(conn.id);
            if (!wire) {
                wire = makeWire(conn.id);
                wires.set(conn.id, wire);
                layer.append(wire.group);
            }
            if (wire.d !== d) {
                wire.d = d;
                wire.line.setAttribute('d', d);
                wire.hit.setAttribute('d', d);
            }
            if (wire.cls !== cls) {
                wire.cls = cls;
                wire.group.setAttribute('class', cls);
            }
            seen.add(conn.id);
        }

        for (const [id, wire] of wires) {
            if (!seen.has(id)) {
                wire.group.remove();
                wires.delete(id);
            }
        }
    },

    previewPath() {
        const p = this.wireDraft;
        return p ? toPath(routeTrace(p.x1, p.y1, p.x2, p.y2)) : '';
    },

    startWire(event, node) {
        event.stopPropagation();
        const at = this.toBoard(event.clientX, event.clientY);
        this.wireDraft = { fromId: node.id, x1: outputX(node), y1: outputY(node), x2: at.x, y2: at.y };
    },

    trackWirePreview(event) {
        if (!this.wireDraft) return;
        const at = this.toBoard(event.clientX, event.clientY);
        this.wireDraft = { ...this.wireDraft, x2: at.x, y2: at.y };
    },

    cancelWire() {
        this.wireDraft = null;
    },

    /** Dropped on a card body (auto-pick a socket) or on one socket (socketKey). */
    async finishWire(event, toNode, socketKey = null) {
        if (!this.wireDraft) return;
        event.stopPropagation();
        const from = this.nodeById(this.wireDraft.fromId);
        this.wireDraft = null;
        const verdict = checkConnection({ from, to: toNode, existing: this.connections, socketKey });
        if (!verdict.ok) return this.toast(verdict.reason, 'warn');
        await this.connect(from.id, toNode.id, { socket: verdict.socket });
    },

    /** While a wire is being drawn: 'live' (can take it), 'blocked' (cannot), or '' (no wire). */
    socketState(node, socket) {
        if (!this.wireDraft) return '';
        const from = this.nodeById(this.wireDraft.fromId);
        if (!from || from.id === node.id) return 'blocked';
        const taken = !socket.multiple && this.connections.some((c) => c.to_node_id === node.id && c.to_socket === socket.key);
        return !taken && socketAccepts(from, node, socket.key) ? 'live' : 'blocked';
    },

    isSocketConnected(node, socket) {
        return this.connections.some((c) => c.to_node_id === node.id && c.to_socket === socket.key);
    },

    async connect(fromId, toId, { record = true, socket = null } = {}) {
        try {
            const conn = await api('POST', `${this.base}/connections`, { from_node_id: fromId, to_node_id: toId, to_socket: socket });
            this.connections.push(conn);
            if (record) {
                let current = conn;
                this.history.push({
                    label: 'Connect cards',
                    undo: async () => { await this.disconnect(current.id, { record: false }); },
                    redo: async () => { current = await this.connect(fromId, toId, { record: false, socket: current.to_socket }); },
                });
            }
            return conn;
        } catch (error) {
            this.toast(error.message, 'warn');
            throw error;
        }
    },

    async disconnect(connId, { record = true } = {}) {
        const conn = this.connections.find((c) => c.id === connId);
        if (!conn) return;
        await api('DELETE', `${this.base}/connections/${connId}`);
        this.connections = this.connections.filter((c) => c.id !== connId);
        if (this.selectedConnectionId === connId) this.selectedConnectionId = null;
        if (record) {
            let current = conn;
            this.history.push({
                label: 'Remove wire',
                undo: async () => { current = await this.connect(current.from_node_id, current.to_node_id, { record: false, socket: current.to_socket }); },
                redo: async () => { await this.disconnect(current.id, { record: false }); },
            });
        }
    },

    onWireClick(event) {
        const group = event.target.closest('[data-conn-id]');
        if (!group) return;
        event.stopPropagation();
        this.selectedConnectionId = Number(group.dataset.connId);
        this.selectedNodeIds = [];
    },

    socketTop(index) {
        return PORT_TOP + index * PORT_PITCH;
    },
};

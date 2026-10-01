// The Space board: Alpine component composed from small single-purpose modules.
import { createHistory } from './history.js';
import { gestureMethods } from './gestures.js';
import { wireMethods } from './wires.js';
import { cardMethods } from './cards.js';
import { persistenceMethods } from './persistence.js';
import { NODE_TYPES, socketsOf } from '/shared/node-types.js';

export default function SpaceBoard() {
    return {
        // Reactive board state
        spaceId: null,
        base: '',
        nodes: [],
        connections: [],
        zoom: 1,
        panX: 0,
        panY: 0,
        selectedNodeIds: [],
        selectedConnectionId: null,
        marquee: null,
        wireDraft: null,
        spaceHeld: false,
        saveState: 'saved',
        canUndo: false,
        canRedo: false,
        toasts: [],
        nodeTypes: NODE_TYPES,
        history: null,

        init() {
            const data = JSON.parse(this.$refs.boardData.textContent);
            this.spaceId = data.space.id;
            this.base = `/spaces/${data.space.id}`;
            this.nodes = data.nodes;
            this.connections = data.connections;
            Object.assign(this, data.space.canvas_state);

            this.history = createHistory({
                onChange: () => {
                    this.canUndo = this.history.canUndo();
                    this.canRedo = this.history.canRedo();
                },
            });
            this.initGestures();
            this.initPersistence();
        },

        destroy() {
            this.destroyGestures();
        },

        socketsOf(node) {
            return socketsOf(node.type);
        },

        typeLabel(node) {
            return NODE_TYPES[node.type]?.label ?? node.type;
        },

        mediaUrl(node) {
            return node.media_path ? `/media/${encodeURI(node.media_path)}` : null;
        },

        async undo() {
            try { await this.history.undo(); } catch (error) { this.toast(error.message, 'alert'); }
        },

        async redo() {
            try { await this.history.redo(); } catch (error) { this.toast(error.message, 'alert'); }
        },

        toast(message, tone = 'info') {
            const id = Date.now() + Math.random();
            this.toasts.push({ id, message, tone });
            setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, 5000);
        },

        ...gestureMethods,
        ...wireMethods,
        ...cardMethods,
        ...persistenceMethods,
    };
}

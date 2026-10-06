// The Space board: Alpine component composed from small single-purpose modules.
import { createHistory } from './history.js';
import { gestureMethods } from './gestures.js';
import { wireMethods } from './wires.js';
import { cardMethods } from './cards.js';
import { persistenceMethods } from './persistence.js';
import { generationMethods } from './generation.js';
import { uploadMethods } from './uploads.js';
import { directorMethods } from './director.js';
import { knobMethods } from './knobs.js';
import { viewerMethods } from './viewer.js';
import { layoutMethods } from './layout.js';
import { NODE_TYPES, socketsOf } from '/shared/node-types.js';
import { icon } from '/shared/icons.js';
import { EMPTY_TEXT, copy } from '/shared/katana-controls.js';
import { ghostPeaks, wavePath } from '/shared/cut-lanes.js';

const GHOST_WAVE = wavePath(ghostPeaks());

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
        wireEnd: null, // the loose end of the wire being drawn (board coordinates)
        spaceHeld: false,
        saveState: 'saved',
        canUndo: false,
        canRedo: false,
        toasts: [],
        nodeTypes: NODE_TYPES,
        families: { image: [], video: [], audio: [] },
        streamDown: false,
        renderQueue: [],
        directorOpen: false,
        directorLoaded: false,
        directorBusy: false,
        directorRunId: null, // the Director run going on this board (it runs in the background)
        directorBuild: null, // the beats being written: { total, written, failed, building, lanes }
        directorInput: '',
        directorLog: [],
        viewer: null,
        history: null,
        // First run (P2b): the empty bay's ghost strip, Ask the Director only with a key, the render readout key.
        emptyText: EMPTY_TEXT,
        ghostWave: GHOST_WAVE,
        directorReady: false,
        cutMissing: 0,

        init() {
            const data = JSON.parse(this.$refs.boardData.textContent);
            this.spaceId = data.space.id;
            this.base = `/spaces/${data.space.id}`;
            this.nodes = data.nodes;
            this.connections = data.connections;
            Object.assign(this, data.space.canvas_state);
            this.directorReady = this.$el.dataset.directorReady === '1';

            this.history = createHistory({
                onChange: () => {
                    this.canUndo = this.history.canUndo();
                    this.canRedo = this.history.canRedo();
                },
            });
            this.initGestures();
            this.initPersistence();
            this.initGeneration();
        },

        destroy() {
            this.destroyGestures();
            this.destroyGeneration();
        },

        socketsOf(node) {
            return socketsOf(node.type);
        },

        iconSvg(name) {
            return icon(name);
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

        /** "Render 7 missing beats", the same key as the Cut's rail (it opens the dock's sheet). */
        renderMissingLabel() {
            return copy('renderKey', { n: this.cutMissing });
        },

        /** Files dropped on the EMPTY board are Bring my clips (the Cut dock does the work, cut-bring.js). */
        bringDrop(event) {
            const files = event.dataTransfer?.files;
            if (this.nodes.length || !files?.length) return;
            window.dispatchEvent(new CustomEvent('cut:bring', { detail: { files: [...files] } }));
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
        ...generationMethods,
        ...uploadMethods,
        ...directorMethods,
        ...knobMethods,
        ...viewerMethods,
        ...layoutMethods,
    };
}

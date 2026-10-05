// ⚡ Generate / cancel, the model family picker, seed lock, and live progress from the
// server's event stream (no polling: one EventSource per open board; it also carries the Director's runs).
import { api } from './api.js';

const STREAMS = new WeakMap();
const BUSY = new Set(['queued', 'generating']);

export const generationMethods = {
    initGeneration() {
        const source = new EventSource(`${this.base}/events`);
        source.addEventListener('node', (event) => this.applyNodeUpdate(JSON.parse(event.data)));
        source.addEventListener('queue', (event) => { this.renderQueue = JSON.parse(event.data); });
        source.addEventListener('director', (event) => this.onDirectorStream(JSON.parse(event.data)));
        // The Cut dock (cut-dock.js) listens on the window: one stream per board, no second EventSource.
        source.addEventListener('cut', (event) => window.dispatchEvent(new CustomEvent('board:cut', { detail: JSON.parse(event.data) })));
        source.addEventListener('cut_export', (event) => window.dispatchEvent(new CustomEvent('board:cut-export', { detail: JSON.parse(event.data) })));
        source.addEventListener('error', () => { this.streamDown = source.readyState !== EventSource.OPEN; });
        source.addEventListener('open', () => { this.streamDown = false; });
        STREAMS.set(this.$refs.board, source);
        this.loadFamilies();
    },

    destroyGeneration() {
        STREAMS.get(this.$refs.board)?.close();
    },

    /** The three Model lists at once (the server answers from what it last saw: bloop-account.js, engine-profile.js). */
    async loadFamilies() {
        await Promise.all(['image', 'video', 'audio'].map(async (type) => {
            try {
                this.families[type] = await api('GET', `/presets/${type}`);
            } catch {
                this.families[type] = [];
            }
        }));
        this.tidyAfterRender(); // the knobs just appeared, so render cards are taller now
    },

    applyNodeUpdate(update) {
        window.dispatchEvent(new CustomEvent('board:node', { detail: update })); // the Cut dock's slot lights
        const node = this.nodeById(update.nodeId);
        if (!node) return;
        node.status = update.status;
        node.progress = update.progress ?? node.progress ?? 0;
        node.progressLabel = update.label ?? (update.status === 'generating' ? node.progressLabel : '');
        // After the steps: "Decoding video", "Saving" (a step update clears it).
        node.phase = update.status === 'generating' ? ('phase' in update ? update.phase : node.phase) : null;
        this._trackEta(node);
        if (update.media_path) Object.assign(node, { media_path: update.media_path, media_mime: update.media_mime });
        node.error = update.error ?? null;
        if (update.status === 'failed') this.toast(`${this.typeLabel(node)} card failed: ${update.error}`, 'alert');
    },

    isBusy(node) {
        return BUSY.has(node.status);
    },

    async generate(node) {
        if (this.isBusy(node)) return;
        try {
            node.status = 'queued';
            node.error = null;
            await api('POST', `${this.base}/nodes/${node.id}/generate`);
        } catch (error) {
            node.status = 'idle';
            this.toast(error.message, 'warn');
        }
    },

    async cancelRender(node) {
        try {
            await api('POST', `${this.base}/nodes/${node.id}/cancel`);
        } catch (error) {
            this.toast(error.message, 'warn');
        }
    },

    /** The card's chosen family when this machine offers it, else the type's default (as the server picks). */
    familyOf(node) {
        const offered = this.families[node.type] ?? [];
        // A voice wired into a Video card is lip sync, which LTX renders whatever the card's pick (presets.js choosePreset).
        if (node.type === 'video' && this.isSocketConnected(node, { key: 'audio' }) && offered.some((f) => f.id === 'ltx')) return 'ltx';
        // Two or more reference pictures render on the edit model that takes them (presets.js choosePreset).
        const pictures = this.connections.filter((c) => c.to_node_id === node.id && c.to_socket === 'reference').length;
        if (node.type === 'image' && pictures > 1 && offered.some((f) => f.id === 'qwenedit')) return 'qwenedit';
        const chosen = node.settings?.family;
        return offered.some((f) => f.id === chosen) ? chosen : offered[0]?.id ?? '';
    },

    setFamily(node, family) {
        this.setKnob(node, 'family', family);
    },

    toggleSeedLock(node) {
        this.updateCard(node, { settings: { ...node.settings, seedLocked: !node.settings?.seedLocked } });
    },

    /** Time left from the step rate, measured from the first step (model loading is not a step). */
    _trackEta(node) {
        if (node.status !== 'generating' || !(node.progress > 0)) {
            node.etaFrom = null;
            node.etaSeconds = null;
            return;
        }
        const now = performance.now();
        if (!node.etaFrom) node.etaFrom = { at: now, progress: node.progress };
        const done = node.progress - node.etaFrom.progress;
        node.etaSeconds = done > 0 ? ((now - node.etaFrom.at) / 1000 / done) * (1 - node.progress) : null;
    },

    /** "Next up", "2 ahead": renders before this card across every board. */
    waitLabel(node) {
        const ahead = this.renderQueue.findIndex((job) => job.nodeId === node.id);
        if (ahead <= 0) return 'Queued · next up';
        return `Queued · ${ahead} ahead`;
    },

    stepLabel(node) {
        const step = (node.progressLabel || 'Generating').replace(/^step /, 'Step ');
        if (node.etaSeconds == null) return step;
        const s = Math.max(1, Math.round(node.etaSeconds));
        return `${step} · ~${s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`} left`;
    },

    /** Toolbar summary: what is left on this board, and how much other boards have in front. */
    queueSummary() {
        const here = this.renderQueue.filter((job) => job.spaceId === this.spaceId).length;
        if (!here) return '';
        const elsewhere = this.renderQueue.length - here;
        return `${here} render${here > 1 ? 's' : ''} left` + (elsewhere ? ` · ${elsewhere} on other boards` : '');
    },

    progressPercent(node) {
        return `${Math.round((node.progress ?? 0) * 100)}%`;
    },
};

// ⚡ Generate / cancel, the model family picker, seed lock, and live progress from the
// server's event stream (no polling: one EventSource per open board).
import { api } from './api.js';

const STREAMS = new WeakMap();
const BUSY = new Set(['queued', 'generating']);

export const generationMethods = {
    initGeneration() {
        const source = new EventSource(`${this.base}/events`);
        source.addEventListener('node', (event) => this.applyNodeUpdate(JSON.parse(event.data)));
        source.addEventListener('queue', (event) => { this.renderQueue = JSON.parse(event.data); });
        source.addEventListener('error', () => { this.streamDown = source.readyState !== EventSource.OPEN; });
        source.addEventListener('open', () => { this.streamDown = false; });
        STREAMS.set(this.$refs.board, source);
        this.loadFamilies();
    },

    destroyGeneration() {
        STREAMS.get(this.$refs.board)?.close();
    },

    async loadFamilies() {
        for (const type of ['image', 'video']) {
            try {
                this.families[type] = await api('GET', `/presets/${type}`);
            } catch {
                this.families[type] = [];
            }
        }
        this.tidyAfterRender(); // the knobs just appeared, so render cards are taller now
    },

    applyNodeUpdate(update) {
        const node = this.nodeById(update.nodeId);
        if (!node) return;
        node.status = update.status;
        node.progress = update.progress ?? node.progress ?? 0;
        node.progressLabel = update.label ?? (update.status === 'generating' ? node.progressLabel : '');
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

    familyOf(node) {
        return node.settings?.family ?? this.families[node.type]?.[0]?.id ?? '';
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

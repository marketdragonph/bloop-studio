// ⚡ Generate / cancel, the model family picker, seed lock, and live progress from the
// server's event stream (no polling: one EventSource per open board).
import { api } from './api.js';

const STREAMS = new WeakMap();
const BUSY = new Set(['queued', 'generating']);

export const generationMethods = {
    initGeneration() {
        const source = new EventSource(`${this.base}/events`);
        source.addEventListener('node', (event) => this.applyNodeUpdate(JSON.parse(event.data)));
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
    },

    applyNodeUpdate(update) {
        const node = this.nodeById(update.nodeId);
        if (!node) return;
        node.status = update.status;
        node.progress = update.progress ?? node.progress ?? 0;
        node.progressLabel = update.label ?? (update.status === 'generating' ? node.progressLabel : '');
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
        this.updateCard(node, { settings: { ...node.settings, family } });
    },

    toggleSeedLock(node) {
        this.updateCard(node, { settings: { ...node.settings, seedLocked: !node.settings?.seedLocked } });
    },

    progressPercent(node) {
        return `${Math.round((node.progress ?? 0) * 100)}%`;
    },
};

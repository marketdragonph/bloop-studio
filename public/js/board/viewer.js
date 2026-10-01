// Full-screen media viewer, and "Show in folder" (a local app opens Explorer on the file
// rather than downloading a second copy of something already on disk).
import { api } from './api.js';

export const viewerMethods = {
    hasMedia(node) {
        return Boolean(node.media_path);
    },

    mediaTitle(node) {
        return node.label || `${this.typeLabel(node)} ${node.id}`;
    },

    async showInFolder(path) {
        try {
            await api('POST', '/media/reveal', { path });
        } catch (error) {
            this.toast(error.message, 'warn');
        }
    },

    openViewer(node) {
        if (!this.hasMedia(node)) return;
        this.viewer = { id: node.id, url: this.mediaUrl(node), path: node.media_path, video: node.media_mime?.startsWith('video/'), title: this.mediaTitle(node) };
        this.$nextTick(() => this.$refs.viewerClose?.focus());
    },

    closeViewer() {
        this.viewer = null;
    },
};

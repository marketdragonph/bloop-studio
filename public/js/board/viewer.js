// Full-screen media viewer and downloads for any card that holds a render or upload.
export const viewerMethods = {
    hasMedia(node) {
        return Boolean(node.media_path);
    },

    downloadName(node) {
        return node.label || `${this.typeLabel(node)} ${node.id}`;
    },

    downloadUrl(node) {
        return `${this.mediaUrl(node)}?download=${encodeURIComponent(this.downloadName(node))}`;
    },

    openViewer(node) {
        if (!this.hasMedia(node)) return;
        this.viewer = { id: node.id, url: this.mediaUrl(node), video: node.media_mime?.startsWith('video/'), title: this.downloadName(node), download: this.downloadUrl(node) };
        this.$nextTick(() => this.$refs.viewerClose?.focus());
    },

    closeViewer() {
        this.viewer = null;
    },
};

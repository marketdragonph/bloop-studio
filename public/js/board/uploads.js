// Upload cards: drop or pick a picture, clip or voice; it becomes the card's media, ready to wire onward.
const ACCEPTED = [
    'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/mp4',
];
const KINDS_MESSAGE = 'Use a PNG, JPEG or WebP picture, an MP4 or WebM clip, or an MP3, WAV, OGG, FLAC or M4A voice.';
const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content ?? '';

export const uploadMethods = {
    async uploadFile(node, file) {
        if (!file) return;
        if (!ACCEPTED.includes(file.type)) return this.toast(KINDS_MESSAGE, 'warn');

        const form = new FormData();
        form.append('file', file);
        node.status = 'generating';
        node.progressLabel = 'uploading';
        try {
            const response = await fetch(`${this.base}/nodes/${node.id}/upload`, {
                method: 'POST',
                headers: { 'X-CSRF-Token': csrfToken() },
                body: form,
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error ?? `Upload failed (${response.status}).`);
            Object.assign(node, { media_path: data.media_path, media_mime: data.media_mime, label: data.label, status: 'done' });
        } catch (error) {
            node.status = 'idle';
            this.toast(error.message, 'alert');
        }
    },

    onUploadDrop(event, node) {
        event.preventDefault();
        this.uploadFile(node, event.dataTransfer?.files?.[0]);
    },

    isVideo(node) {
        return node.media_mime?.startsWith('video/');
    },

    isAudio(node) {
        return node.media_mime?.startsWith('audio/');
    },
};

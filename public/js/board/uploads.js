// Upload cards: drop or pick a picture, clip or voice; it becomes the card's media, ready to wire onward.
// The file goes up as the request body itself (sendFile), so the browser streams it from disk and the server
// streams it to the media folder: a 500 MB clip is never held in memory on either side.
export const ACCEPTED = [
    'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/mp4',
];
const KINDS_MESSAGE = 'Use a PNG, JPEG or WebP picture, an MP4 or WebM clip, or an MP3, WAV, OGG, FLAC or M4A voice.';
const csrfToken = () => globalThis.document?.querySelector?.('meta[name="csrf-token"]')?.content ?? '';

/** POSTs one file as the body to an Upload card. Resolves with the card (and duration_ms); throws a plain Error. */
export async function sendFile(url, file) {
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken(), 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
            body: file,
        });
    } catch {
        throw new Error('The studio server did not answer. Is the app still running?');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error ?? `Upload failed (${response.status}).`);
    return data;
}

export const uploadMethods = {
    async uploadFile(node, file) {
        if (!file) return;
        if (!ACCEPTED.includes(file.type)) return this.toast(KINDS_MESSAGE, 'warn');

        node.status = 'generating';
        node.progressLabel = 'uploading';
        try {
            const data = await sendFile(`${this.base}/nodes/${node.id}/upload`, file);
            Object.assign(node, { media_path: data.media_path, media_mime: data.media_mime, label: data.label, status: 'done' });
        } catch (error) {
            node.status = 'idle';
            this.toast(error.message, 'alert');
        }
    },

    onUploadDrop(event, node) {
        event.preventDefault();
        event.stopPropagation(); // the board's own drop (Bring my clips on an empty board) must not see it
        this.uploadFile(node, event.dataTransfer?.files?.[0]);
    },

    isVideo(node) {
        return node.media_mime?.startsWith('video/');
    },

    isAudio(node) {
        return node.media_mime?.startsWith('audio/');
    },
};

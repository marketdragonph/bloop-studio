// Saves rendered media under the user's media folder and resolves served paths safely.
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** A streamed upload went past the size limit; nothing was kept. */
export class UploadTooLargeError extends Error {
    constructor(maxBytes) {
        super(`That file is over ${Math.round(maxBytes / (1024 * 1024))} MB.`);
        this.code = 'TOO_LARGE';
    }
}

const EXTENSIONS = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm',
    // Voices and songs: uploaded for lip sync, or rendered by an Audio card.
    'audio/mpeg': '.mp3', 'audio/x-wav': '.wav', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/flac': '.flac', 'audio/mp4': '.m4a',
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime]));

export const mimeFromName = (name) => MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream';
export const UPLOADABLE = new Set(Object.keys(EXTENSIONS));
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export class MediaStore {
    constructor(getRoot) {
        this.getRoot = getRoot; // settings can change the folder while the app runs
    }

    /** Writes bytes for a card's take; returns the path relative to the media root (forward slashes). */
    async saveTake({ spaceId, nodeId, bytes, mime, seed }) {
        const root = this.getRoot();
        const dir = join(root, 'spaces', String(spaceId), `card-${nodeId}`);
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = join(dir, `${stamp}-seed${seed}${EXTENSIONS[mime] ?? '.bin'}`);
        await writeFile(file, bytes);
        return relative(root, file).split(sep).join('/');
    }

    /**
     * Streams a dropped file to the media folder (Bring my clips, Upload cards): never the whole file in memory.
     * Written to a `.part` file, renamed when complete; a stream over `maxBytes`, or one that breaks, leaves nothing.
     * @param {{ spaceId: number, nodeId: number, mime: string, body: ReadableStream|AsyncIterable<Uint8Array>, maxBytes?: number }} upload
     * @returns {Promise<{ mediaPath: string, bytes: number }>}
     * @throws {UploadTooLargeError} past maxBytes
     */
    async saveUploadStream({ spaceId, nodeId, mime, body, maxBytes = MAX_UPLOAD_BYTES }) {
        const root = this.getRoot();
        const dir = join(root, 'spaces', String(spaceId), `card-${nodeId}`);
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = join(dir, `upload-${stamp}${EXTENSIONS[mime] ?? '.bin'}`);
        const part = `${file}.part`;
        let bytes = 0;
        const count = new Transform({
            transform(chunk, _encoding, done) {
                bytes += chunk.length;
                done(bytes > maxBytes ? new UploadTooLargeError(maxBytes) : null, chunk);
            },
        });
        const source = typeof body?.getReader === 'function' ? Readable.fromWeb(body) : Readable.from(body);
        try {
            await pipeline(source, count, createWriteStream(part));
            await rename(part, file);
        } catch (error) {
            await rm(part, { force: true }).catch(() => {});
            throw error;
        }
        return { mediaPath: relative(root, file).split(sep).join('/'), bytes };
    }

    /** Absolute path for a stored relative path, or null if it would escape the media root. */
    resolve(relativePath) {
        const root = normalize(this.getRoot() + sep);
        const full = normalize(join(root, relativePath));
        return full.startsWith(root) ? full : null;
    }

    async read(relativePath) {
        const full = this.resolve(relativePath);
        if (!full) throw new Error('Path outside the media folder.');
        return readFile(full);
    }
}

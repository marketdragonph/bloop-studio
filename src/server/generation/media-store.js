// Saves rendered media under the user's media folder and resolves served paths safely.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';

const EXTENSIONS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' };
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

    /** Saves a file the user dropped onto an Upload card; returns its relative path. */
    async saveUpload({ spaceId, nodeId, bytes, mime }) {
        const root = this.getRoot();
        const dir = join(root, 'spaces', String(spaceId), `card-${nodeId}`);
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = join(dir, `upload-${stamp}${EXTENSIONS[mime]}`);
        await writeFile(file, bytes);
        return relative(root, file).split(sep).join('/');
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

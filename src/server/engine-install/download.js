// One file from its publisher to disk: resumable (HTTP Range onto a `.part` file, so a stopped
// app or a dropped connection carries on where it was), checked against the publisher's SHA-256
// before it is renamed into place, retried a few times. A finished file of the right size and
// hash is never fetched again.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RETRIES = 3;

export async function sha256Of(path) {
    const hash = createHash('sha256');
    await pipeline(createReadStream(path), hash);
    return hash.digest('hex');
}

const sizeOf = (path) => (existsSync(path) ? statSync(path).size : 0);

/**
 * @param {{ url: string, size: number, sha256: string }} file
 * @param {string} target  final path
 * @param {{ onProgress?: (done: number, total: number) => void, signal?: AbortSignal, fetchImpl?: typeof fetch, verify?: (path: string) => Promise<string> }} options
 */
export async function download(file, target, { onProgress = () => {}, signal, fetchImpl = fetch, verify = sha256Of } = {}) {
    if (sizeOf(target) === file.size) {
        onProgress(file.size, file.size);
        return target; // already in place (checked when it was first finished)
    }
    mkdirSync(dirname(target), { recursive: true });
    const part = `${target}.part`;

    for (let attempt = 1; ; attempt++) {
        try {
            await fetchRest(file, part, { onProgress, signal, fetchImpl });
            break;
        } catch (error) {
            if (signal?.aborted || attempt >= RETRIES) throw error;
        }
    }

    if (sizeOf(part) !== file.size) throw new Error(`${file.name ?? target}: got ${sizeOf(part)} bytes, expected ${file.size}.`);
    if ((await verify(part)) !== file.sha256) {
        rmSync(part, { force: true }); // a corrupt file is fetched again from the start next time
        throw new Error(`${file.name ?? target} did not match its checksum. It will be downloaded again.`);
    }
    renameSync(part, target);
    return target;
}

async function fetchRest(file, part, { onProgress, signal, fetchImpl }) {
    let have = sizeOf(part);
    if (have > file.size) {
        rmSync(part);
        have = 0;
    }
    if (have === file.size) return;
    const response = await fetchImpl(file.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`${file.url}: HTTP ${response.status}`);
    // A server that ignores Range sends the whole file: start the part over rather than append.
    const resumed = have > 0 && response.status === 206;
    let done = resumed ? have : 0;
    const counter = new TransformCounter((n) => onProgress((done += n), file.size));
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(part, { flags: resumed ? 'a' : 'w' }), { signal });
}

class TransformCounter extends Transform {
    constructor(onBytes) {
        super();
        this.onBytes = onBytes;
    }

    _transform(chunk, _encoding, callback) {
        this.onBytes(chunk.length);
        callback(null, chunk);
    }
}

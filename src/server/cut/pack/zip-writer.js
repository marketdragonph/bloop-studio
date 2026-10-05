// A store-only ZIP writer for Pack assets (01-core.md §8): video does not compress, so every entry is stored.
// Each file streams through in 1 MB chunks (never whole in memory), its CRC-32 from zlib.crc32 (Node 22.2+),
// then patched into the local header, so there is no data descriptor and every reader (Windows' tar.exe
// included) can list it. ZIP64 for entries or offsets past 4 GB. UTF-8 names. No new dependency.
import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { crc32 } from 'node:zlib';

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const CHUNK = 1024 * 1024;
const UTF8 = 0x0800;

function dosTime(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const day = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, day };
}

const u64 = (buf, value, at) => buf.writeBigUInt64LE(BigInt(value), at);
const abortError = () => Object.assign(new Error('Canceled.'), { name: 'AbortError', code: 'ABORT_ERR' });

export class ZipWriter {
    /** @param {{ zip64?: 'auto'|'always' }} [options] 'always' forces ZIP64 records (tests) */
    static async create(path, { zip64 = 'auto' } = {}) {
        const writer = new ZipWriter();
        writer.handle = await open(path, 'w');
        writer.offset = 0;
        writer.entries = [];
        writer.force64 = zip64 === 'always';
        return writer;
    }

    async #write(buf, at = this.offset) {
        let done = 0;
        while (done < buf.length) {
            const { bytesWritten } = await this.handle.write(buf, done, buf.length - done, at + done);
            done += bytesWritten;
        }
        if (at === this.offset) this.offset += buf.length;
    }

    #localHeader(name, size, mtime, zip64) {
        const nameBuf = Buffer.from(name, 'utf8');
        const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
        if (zip64) {
            extra.writeUInt16LE(0x0001, 0);
            extra.writeUInt16LE(16, 2);
            u64(extra, size, 4);
            u64(extra, size, 12);
        }
        const head = Buffer.alloc(30);
        const { time, day } = dosTime(mtime);
        head.writeUInt32LE(0x04034b50, 0);
        head.writeUInt16LE(zip64 ? 45 : 20, 4);
        head.writeUInt16LE(UTF8, 6);
        head.writeUInt16LE(0, 8); // stored
        head.writeUInt16LE(time, 10);
        head.writeUInt16LE(day, 12);
        head.writeUInt32LE(0, 14); // CRC, patched after the data
        head.writeUInt32LE(zip64 ? MAX32 : size, 18);
        head.writeUInt32LE(zip64 ? MAX32 : size, 22);
        head.writeUInt16LE(nameBuf.length, 26);
        head.writeUInt16LE(extra.length, 28);
        return Buffer.concat([head, nameBuf, extra]);
    }

    /** Adds bytes held in memory (manifest.json, notes). */
    async addBuffer(name, data, { mtime = new Date() } = {}) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
        const zip64 = this.force64 || buf.length >= MAX32;
        const offset = this.offset;
        await this.#write(this.#localHeader(name, buf.length, mtime, zip64));
        await this.#write(buf);
        const crc = crc32(buf);
        await this.#write(u32(crc), offset + 14);
        this.entries.push({ name, size: buf.length, crc, offset, mtime, zip64 });
    }

    /**
     * Streams a file in. `size` is what stat said; a file that changed size while packing is refused.
     * @param {{ size: number, mtime?: Date, signal?: AbortSignal, onBytes?: (n: number) => void }} options
     */
    async addFile(name, fullPath, { size, mtime = new Date(), signal, onBytes } = {}) {
        if (signal?.aborted) throw abortError();
        const zip64 = this.force64 || size >= MAX32;
        const offset = this.offset;
        await this.#write(this.#localHeader(name, size, mtime, zip64));
        let crc = 0;
        let written = 0;
        const stream = createReadStream(fullPath, { highWaterMark: CHUNK });
        try {
            for await (const chunk of stream) {
                if (signal?.aborted) throw abortError();
                crc = crc32(chunk, crc);
                await this.#write(chunk);
                written += chunk.length;
                onBytes?.(chunk.length);
            }
        } finally {
            stream.destroy();
        }
        if (written !== size) throw Object.assign(new Error(`${name} changed while it was being packed.`), { code: 'ECHANGED' });
        await this.#write(u32(crc), offset + 14);
        this.entries.push({ name, size, crc, offset, mtime, zip64 });
    }

    /** Writes the central directory (and the ZIP64 end records when needed) and closes the file. */
    async close() {
        const start = this.offset;
        for (const e of this.entries) await this.#write(this.#central(e));
        const size = this.offset - start;
        const need64 = this.force64 || this.entries.length > MAX16 || start >= MAX32 || size >= MAX32;
        if (need64) {
            const at = this.offset;
            const rec = Buffer.alloc(56);
            rec.writeUInt32LE(0x06064b50, 0);
            u64(rec, 44, 4);
            rec.writeUInt16LE(45, 12);
            rec.writeUInt16LE(45, 14);
            u64(rec, this.entries.length, 24);
            u64(rec, this.entries.length, 32);
            u64(rec, size, 40);
            u64(rec, start, 48);
            const loc = Buffer.alloc(20);
            loc.writeUInt32LE(0x07064b50, 0);
            u64(loc, at, 8);
            loc.writeUInt32LE(1, 16);
            await this.#write(Buffer.concat([rec, loc]));
        }
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(need64 ? MAX16 : this.entries.length, 8);
        end.writeUInt16LE(need64 ? MAX16 : this.entries.length, 10);
        end.writeUInt32LE(need64 ? MAX32 : size, 12);
        end.writeUInt32LE(need64 ? MAX32 : start, 16);
        await this.#write(end);
        await this.handle.close();
        this.handle = null;
        return this.offset;
    }

    /** Closes without finishing (cancel, error); the caller removes the file. */
    async abandon() {
        await this.handle?.close().catch(() => {});
        this.handle = null;
    }

    #central(e) {
        const nameBuf = Buffer.from(e.name, 'utf8');
        const bigSize = e.zip64 || e.size >= MAX32;
        const bigOffset = this.force64 || e.offset >= MAX32;
        const fields = [...(bigSize ? [e.size, e.size] : []), ...(bigOffset ? [e.offset] : [])];
        const extra = fields.length ? Buffer.alloc(4 + 8 * fields.length) : Buffer.alloc(0);
        if (fields.length) {
            extra.writeUInt16LE(0x0001, 0);
            extra.writeUInt16LE(8 * fields.length, 2);
            fields.forEach((v, i) => u64(extra, v, 4 + 8 * i));
        }
        const head = Buffer.alloc(46);
        const { time, day } = dosTime(e.mtime);
        head.writeUInt32LE(0x02014b50, 0);
        head.writeUInt16LE(45, 4);
        head.writeUInt16LE(fields.length ? 45 : 20, 6);
        head.writeUInt16LE(UTF8, 8);
        head.writeUInt16LE(0, 10);
        head.writeUInt16LE(time, 12);
        head.writeUInt16LE(day, 14);
        head.writeUInt32LE(e.crc >>> 0, 16);
        head.writeUInt32LE(bigSize ? MAX32 : e.size, 20);
        head.writeUInt32LE(bigSize ? MAX32 : e.size, 24);
        head.writeUInt16LE(nameBuf.length, 28);
        head.writeUInt16LE(extra.length, 30);
        head.writeUInt32LE(bigOffset ? MAX32 : e.offset, 42);
        return Buffer.concat([head, nameBuf, extra]);
    }
}

function u32(value) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value >>> 0, 0);
    return buf;
}

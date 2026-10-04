// A big file in parallel byte ranges, written in place into one `.part` file. One connection to
// GitHub or Hugging Face gives a fraction of the line (~7 MB/s seen); several ranges at once fill it.
//
// Each range resumes on its own: `<part>.json` records how far each one got, saved as it goes and
// only ever behind what is really on disk, so a stopped app or a dropped range carries on from there.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';

const SAVE_EVERY_MS = 2000;
const RANGE_RETRIES = 4;

/** Splits [0, size) into `count` ranges: { start, end (inclusive), done }. */
export function splitRanges(size, count) {
    const step = Math.ceil(size / count);
    const ranges = [];
    for (let start = 0; start < size; start += step) ranges.push({ start, end: Math.min(start + step, size) - 1, done: 0 });
    return ranges;
}

const statePath = (part) => `${part}.json`;

/** The saved ranges for this part, or fresh ones when there are none for a file of this size. */
export function loadRanges(part, size, count) {
    try {
        const saved = JSON.parse(readFileSync(statePath(part), 'utf8'));
        if (saved.size === size && existsSync(part)) return saved.ranges;
    } catch {
        // Nothing saved yet, or unreadable: start the ranges over.
    }
    return splitRanges(size, count);
}

/**
 * Fetches every range not yet done into `part`. Throws when a range cannot be fetched (after
 * retries) or the server does not answer a range with 206 — the caller then falls back to one
 * plain stream.
 */
export async function fetchRanges(file, part, { count, onProgress, signal, fetchImpl }) {
    const ranges = loadRanges(part, file.size, count);
    const handle = await open(part, existsSync(part) ? 'r+' : 'w+');
    const save = () => writeFileSync(statePath(part), JSON.stringify({ size: file.size, ranges }));
    const report = () => onProgress(ranges.reduce((sum, r) => sum + r.done, 0), file.size);
    const saver = setInterval(save, SAVE_EVERY_MS);
    try {
        save();
        await Promise.all(ranges.map((range) => fetchRange(file, handle, range, { report, signal, fetchImpl })));
        save();
    } finally {
        clearInterval(saver);
        await handle.close();
    }
    rmSync(statePath(part), { force: true });
}

async function fetchRange(file, handle, range, { report, signal, fetchImpl }) {
    for (let attempt = 1; range.start + range.done <= range.end; attempt++) {
        try {
            const from = range.start + range.done;
            const response = await fetchImpl(file.url, { headers: { Range: `bytes=${from}-${range.end}` }, signal, redirect: 'follow' });
            if (response.status !== 206) throw Object.assign(new Error(`${file.url}: no range support (HTTP ${response.status})`), { noRanges: true });
            for await (const chunk of response.body) {
                // Never past this range's end, whatever the server sends.
                const bytes = chunk.subarray(0, range.end - (range.start + range.done) + 1);
                await handle.write(bytes, 0, bytes.length, range.start + range.done);
                range.done += bytes.length; // counted only once it is written
                report();
                if (range.start + range.done > range.end) break;
            }
        } catch (error) {
            if (signal?.aborted || error.noRanges || attempt >= RANGE_RETRIES) throw error;
        }
    }
}

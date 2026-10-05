// Pack assets (01-core.md §8): a `kind: 'pack'` job on the media-tools queue. No ffmpeg, no GPU. It writes one
// store-only ZIP into the media folder (`spaces/{id}/packs/{space-name}-{stamp}.zip`, a Windows-safe name) and
// the sheet offers Show in folder. One pack per space at a time: pressing again (or the Director's pack_assets)
// while one runs returns that row. Free disk ≥ 1.1 × the bytes to copy; progress by bytes; cancel between files
// and between chunks; the temp file goes in `finally`.
import { mkdir, rename, rm, statfs as fsStatfs } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { JobProgress, JobStop, endFor, jobView, makeJobDir, removeDir } from '../tools-jobs.js';
import { safeName } from '../../../shared/safe-name.js';
import { collect, readBoard } from './collect.js';
import { buildManifest } from './manifest.js';
import { ZipWriter } from './zip-writer.js';

const DISK_FACTOR = 1.1;
const gb = (bytes) => `${Math.max(0.1, Math.round(bytes / 1e8) / 10)} GB`;
const stamp = (date = new Date()) => date.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

function packageVersion() {
    try {
        return JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')).version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
}

export class Packer {
    /** @param {{ db: object, cuts: object, exportsRepo: object, media: object, events: object, queue: object, statfs?: Function, appVersion?: string, log?: object, zip64?: 'auto'|'always' }} deps */
    constructor(deps) {
        this.deps = { log: console, statfs: fsStatfs, appVersion: packageVersion(), zip64: 'auto', ...deps };
    }

    /** @returns {{ export: object, created: boolean }} */
    start(spaceId, { includePrompts = true } = {}) {
        const { exportsRepo, cuts } = this.deps;
        const running = exportsRepo.active(spaceId, 'pack');
        if (running) return { export: this.view(running), created: false };
        const row = exportsRepo.create(spaceId, { kind: 'pack', revision: cuts.revision(spaceId), options: { include_prompts: includePrompts !== false } });
        this.deps.queue.add({ key: `pack:${row.id}`, kind: 'pack', run: (signal) => this.#run(row, signal) })
            .catch((error) => {
                if (error?.name !== 'AbortError') this.deps.log.error?.(error);
            });
        return { export: this.view(row), created: true };
    }

    status(spaceId, id) {
        const row = this.deps.exportsRepo.findInSpace(spaceId, id);
        return row && row.kind === 'pack' ? this.view(row) : null;
    }

    view(row) {
        const view = jobView(row);
        if (view?.media_path) view.full_path = this.deps.media.resolve(view.media_path);
        return view;
    }

    cancel(spaceId, id) {
        const { exportsRepo, queue } = this.deps;
        const row = exportsRepo.findInSpace(spaceId, id);
        if (!row || row.kind !== 'pack') return null;
        if (exportsRepo.requestCancel(id) && queue.cancel(`pack:${id}`) !== 'aborted') {
            this.#end(row, endFor(Object.assign(new Error('Canceled.'), { name: 'AbortError' }), 'pack'));
        }
        return this.view(exportsRepo.find(id));
    }

    async #run(row, signal) {
        const { db, cuts, exportsRepo, media, events, statfs, appVersion, log } = this.deps;
        const progress = new JobProgress({ row, exportsRepo, events });
        const includePrompts = row.options?.include_prompts !== false;
        let dir = null;
        let zip = null;
        try {
            if (!exportsRepo.update(row.id, { status: 'running', started_at: new Date().toISOString() })) return null;
            progress.report(0, 'Collecting the files');
            const board = readBoard(db, row.space_id, { exportsRepo, cuts });
            if (!board.space) throw new JobStop('gone', 'The space was deleted.');
            const packed = await collect(board, { media, includePrompts });
            if (!includePrompts) packed.notes = [];
            await this.#checkDisk(packed.bytes);

            dir = await makeJobDir(media, 'pack', row.id);
            const tmpZip = join(dir, 'pack.zip');
            zip = await ZipWriter.create(tmpZip, { zip64: this.deps.zip64 });
            const total = Math.max(1, packed.bytes);
            let copied = 0;
            const n = packed.files.length;
            for (const [i, file] of packed.files.entries()) {
                if (signal.aborted) throw abortError();
                const step = `Packing file ${i + 1} of ${n}`;
                if (!progress.report(copied / total, step)) throw abortError();
                await zip.addFile(file.zip, file.full, {
                    size: file.size, mtime: file.mtime, signal,
                    onBytes: (bytes) => {
                        copied += bytes;
                        if (!progress.report(copied / total, step)) throw abortError();
                    },
                });
            }
            for (const note of packed.notes) await zip.addBuffer(note.zip, note.text);
            const manifest = buildManifest(board, packed, { appVersion, includePrompts });
            await zip.addBuffer('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
            const bytes = await zip.close();
            zip = null;
            if (!exportsRepo.find(row.id)) throw abortError();

            const outDir = media.resolve(`spaces/${row.space_id}/packs`);
            await mkdir(outDir, { recursive: true });
            const name = `${safeName(`${board.space.name}-${stamp()}`, { max: 76 })}.zip`;
            const finalPath = join(outDir, name);
            await rm(finalPath, { force: true });
            await rename(tmpZip, finalPath);
            const mediaPath = relative(media.getRoot(), finalPath).split(sep).join('/');
            const report = { files: packed.files.length + packed.notes.length + 1, missing: packed.missing.map((m) => m.path), bytes_copied: packed.bytes };
            progress.close();
            exportsRepo.finish(row.id, { status: 'done', media_path: mediaPath, bytes, progress: 1, step: `Packed ${report.files} files`, report });
            events.cutExport?.({ spaceId: row.space_id, exportId: row.id, kind: 'pack', status: 'done', progress: 1, step: `Packed ${report.files} files`, media_path: mediaPath, bytes, report });
            return { media_path: mediaPath, bytes };
        } catch (error) {
            progress.close();
            const gone = progress.gone || !exportsRepo.find(row.id);
            const end = endFor(error, 'pack', { gone });
            if (end.error_code === 'failed') log.error?.(`Pack ${row.id} failed:`, error);
            this.#end(row, end);
            return null;
        } finally {
            await zip?.abandon();
            await removeDir(dir);
        }
    }

    async #checkDisk(bytes) {
        try {
            const { bavail, bsize } = await this.deps.statfs(this.deps.media.getRoot());
            const free = Number(bavail) * Number(bsize);
            const need = Math.ceil(DISK_FACTOR * bytes);
            if (Number.isFinite(free) && free < need) throw new JobStop('disk', `The pack needs about ${gb(need)} free on the media folder's disk; there is ${gb(free)}.`);
        } catch (error) {
            if (error instanceof JobStop) throw error;
        }
    }

    #end(row, end) {
        const ended = this.deps.exportsRepo.finish(row.id, end);
        if (!ended && end.error_code !== 'gone') return;
        this.deps.events.cutExport?.({ spaceId: row.space_id, exportId: row.id, kind: 'pack', status: end.status, progress: 0, step: null, error: end.error, error_code: end.error_code });
    }
}

const abortError = () => Object.assign(new Error('Canceled.'), { name: 'AbortError' });

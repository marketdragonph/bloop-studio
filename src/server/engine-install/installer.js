// "Install offline engine": ComfyUI portable, then the model files picked, then start it.
//
// One install at a time, run in the background; the page polls `state()`. What was asked is saved
// in settings (`engineInstall`) so a closed app offers to carry on: finished files are skipped and
// a half-downloaded one resumes (download.js). Nothing is installed outside the chosen folder.
import { execFile } from 'node:child_process';
import { existsSync, rmSync, statSync, statfsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { download as fetchFile, sha256Of } from './download.js';
import { MODEL_FAMILIES } from '../../shared/model-sources.js';
import { filesFor } from './plan.js';
import { inspect } from '../services/comfy-install.js';
import { allModelDirs, modelPaths } from '../services/comfy-model-paths.js';

const PORTABLE_DIR = 'ComfyUI_windows_portable';
const RUNNING = ['comfy', 'unpacking', 'models', 'starting', 'repairing'];

/** Where an install keeps its model files. */
export const modelsDir = (install) => (install.kind === 'venv' ? join(install.root, 'models') : join(install.root, 'ComfyUI', 'models'));

/** Every file the app knows a source for, each once. */
const KNOWN_FILES = [...new Map(MODEL_FAMILIES.flatMap((f) => Object.values(f.variants).flat()).map((file) => [`${file.folder}/${file.name}`, file])).values()];

/** Where a known file already is in this install (its own or an extra models folder), or null. */
export function locate(install, file, { exact = true } = {}) {
    for (const dir of modelPaths(install)(file.folder)) {
        const path = join(dir, file.name);
        if (existsSync(path) && (!exact || statSync(path).size === file.size)) return path;
    }
    return null;
}

/** Disk the models of an install take, extra_model_paths folders included. */
export async function modelsBytes(install) {
    let total = 0;
    for (const dir of allModelDirs(install)) total += await folderBytes(dir);
    return total;
}

/** Bytes of model files under a folder (walked, not estimated). */
export async function folderBytes(dir) {
    let total = 0;
    try {
        for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
            if (entry.isFile()) total += (await stat(join(entry.parentPath ?? entry.path, entry.name))).size;
        }
    } catch {
        // No folder: nothing used.
    }
    return total;
}

/** Unpacks a .7z with Windows' own bsdtar (libarchive): no extractor to ship. */
function unpack(archive, into) {
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    return new Promise((resolve, reject) => {
        execFile(tar, ['-xf', archive, '-C', into], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
            (error, _out, stderr) => (error ? reject(new Error(`Could not unpack ComfyUI: ${stderr || error.message}`)) : resolve()));
    });
}

const freeGb = (folder) => {
    try {
        const s = statfsSync(parse(folder).root);
        return (s.bavail * s.bsize) / 1e9;
    } catch {
        return Infinity; // cannot tell: let the download itself fail if it must
    }
};

export class EngineInstaller {
    #state = { phase: 'idle' };
    #abort = null;

    /** @param {{ settings, launcher, engine?, download?: Function, unpack?: Function, freeGb?: Function, verify?: Function, known?: object[] }} deps */
    constructor({ settings, launcher, engine, download = fetchFile, unpack: unpackImpl = unpack, freeGb: free = freeGb, verify = sha256Of, known = KNOWN_FILES }) {
        Object.assign(this, { settings, launcher, engine, download, unpackImpl, free, verify, known });
    }

    state() {
        return { ...this.#state, pending: this.settings.get('engineInstall') ?? null };
    }

    get running() {
        return RUNNING.includes(this.#state.phase);
    }

    /**
     * Starts installing in the background. Throws (before anything is written) when the request
     * cannot work: nothing picked, no room.
     * @param {object} plan  planFor() for this PC
     * @param {{ folder: string, families: string[], into?: { root: string, kind: 'portable'|'venv' } }} choice
     *        `into`: add the models to the person's existing ComfyUI instead of installing one.
     */
    start(plan, { folder, families, into = null }) {
        if (this.running) throw new Error('An install is already running.');
        const files = filesFor(plan, families);
        if (into) folder = into.root;
        const comfyGb = into ? 0 : plan.comfy.unpackedGb + plan.comfy.size / 1e9;
        const neededGb = comfyGb + files.reduce((s, f) => s + f.size, 0) / 1e9;
        if (this.free(folder) < neededGb) {
            throw new Error(`Not enough free space on ${parse(folder).root}: about ${Math.ceil(neededGb)} GB is needed.`);
        }
        this.settings.update({ engineInstall: { folder, families, version: plan.comfy.version } });
        this.#abort = new AbortController();
        const steps = [...(into ? [] : [{ id: 'comfy', label: `ComfyUI ${plan.comfy.version}`, done: 0, total: plan.comfy.size }]),
            ...files.map((f) => ({ id: `${f.folder}/${f.name}`, label: f.name, done: 0, total: f.size }))];
        this.#state = { phase: into ? 'models' : 'comfy', folder, steps, error: null };
        const run = into ? this.#addModels(into, files, this.#abort.signal) : this.#run(plan, folder, files, this.#abort.signal);
        run.catch((error) => {
            this.#state = { ...this.#state, phase: this.#abort?.signal.aborted ? 'canceled' : 'failed', error: error.message };
        });
    }

    cancel() {
        this.#abort?.abort();
    }

    #progress(id) {
        return (done, total) => {
            const step = this.#state.steps.find((s) => s.id === id);
            if (step) Object.assign(step, { done, total });
        };
    }

    /**
     * Into an existing ComfyUI: only the model files it does not have yet (looked for in its own and
     * its extra_model_paths folders), into its own models folders. It is not restarted.
     */
    async #addModels(into, files, signal) {
        for (const file of files) {
            const id = `${file.folder}/${file.name}`;
            if (locate(into, file)) this.#progress(id)(file.size, file.size);
            else await this.download(file, join(modelsDir(into), file.folder, file.name), { onProgress: this.#progress(id), signal });
        }
        this.settings.update({ engineInstall: null });
        this.#state.phase = 'added';
        // ComfyUI sees new model files at once (no restart: tried 2026-10-05); the app's own check is
        // cached for minutes, so it looks again now and the new families show on cards straight away.
        await this.#redetect();
    }

    /**
     * Re-runs the engine check until the engine answers (a just-started ComfyUI takes 10–60 s), so new
     * families appear without waiting out the cache or pressing Re-detect models.
     */
    async #redetect({ tries = 36, everyMs = this.redetectEveryMs ?? 5000 } = {}) {
        if (!this.engine) return;
        for (let i = 0; i < tries; i++) {
            const profile = await this.engine.current({ refresh: true }).catch(() => null);
            if (profile?.detected) return;
            await new Promise((resolve) => setTimeout(resolve, everyMs));
        }
    }

    async #run(plan, folder, files, signal) {
        const root = join(folder, PORTABLE_DIR);
        const progress = (id) => this.#progress(id);

        // 1. ComfyUI itself, unless a previous run already unpacked it.
        if (!inspect(root)) {
            const archive = join(folder, 'downloads', `ComfyUI_windows_portable_${plan.comfy.version}.7z`);
            await this.download({ ...plan.comfy, name: 'ComfyUI' }, archive, { onProgress: progress('comfy'), signal });
            this.#state.phase = 'unpacking';
            await this.unpackImpl(archive, folder);
            if (!inspect(root)) throw new Error('ComfyUI was unpacked, but its files are not where they should be.');
            rmSync(archive, { force: true }); // ~2 GB back
        }
        progress('comfy')(plan.comfy.size, plan.comfy.size);

        // 2. The models, into ComfyUI's own models folders.
        this.#state.phase = 'models';
        for (const file of files) {
            await this.download(file, join(root, 'ComfyUI', 'models', file.folder, file.name), { onProgress: progress(`${file.folder}/${file.name}`), signal });
        }

        // 3. Point the app at it and start it.
        this.#state.phase = 'starting';
        // engineManaged: this one Bloop Studio installed, so it may also remove it.
        this.settings.update({ comfyPath: root, engineInstall: null, engineManaged: root });
        this.launcher.install({ refresh: true });
        // One the app started from another folder makes way (same port); one started by hand is
        // left alone, and the new one then says the port is taken.
        if (this.launcher.state().running) {
            this.launcher.stop();
            await new Promise((resolve) => setTimeout(resolve, this.restartDelayMs ?? 3000));
        }
        this.launcher.start();
        this.#state.phase = 'done';
        this.#redetect(); // in the background: the install is done, the engine is starting
    }

    /**
     * Repair: every model file the app knows that is in this ComfyUI is checked against its
     * publisher's SHA-256; a wrong or half-written one is fetched again. Files it does not know
     * (the person's own) are never touched. Runs in the background like an install.
     */
    repair() {
        if (this.running) throw new Error('An install is already running.');
        const install = this.launcher.install({ refresh: true });
        if (!install) throw new Error('No ComfyUI found on this PC to repair.');
        // Wherever ComfyUI reads them from: a half-written .part counts too.
        const found = this.known.map((file) => ({ file, path: locate(install, file, { exact: false })
            ?? (existsSync(join(modelsDir(install), file.folder, `${file.name}.part`)) ? join(modelsDir(install), file.folder, file.name) : null) }))
            .filter((f) => f.path);
        const files = found.map((f) => f.file);
        this.#abort = new AbortController();
        this.#state = { phase: 'repairing', folder: install.root, fixed: 0, error: null,
            steps: files.map((f) => ({ id: `${f.folder}/${f.name}`, label: f.name, done: 0, total: f.size })) };
        this.#repair(found, this.#abort.signal).catch((error) => {
            this.#state = { ...this.#state, phase: this.#abort?.signal.aborted ? 'canceled' : 'failed', error: error.message };
        });
    }

    async #repair(found, signal) {
        for (const { file, path } of found) {
            const ok = existsSync(path) && statSync(path).size === file.size && (await this.verify(path)) === file.sha256;
            if (signal.aborted) throw new Error('Canceled.');
            if (!ok) {
                rmSync(path, { force: true });
                await this.download(file, path, { onProgress: this.#progress(`${file.folder}/${file.name}`), signal });
                this.#state.fixed++;
            }
            this.#progress(`${file.folder}/${file.name}`)(file.size, file.size);
        }
        this.#state.phase = 'repaired';
        if (this.#state.fixed) await this.#redetect();
    }

    /**
     * Remove: only an engine Bloop Studio installed (engineManaged), stopped first, the whole folder
     * deleted. Boards and renders live elsewhere and are never touched.
     */
    async remove() {
        if (this.running) throw new Error('An install is running. Cancel it first.');
        const root = this.settings.get('engineManaged');
        if (!root) throw new Error('Bloop Studio did not install this ComfyUI, so it does not remove it.');
        if (this.launcher.state().running) {
            this.launcher.stop();
            await new Promise((resolve) => setTimeout(resolve, this.restartDelayMs ?? 3000));
        }
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        this.settings.update({ comfyPath: this.settings.get('comfyPath') === root ? '' : this.settings.get('comfyPath'), engineManaged: null });
        this.launcher.install({ refresh: true });
        this.#state = { phase: 'removed' };
    }
}

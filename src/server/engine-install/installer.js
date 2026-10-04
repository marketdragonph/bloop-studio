// "Install offline engine": ComfyUI portable, then the model files picked, then start it.
//
// One install at a time, run in the background; the page polls `state()`. What was asked is saved
// in settings (`engineInstall`) so a closed app offers to carry on: finished files are skipped and
// a half-downloaded one resumes (download.js). Nothing is installed outside the chosen folder.
import { execFile } from 'node:child_process';
import { rmSync, statfsSync } from 'node:fs';
import { join, parse } from 'node:path';
import { download as fetchFile } from './download.js';
import { filesFor } from './plan.js';
import { inspect } from '../services/comfy-install.js';

const PORTABLE_DIR = 'ComfyUI_windows_portable';

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

    /** @param {{ settings, launcher, engine?, download?: Function, unpack?: Function, freeGb?: Function }} deps */
    constructor({ settings, launcher, engine, download = fetchFile, unpack: unpackImpl = unpack, freeGb: free = freeGb }) {
        Object.assign(this, { settings, launcher, engine, download, unpackImpl, free });
    }

    state() {
        return { ...this.#state, pending: this.settings.get('engineInstall') ?? null };
    }

    get running() {
        return ['comfy', 'unpacking', 'models', 'starting'].includes(this.#state.phase);
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

    /** Into an existing ComfyUI: only the model files, into its models folders. It is not restarted. */
    async #addModels(into, files, signal) {
        const models = into.kind === 'portable' ? join(into.root, 'ComfyUI', 'models') : join(into.root, 'models');
        for (const file of files) {
            await this.download(file, join(models, file.folder, file.name), { onProgress: this.#progress(`${file.folder}/${file.name}`), signal });
        }
        this.settings.update({ engineInstall: null });
        this.#state.phase = 'added';
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
        this.settings.update({ comfyPath: root, engineInstall: null });
        this.launcher.install({ refresh: true });
        // One the app started from another folder makes way (same port); one started by hand is
        // left alone, and the new one then says the port is taken.
        if (this.launcher.state().running) {
            this.launcher.stop();
            await new Promise((resolve) => setTimeout(resolve, this.restartDelayMs ?? 3000));
        }
        this.launcher.start();
        this.#state.phase = 'done';
    }
}

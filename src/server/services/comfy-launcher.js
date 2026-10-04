// Starts and stops the person's own ComfyUI from Bloop Studio (the top-bar engine switch).
//
// Only an install found on this PC (comfy-install.js) and only for a local engine address. Bloop
// Studio stops only a ComfyUI it started itself: one the person runs by hand is never touched.
// The process runs hidden (no console window); its last lines are kept for the error message.
import { spawn as nodeSpawn } from 'node:child_process';
import { findInstall, isLocal, withAddress } from './comfy-install.js';

const LOG_LINES = 40;
const START_TIMEOUT_MS = 180_000; // first start loads custom nodes and can take a while

export class ComfyLauncher {
    #child = null;
    #startedAt = 0;
    #error = null;
    #log = [];
    #install;

    /** @param {{ settings, find?: Function, spawn?: Function, killTree?: Function, now?: () => number }} deps */
    constructor({ settings, find = findInstall, spawn = nodeSpawn, killTree = windowsKillTree, now = Date.now }) {
        Object.assign(this, { settings, find, spawn, killTree, now });
    }

    /** The install Bloop Studio can start, looked up once (again with `refresh`). */
    install({ refresh = false } = {}) {
        if (refresh || this.#install === undefined) this.#install = this.find({ configured: this.settings.get('comfyPath') });
        return this.#install;
    }

    /**
     * What the top bar and Settings show.
     * available: an install was found and the engine address is on this PC.
     * running: Bloop Studio started it and it has not exited. starting: running, not answering yet.
     */
    state({ online = false } = {}) {
        const install = this.install();
        const running = Boolean(this.#child);
        const starting = running && !online && this.now() - this.#startedAt < START_TIMEOUT_MS;
        return {
            available: Boolean(install) && isLocal(this.settings.get('comfyUrl')),
            path: install?.root ?? null,
            running,
            starting,
            error: running ? null : this.#error,
        };
    }

    start() {
        const install = this.install();
        if (this.#child) return;
        if (!install || !isLocal(this.settings.get('comfyUrl'))) throw new Error('No ComfyUI found on this PC to start.');
        this.#error = null;
        this.#log = [];
        this.#startedAt = this.now();
        const child = this.spawn(install.python, withAddress(install, this.settings.get('comfyUrl')), {
            cwd: install.root,
            windowsHide: true,
            // Piped, Python writes in the Windows code page and the first emoji a custom node logs
            // crashes ComfyUI at start (seen with SeedVR2): UTF-8, like its own console.
            env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const keep = (chunk) => {
            this.#log.push(...String(chunk).split(/\r?\n/).filter(Boolean));
            this.#log = this.#log.slice(-LOG_LINES);
        };
        child.stdout?.on('data', keep);
        child.stderr?.on('data', keep);
        child.on('error', (error) => this.#exited(child, `ComfyUI could not start: ${error.message}`));
        child.on('exit', (code) => this.#exited(child, code ? `ComfyUI stopped (code ${code}): ${this.#log.at(-1) ?? 'no output'}` : null));
        this.#child = child;
    }

    /** Stops the ComfyUI this app started (and everything it spawned). Nothing to do otherwise. */
    stop() {
        const child = this.#child;
        if (!child) return;
        this.#child = null;
        this.#error = null;
        this.killTree(child.pid);
    }

    /** The last lines ComfyUI printed, for "Show engine log". */
    log() {
        return [...this.#log];
    }

    #exited(child, error) {
        if (this.#child !== child) return; // stopped on purpose: not an error
        this.#child = null;
        this.#error = error;
    }
}

/** ComfyUI starts its own worker processes; the whole tree goes, or the GPU stays held. */
function windowsKillTree(pid) {
    if (!pid) return;
    nodeSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}

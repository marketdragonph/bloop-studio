// Finds a ComfyUI install on this PC that Bloop Studio can start for the person.
//
// Two shapes are recognised:
//  - the official Windows PORTABLE build: <root>\python_embeded\python.exe + <root>\ComfyUI\main.py,
//    started the way its own run_*.bat does (the flags are read from that .bat, so an AMD or
//    fp16-accumulation setup starts exactly as the person starts it by hand);
//  - a manual (git) install: <root>\main.py with <root>\venv or <root>\.venv.
// Nothing here runs anything; it only looks at files. ComfyLauncher does the starting.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FOLDER_NAMES = ['ComfyUI_windows_portable', 'ComfyUI', 'ComfyUI_portable'];
// The person's own start script, best first. CPU is the last resort, never picked over a GPU one.
const SCRIPT_ORDER = [/^run_nvidia_gpu\.bat$/i, /^run_amd.*\.bat$/i, /^run_nvidia_gpu.*\.bat$/i, /^run_(?!cpu).*\.bat$/i];

/** Folders worth looking in, in order: the one the person set, then the usual places. */
export function candidates({ configured, env = process.env, drives = 'CDEFGH' } = {}) {
    const home = env.USERPROFILE ?? '';
    const parents = [
        ...[...drives].map((d) => `${d}:\\`),
        home,
        home && join(home, 'Desktop'),
        home && join(home, 'Downloads'),
        home && join(home, 'Documents'),
    ].filter(Boolean);
    const found = parents.flatMap((parent) => FOLDER_NAMES.map((name) => join(parent, name)));
    // A portable zip unpacked as-is nests one level: ComfyUI_windows_portable\ComfyUI_windows_portable.
    const nested = found.map((dir) => join(dir, 'ComfyUI_windows_portable'));
    return [...new Set([configured, ...found, ...nested].filter(Boolean))];
}

/**
 * The start command for an install folder, or null when it is not one we can start.
 * @returns {{ root: string, python: string, args: string[], kind: 'portable'|'venv', script?: string } | null}
 */
export function inspect(root, fs = { existsSync, readFileSync, readdirSync }) {
    try {
        const portable = join(root, 'python_embeded', 'python.exe');
        if (fs.existsSync(portable) && fs.existsSync(join(root, 'ComfyUI', 'main.py'))) {
            const script = pickScript(fs.readdirSync(root));
            const flags = script ? flagsFrom(fs.readFileSync(join(root, script), 'utf8')) : ['--windows-standalone-build'];
            return { root, python: portable, args: ['-s', join('ComfyUI', 'main.py'), ...flags], kind: 'portable', script };
        }
        if (fs.existsSync(join(root, 'main.py'))) {
            const python = ['venv', '.venv'].map((v) => join(root, v, 'Scripts', 'python.exe')).find((p) => fs.existsSync(p));
            if (python) return { root, python, args: ['main.py'], kind: 'venv' };
        }
    } catch {
        // An unreadable folder is simply not an install.
    }
    return null;
}

/** The first install found, or null. */
export function findInstall({ configured, env, drives, fs } = {}) {
    for (const dir of candidates({ configured, env, drives })) {
        const install = inspect(dir, fs);
        if (install) return install;
    }
    return null;
}

/** With the address Bloop Studio talks to: a non-default port is passed on, unless the script sets one. */
export function withAddress(install, comfyUrl) {
    const port = new URL(comfyUrl).port || '8188';
    if (port === '8188' || install.args.includes('--port')) return install.args;
    return [...install.args, '--port', port];
}

/** Can Bloop Studio start the engine at this address? Only on this PC. */
export function isLocal(comfyUrl) {
    try {
        return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(comfyUrl).hostname);
    } catch {
        return false;
    }
}

function pickScript(files) {
    for (const pattern of SCRIPT_ORDER) {
        const hit = files.find((f) => pattern.test(f));
        if (hit) return hit;
    }
    return null;
}

/** The flags after `main.py` on the script's python line; never anything that is not a flag or its value. */
function flagsFrom(script) {
    const line = script.split(/\r?\n/).find((l) => /python(\.exe)?\b.*main\.py/i.test(l));
    if (!line) return ['--windows-standalone-build'];
    const after = line.slice(line.toLowerCase().indexOf('main.py') + 'main.py'.length);
    // Shell plumbing (`%*`, pipes, redirects) is not ComfyUI's and is dropped.
    return after.trim().split(/\s+/).filter((t) => t && /^[\w.\-=:,]+$/.test(t));
}

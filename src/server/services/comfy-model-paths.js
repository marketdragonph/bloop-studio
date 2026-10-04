// Where a ComfyUI keeps its model files: its own `models` folder, plus every folder its
// `extra_model_paths.yaml` adds (people keep 50+ GB of models on another drive this way, and
// ComfyUI reads both). Used to find a model file before fetching it again, to repair the ones
// that are there, and to add up the disk they take. New downloads go to the install's own folder.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** ComfyUI's own folder: `<root>\ComfyUI` for the portable build, the root for a git install. */
const comfyDir = (install) => (install.kind === 'venv' ? install.root : join(install.root, 'ComfyUI'));

/**
 * The small YAML ComfyUI documents for extra_model_paths: sections of `key: value`, a value may be
 * a `|` block of one path per line. Only what that file uses; anything else is ignored.
 * @returns {Array<{ base: string, folders: Record<string, string[]> }>}
 */
export function parseExtraPaths(text, yamlDir) {
    const sections = [];
    let current = null;
    let block = null;
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '');
        if (!line.trim()) continue;
        const indent = line.length - line.trimStart().length;
        if (indent === 0) {
            current = { base: resolve(yamlDir), folders: {} };
            sections.push(current);
            block = null;
            continue;
        }
        if (!current) continue;
        const pair = /^\s+([\w.-]+):\s*(.*)$/.exec(line);
        if (pair && (!block || indent <= block.indent)) {
            const [, key, value] = pair;
            block = null;
            if (key === 'base_path') current.base = resolve(yamlDir, value.trim());
            else if (key === 'is_default') continue;
            else if (value.trim() === '|') block = { key, indent };
            else current.folders[key] = [value.trim()];
            continue;
        }
        if (block) (current.folders[block.key] ??= []).push(line.trim());
    }
    return sections;
}

/**
 * Every folder ComfyUI reads model files of one kind from, its own first.
 * @returns {(folder: string) => string[]}
 */
export function modelPaths(install, fs = { existsSync, readFileSync }) {
    const own = join(comfyDir(install), 'models');
    const yaml = join(comfyDir(install), 'extra_model_paths.yaml');
    let sections = [];
    try {
        if (fs.existsSync(yaml)) sections = parseExtraPaths(fs.readFileSync(yaml, 'utf8'), dirname(yaml));
    } catch {
        // Unreadable: the install's own folder still counts.
    }
    return (folder) => [
        join(own, folder),
        ...sections.flatMap((s) => Object.entries(s.folders)
            .filter(([key]) => key.toLowerCase() === folder.toLowerCase())
            .flatMap(([, dirs]) => dirs.map((d) => (isAbsolute(d) ? d : join(s.base, d))))),
    ];
}

/** Every distinct models folder of this install (for adding up disk use). */
export function allModelDirs(install, fs) {
    const paths = modelPaths(install, fs);
    const own = join(comfyDir(install), 'models');
    const extra = new Set();
    for (const folder of ['checkpoints', 'diffusion_models', 'text_encoders', 'vae', 'loras', 'clip', 'unet', 'upscale_models', 'latent_upscale_models']) {
        for (const dir of paths(folder).slice(1)) extra.add(dir);
    }
    return [own, ...extra];
}

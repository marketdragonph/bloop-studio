// The LoRAs a card's Style knob offers: the files ComfyUI lists for LoraLoaderModelOnly, each matched to the model
// family it was trained for (lora-families.js), minus the speed LoRAs our own workflows already load (H3's turbo,
// Qwen-Image-Edit's Lightning). Files are found in ComfyUI's loras folders (its own and extra_model_paths.yaml) and
// read once per size and date; a ComfyUI on another PC falls back to what the file name says.
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { modelPaths } from './comfy-model-paths.js';
import { familyFromName, familyOfLora, readSafetensorsHeader } from '../generation/lora-families.js';

/** The lora_name values the shipped workflows set themselves: never offered as a style. */
export function builtInLoras(catalog) {
    const names = new Set();
    for (const variants of catalog.values()) {
        for (const preset of variants) {
            for (const node of Object.values(preset.graph)) {
                if (typeof node.inputs?.lora_name === 'string') names.add(node.inputs.lora_name);
            }
        }
    }
    return names;
}

/** "styles\\zimage_turbo_realism_lora.safetensors" → "zimage turbo realism lora". */
export const styleLabel = (name) => basename(String(name).replaceAll('\\', '/')).replace(/\.(safetensors|gguf)$/i, '').replace(/[_]+/g, ' ').trim();

export class LoraLibrary {
    #cache = new Map(); // full path → { key, family }

    /**
     * @param {{ install: () => object|null, builtIn?: Set<string>, readHeader?: typeof readSafetensorsHeader, statFile?: typeof stat }} deps
     *   `install`: the ComfyUI install on this PC (comfy-install.js), null when ComfyUI runs elsewhere.
     */
    constructor({ install, builtIn = new Set(), readHeader = readSafetensorsHeader, statFile = stat }) {
        this.install = install;
        this.builtIn = builtIn;
        this.readHeader = readHeader;
        this.statFile = statFile;
    }

    /** The style LoRAs for one family, as select options { value, label }, by label. */
    async stylesFor(family, names = []) {
        const all = await this.classify(names);
        return all.filter((l) => l.family === family).map(({ name }) => ({ value: name, label: styleLabel(name) }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    /** Every offered LoRA name with its family (null: a model we do not run). */
    async classify(names = []) {
        const folders = this.#folders();
        const offered = names.filter((name) => !this.builtIn.has(name) && /\.safetensors$/i.test(name));
        return Promise.all(offered.map(async (name) => ({ name, family: await this.#familyOf(name, folders) })));
    }

    #folders() {
        try {
            const install = this.install();
            return install ? modelPaths(install)('loras') : [];
        } catch {
            return [];
        }
    }

    async #familyOf(name, folders) {
        for (const folder of folders) {
            const path = join(folder, name);
            const info = await this.statFile(path).catch(() => null);
            if (!info?.isFile()) continue;
            const key = `${info.size}:${info.mtimeMs}`;
            const kept = this.#cache.get(path);
            if (kept?.key === key) return kept.family;
            const family = await this.readHeader(path).then(familyOfLora).catch(() => null);
            this.#cache.set(path, { key, family });
            return family;
        }
        return familyFromName(name);
    }
}

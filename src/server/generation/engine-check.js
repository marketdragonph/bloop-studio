// Can this ComfyUI run a preset variant? Derived from the graph itself against /object_info,
// so no hand-kept list of models or nodes can drift: every node class must be installed and
// every fixed dropdown value (model file, sampler, clip type…) must be one ComfyUI offers.
import { targetsOf } from './presets.js';

/** The options of a dropdown input spec: legacy [[...options]] or the newer ["COMBO", { options }]. */
function comboOptions(spec) {
    const [type, config] = spec ?? [];
    if (Array.isArray(type)) return type;
    if (type === 'COMBO' && Array.isArray(config?.options)) return config.options;
    return null;
}

/** "title.field" keys the app writes at render time (prompt, seed, uploaded picture…): not fixed values. */
function boundFields(preset) {
    const bound = new Set();
    for (const binding of Object.values(preset.bindings)) {
        for (const [title, field] of targetsOf(binding)) bound.add(`${title}.${field}`);
    }
    return bound;
}

/** What this ComfyUI lacks to run the preset variant, as readable lines; empty when it can run it. */
export function missingFor(preset, objectInfo) {
    const missing = new Set();
    const bound = boundFields(preset);
    for (const node of Object.values(preset.graph)) {
        const def = objectInfo[node.class_type];
        if (!def) {
            missing.add(`node ${node.class_type}`);
            continue;
        }
        const specs = { ...def.input?.required, ...def.input?.optional };
        for (const [field, value] of Object.entries(node.inputs)) {
            if (Array.isArray(value) || bound.has(`${node._meta?.title}.${field}`)) continue; // links and app-set values
            const options = comboOptions(specs[field]);
            if (options && !options.includes(value)) missing.add(`${value} (${node.class_type} ${field})`);
        }
    }
    return [...missing];
}

/** A card reports a little under its size (a 12 GB card ~11.99 GB, a 24 GB card ~23.99): round up. */
const SLACK_GB = 0.5;

/** Why this card is too small for the variant, or null when it fits (or the card's memory is unknown). */
export function tooBigFor(preset, vramGb) {
    if (!vramGb || !preset.minVramGb || preset.minVramGb <= vramGb + SLACK_GB) return null;
    return `needs ${preset.minVramGb} GB of graphics memory; this card has ${Math.round(vramGb)} GB`;
}

/**
 * Picks, per preset id, the first variant this engine can run: every node and model file there, AND
 * small enough for the card. Files alone are not enough: a 12 GB card that also holds the 24 GB
 * (bf16) Z-Image files would otherwise take that variant and crawl or run out of memory.
 * Returns { presets: Map<id, preset>, report: [{ id, card, label, variant, missing }] }.
 */
export function pickVariants(catalog, objectInfo, { vramGb = 0 } = {}) {
    const presets = new Map();
    const report = [];
    for (const [id, variants] of catalog) {
        const checked = variants.map((preset) => {
            const tooBig = tooBigFor(preset, vramGb);
            return { preset, missing: [...(tooBig ? [tooBig] : []), ...missingFor(preset, objectInfo)] };
        });
        const runnable = checked.find((c) => !c.missing.length);
        if (runnable) presets.set(id, runnable.preset);
        // When none runs, name what the closest variant lacks: the shortest shopping list.
        const shown = runnable ?? checked.reduce((a, b) => (b.missing.length < a.missing.length ? b : a));
        report.push({ id, card: shown.preset.card, label: shown.preset.label, variant: runnable?.preset.variant ?? null, missing: shown.missing });
    }
    return { presets, report };
}

// Workflow presets: ComfyUI API graphs in workflows/*.json with named input bindings.
// Bindings target nodes by their `_meta.title` marker (e.g. "@positive"), never by numeric id,
// so a workflow re-exported from ComfyUI keeps working as long as the titles are kept.
// One preset id can ship several variants (e.g. bf16 for a 24 GB card, int8 for 12 GB): the
// engine profile picks, per machine, the first variant its ComfyUI can actually run.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS_DIR = fileURLToPath(new URL('../../../workflows/', import.meta.url));
const DEFAULT_FAMILY = { image: 'zimage', video: 'wan5b' };

/** A binding is [title, field] or a list of them; always return the list form. */
export const targetsOf = (binding) => (Array.isArray(binding[0]) ? binding : [binding]);

/** The model family of a preset id: "h3-fl2va" → "h3". */
export const familyOf = (presetId) => presetId.split('-')[0];

/** Every preset id with its variants, best first (lowest `priority`). */
export function loadCatalog(dir = WORKFLOWS_DIR) {
    const catalog = new Map();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const preset = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        validatePreset(preset, file);
        preset.variant ??= 'default';
        const variants = catalog.get(preset.id) ?? [];
        if (variants.some((v) => v.variant === preset.variant)) throw new Error(`Preset ${file}: ${preset.id} already has a "${preset.variant}" variant.`);
        variants.push(preset);
        variants.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
        catalog.set(preset.id, variants);
    }
    return catalog;
}

/** The best variant of every preset, unchecked: what the app offers before ComfyUI has been seen. */
export const firstVariants = (catalog) => new Map([...catalog].map(([id, variants]) => [id, variants[0]]));

function validatePreset(preset, file) {
    for (const key of ['id', 'card', 'graph', 'bindings', 'output']) {
        if (!preset[key]) throw new Error(`Preset ${file} is missing "${key}".`);
    }
    for (const [name, binding] of Object.entries(preset.bindings)) {
        for (const [title, field] of targetsOf(binding)) {
            const node = findByTitle(preset.graph, title, `${file} binding "${name}"`);
            if (!(field in node.inputs)) throw new Error(`Preset ${file}: node ${title} has no input "${field}".`);
        }
    }
}

function findByTitle(graph, title, context) {
    const matches = Object.values(graph).filter((node) => node._meta?.title === title);
    if (matches.length !== 1) throw new Error(`${context}: expected exactly one node titled ${title}, found ${matches.length}.`);
    return matches[0];
}

/** Deep-copies the graph and writes each provided input into every node its binding targets. */
export function compileGraph(preset, inputs) {
    const graph = structuredClone(preset.graph);
    const values = { ...preset.defaults, ...inputs };
    for (const [name, binding] of Object.entries(preset.bindings)) {
        if (values[name] === undefined) continue;
        for (const [title, field] of targetsOf(binding)) {
            findByTitle(graph, title, `compile ${preset.id}`).inputs[field] = values[name];
        }
    }
    return graph;
}

/**
 * The preset a card renders with: the card's chosen family (settings.family, e.g. "h3") when this
 * engine has it, else the type's default, else whatever it has; narrowed by what is wired in
 * (a first frame or reference picture selects the variant that needs it).
 */
export function choosePreset(presets, { type, settings = {}, wired = [] }) {
    const candidates = [...presets.values()].filter((p) => p.card === type);
    const available = new Set(candidates.map((p) => familyOf(p.id)));
    // A voice wired in is lip sync, which only some families do (LTX): that one renders it.
    const lipSync = wired.includes('audio') ? candidates.find((p) => p.needs?.includes('audio')) : null;
    const family = (lipSync && familyOf(lipSync.id))
        ?? [settings.family, DEFAULT_FAMILY[type]].find((f) => available.has(f)) ?? familyOf(candidates[0]?.id ?? '');
    const pool = candidates.filter((p) => familyOf(p.id) === family);
    // Prefer the variant whose needs are all wired; among those, the one that uses the most.
    const usable = pool.filter((p) => (p.needs ?? []).every((need) => wired.includes(need)));
    usable.sort((a, b) => (b.needs?.length ?? 0) - (a.needs?.length ?? 0));
    return usable[0] ?? null;
}

/** The knob table (src/shared/formats.js) a preset renders with: its own, else its family's. */
export const knobsOf = (preset) => preset.knobs ?? familyOf(preset.id);

/** The families a card type offers, the type's default first, for the card's model picker. */
export function familiesFor(presets, type) {
    const seen = new Map();
    for (const p of presets.values()) {
        const family = familyOf(p.id);
        if (p.card !== type || seen.has(family)) continue;
        seen.set(family, { id: family, label: p.label.replace(/\s*\(.*\)$/, ''), knobs: knobsOf(p) });
    }
    const isDefault = (f) => (f.id === DEFAULT_FAMILY[type] ? 0 : 1);
    return [...seen.values()].sort((a, b) => isDefault(a) - isDefault(b));
}

// Workflow presets: ComfyUI API graphs in workflows/*.json with named input bindings.
// Bindings target nodes by their `_meta.title` marker (e.g. "@positive"), never by numeric id,
// so a workflow re-exported from ComfyUI keeps working as long as the titles are kept.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS_DIR = fileURLToPath(new URL('../../../workflows/', import.meta.url));

/** A binding is [title, field] or a list of them; always return the list form. */
const targetsOf = (binding) => (Array.isArray(binding[0]) ? binding : [binding]);

export function loadPresets(dir = WORKFLOWS_DIR) {
    const presets = new Map();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const preset = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        validatePreset(preset, file);
        presets.set(preset.id, preset);
    }
    return presets;
}

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
 * The preset a card renders with: the card's chosen family (settings.family, e.g. "h3")
 * narrowed by what is wired in (a first frame or reference picture selects the variant that needs it).
 */
export function choosePreset(presets, { type, settings = {}, wired = [] }) {
    const candidates = [...presets.values()].filter((p) => p.card === type);
    const family = settings.family ?? defaultFamily(type);
    const inFamily = candidates.filter((p) => p.id.startsWith(`${family}-`));
    const pool = inFamily.length ? inFamily : candidates;
    // Prefer the variant whose needs are all wired; among those, the one that uses the most.
    const usable = pool.filter((p) => (p.needs ?? []).every((need) => wired.includes(need)));
    usable.sort((a, b) => (b.needs?.length ?? 0) - (a.needs?.length ?? 0));
    return usable[0] ?? null;
}

const defaultFamily = (type) => ({ image: 'zimage', video: 'wan5b' })[type];

/** The families a card type offers, for the card's model picker. */
export function familiesFor(presets, type) {
    const seen = new Map();
    for (const p of presets.values()) {
        if (p.card !== type) continue;
        const family = p.id.split('-')[0];
        if (!seen.has(family)) seen.set(family, p.label.replace(/\s*\(.*\)$/, ''));
    }
    return [...seen].map(([id, label]) => ({ id, label }));
}

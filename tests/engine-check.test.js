import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, familiesFor, choosePreset } from '../src/server/generation/presets.js';
import { missingFor, pickVariants } from '../src/server/generation/engine-check.js';

const catalog = loadCatalog();

/**
 * A fake /object_info that offers exactly what the given presets use: every node class, and
 * every fixed string value as the only dropdown choice (like a ComfyUI with just those files).
 */
function infoFor(presets) {
    const info = {};
    for (const preset of presets) {
        for (const node of Object.values(preset.graph)) {
            const def = (info[node.class_type] ??= { input: { required: {} } });
            for (const [field, value] of Object.entries(node.inputs)) {
                if (typeof value !== 'string') continue;
                const spec = (def.input.required[field] ??= [[]]);
                if (!spec[0].includes(value)) spec[0].push(value);
            }
        }
    }
    return info;
}

const variant = (id, name) => catalog.get(id).find((p) => p.variant === name);
const allOf = (name) => [...catalog.values()].flat().filter((p) => p.variant === name);

test('every preset id has its variants sorted best first', () => {
    assert.deepEqual(catalog.get('zimage-t2i').map((p) => p.variant), ['bf16', 'int8']);
    assert.deepEqual(catalog.get('h3-fl2va').map((p) => p.variant), ['gguf', 'int8']);
    assert.deepEqual(catalog.get('wan5b-t2v').map((p) => p.variant), ['fp16']);
});

test('a variant needs its nodes and model files, not the values the app writes at render time', () => {
    const preset = variant('zimage-i2i', 'int8');
    const info = infoFor([preset]);
    assert.deepEqual(missingFor(preset, info), []); // LoadImage "" is the uploaded picture: bound, not checked

    info.UNETLoader.input.required.unet_name = [['z_image_turbo_bf16.safetensors']];
    assert.deepEqual(missingFor(preset, info), ['z_image_turbo_int8_convrot.safetensors (UNETLoader unet_name)']);

    delete info.ModelSamplingAuraFlow;
    assert.ok(missingFor(preset, info).includes('node ModelSamplingAuraFlow'));
});

test('newer ComfyUI dropdowns (["COMBO", { options }]) are checked too', () => {
    const preset = variant('zimage-t2i', 'int8');
    const info = infoFor([preset]);
    info.CLIPLoader.input.required.type = ['COMBO', { options: ['wan', 'qwen_image'] }];
    assert.deepEqual(missingFor(preset, info), ['lumina2 (CLIPLoader type)']);
});

test('the 12 GB machine gets the int8 variants and no Wan; the 24 GB one keeps its own', () => {
    const small = pickVariants(catalog, infoFor(allOf('int8')));
    assert.equal(small.presets.get('zimage-t2i').variant, 'int8');
    assert.equal(small.presets.get('h3-fl2va').variant, 'int8');
    assert.equal(small.presets.has('wan5b-t2v'), false);
    const wan = small.report.find((r) => r.id === 'wan5b-t2v');
    assert.equal(wan.variant, null);
    assert.ok(wan.missing.includes('wan2.2_ti2v_5B_fp16.safetensors (UNETLoader unet_name)'));
    assert.deepEqual(familiesFor(small.presets, 'video').map((f) => f.id), ['h3']);
    assert.equal(familiesFor(small.presets, 'video')[0].knobs, 'h3-int8');

    const big = pickVariants(catalog, infoFor([...allOf('bf16'), ...allOf('gguf'), ...allOf('fp16')]));
    assert.equal(big.presets.get('zimage-i2i').variant, 'bf16');
    assert.equal(big.presets.get('h3-t2va').variant, 'gguf');
    assert.deepEqual(familiesFor(big.presets, 'video').map((f) => f.id), ['wan5b', 'h3']);
});

test('with both model sets installed the higher-quality variant wins', () => {
    const both = pickVariants(catalog, infoFor([...catalog.values()].flat()));
    assert.equal(both.presets.get('zimage-t2i').variant, 'bf16');
    assert.equal(both.presets.get('h3-t2va').variant, 'gguf');
});

test('first and last frame wired: H3 and LTX travel between them, on both machines for H3', () => {
    const { presets } = pickVariants(catalog, infoFor([...allOf('int8'), ...allOf('distilled-fp8')]));
    const both = ['first_frame', 'last_frame'];
    assert.equal(choosePreset(presets, { type: 'video', settings: { family: 'h3' }, wired: both }).variant, 'int8');
    assert.equal(choosePreset(presets, { type: 'video', settings: { family: 'h3' }, wired: both }).id, 'h3-flf2va');
    assert.equal(choosePreset(presets, { type: 'video', settings: { family: 'ltx' }, wired: both }).id, 'ltx-flf2v');
    assert.equal(variant('h3-flf2va', 'gguf').needs.length, 2);
});

test('a card set to a family this PC lacks renders with one it has', () => {
    const { presets } = pickVariants(catalog, infoFor(allOf('int8')));
    const preset = choosePreset(presets, { type: 'video', settings: { family: 'wan5b' }, wired: [] });
    assert.equal(preset.id, 'h3-t2va');
    assert.equal(choosePreset(presets, { type: 'video', wired: ['first_frame'] }).id, 'h3-fl2va');
});

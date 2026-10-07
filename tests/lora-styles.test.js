import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog, firstVariants, compileGraph, withStyle } from '../src/server/generation/presets.js';
import { familyOfLora, familyFromName, readSafetensorsHeader } from '../src/server/generation/lora-families.js';
import { lorasIn } from '../src/server/generation/engine-check.js';
import { builtInLoras, LoraLibrary, styleLabel } from '../src/server/services/lora-library.js';
import { cardSources } from '../src/server/generation/offered.js';
import { compile } from '../src/server/generation/stages.js';
import { StageError } from '../src/server/generation/pipeline.js';

const catalog = loadCatalog();
const presets = firstVariants(catalog);

/** A safetensors header with one LoRA pair per key: down [rank, width], up [width, rank]. */
const header = (keys, { width = 3072, style = 'peft', meta = {} } = {}) => Object.fromEntries([
    ['__metadata__', meta],
    ...keys.flatMap((k) => (style === 'peft'
        ? [[`${k}.lora_A.weight`, { shape: [16, width] }], [`${k}.lora_B.weight`, { shape: [width, 16] }]]
        : [[`${k}.lora_down.weight`, { shape: [16, width] }], [`${k}.lora_up.weight`, { shape: [width, 16] }], [`${k}.alpha`, { shape: [] }]])),
]);

test('a LoRA is matched to its model by its weights, not by the base model its metadata claims', () => {
    // Shapes of the person's real files (2026-10-08): the Qwen one says "sd_1.5" in its metadata.
    assert.equal(familyOfLora(header(['diffusion_model.transformer_blocks.0.attn.add_k_proj', 'diffusion_model.transformer_blocks.0.img_mlp.net.0.proj'], { meta: { ss_base_model_version: 'sd_1.5' } })), 'qwenedit');
    assert.equal(familyOfLora(header(['diffusion_model.layers.0.adaLN_modulation.0', 'diffusion_model.layers.0.attention.to_k'], { width: 256 })), 'zimage');
    assert.equal(familyOfLora(header(['diffusion_model.blocks.0.attn.qkv_proj'], { width: 7168 })), 'h3');
    assert.equal(familyOfLora(header(['diffusion_model.transformer_blocks.0.attn1.to_q'], { width: 4096 })), 'ltx');
    // Kohya names (underscores) and LoKr (no low-rank shape to read) still match.
    assert.equal(familyOfLora(header(['lora_unet_layers_0_attention_to_k'], { style: 'kohya', width: 3840 })), 'zimage');
    assert.equal(familyOfLora({ 'diffusion_model.layers.0.attention.to_k.lokr_w1': { shape: [4, 4] } }), 'zimage');
});

test('Wan LoRAs are told apart by size: only the 5B model we run is offered one', () => {
    const wan = ['diffusion_model.blocks.0.self_attn.q', 'diffusion_model.blocks.0.cross_attn.k'];
    assert.equal(familyOfLora(header(wan, { width: 3072 })), 'wan5b');
    assert.equal(familyOfLora(header(wan, { width: 5120 })), null, 'Wan 14B');
    assert.equal(familyOfLora(header(['lora_unet_down_blocks_0_attentions_0_proj_in'], { width: 320 })), null, 'an SD 1.5 LoRA');
    assert.equal(familyOfLora({}), null);
});

test('a LoRA the app cannot read is placed by its file name, or not at all', () => {
    assert.equal(familyFromName('zimage_turbo_realism_lora.safetensors'), 'zimage');
    assert.equal(familyFromName('zit_fdpo_v1.safetensors'), 'zimage');
    assert.equal(familyFromName('qwen-image-edit-2511-multiple-angles-lora.safetensors'), 'qwenedit');
    assert.equal(familyFromName('ltx-2.3-cakeify.safetensors'), 'ltx');
    assert.equal(familyFromName('pixel-art-xl.safetensors'), null);
});

test('the safetensors header is read from the file, and a file that is not one is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bloop-lora-'));
    const json = Buffer.from(JSON.stringify(header(['diffusion_model.layers.0.attention.to_k'])));
    const size = Buffer.alloc(8);
    size.writeBigUInt64LE(BigInt(json.length));
    writeFileSync(join(dir, 'style.safetensors'), Buffer.concat([size, json, Buffer.alloc(64)]));
    writeFileSync(join(dir, 'pickle.safetensors'), Buffer.from('PK\x03\x04 not a header at all'));
    assert.equal(familyOfLora(await readSafetensorsHeader(join(dir, 'style.safetensors'))), 'zimage');
    await assert.rejects(readSafetensorsHeader(join(dir, 'pickle.safetensors')));
});

test('a style LoRA goes right after @model in every image and video workflow, and the old links read through it', () => {
    for (const preset of presets.values()) {
        if (preset.card === 'audio') continue;
        const graph = withStyle(compileGraph(preset, { prompt: 'x', seed: 1 }), { name: 'look.safetensors', strength: 0.75 });
        const [styleId, style] = Object.entries(graph).find(([, n]) => n._meta?.title === '@style');
        const [modelId] = Object.entries(graph).find(([, n]) => n._meta?.title === '@model');
        assert.deepEqual(style.inputs, { model: [modelId, 0], lora_name: 'look.safetensors', strength_model: 0.75 }, preset.id);
        const links = Object.entries(graph).filter(([id]) => id !== styleId).flatMap(([, n]) => Object.values(n.inputs)).filter(Array.isArray);
        assert.ok(!links.some(([id, slot]) => id === modelId && slot === 0), `${preset.id}: nothing reads the bare model`);
        assert.ok(links.some(([id]) => id === styleId), `${preset.id}: something reads the style`);
    }
    // LTX's checkpoint also hands out its VAE (output 2): that link stays on the checkpoint.
    const ltx = withStyle(compileGraph(presets.get('ltx-t2v'), {}), { name: 'a.safetensors' });
    assert.ok(Object.values(ltx).some((n) => Object.values(n.inputs).some((v) => Array.isArray(v) && v[0] === '1' && v[1] === 2)));
    // The speed LoRA stacks on the style: model → style → lightning.
    const qwen = withStyle(compileGraph(presets.get('qwenedit-ref1'), {}), { name: 'angles.safetensors' });
    const lightning = Object.values(qwen).find((n) => n._meta?.title === '@lightning');
    assert.equal(qwen[lightning.inputs.model[0]]._meta.title, '@style');
});

test('the workflows\' own speed LoRAs are never offered as a style', () => {
    const builtIn = builtInLoras(catalog);
    assert.ok(builtIn.has('Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors'));
    assert.ok([...builtIn].some((n) => /h3.*turbo/i.test(n)));
    assert.equal(styleLabel('styles\\zimage_turbo_realism_lora.safetensors'), 'zimage turbo realism lora');
    assert.deepEqual(lorasIn({ LoraLoaderModelOnly: { input: { required: { lora_name: [['a.safetensors', 'b.safetensors']] } } } }), ['a.safetensors', 'b.safetensors']);
    assert.deepEqual(lorasIn({}), []);
});

/** A library over fake loras folders: `files` maps a name to its header (null: unreadable), anything else is missing. */
function library(files, { builtIn = builtInLoras(catalog) } = {}) {
    let reads = 0;
    const install = () => ({ kind: 'venv', root: 'C:/ComfyUI' });
    const statFile = async (path) => {
        const name = Object.keys(files).find((n) => path.replaceAll('\\', '/').endsWith(`/loras/${n}`));
        if (!name) throw new Error('ENOENT');
        return { isFile: () => true, size: 100, mtimeMs: 1 };
    };
    const readHeader = async (path) => {
        reads += 1;
        const name = Object.keys(files).find((n) => path.replaceAll('\\', '/').endsWith(`/loras/${n}`));
        if (!files[name]) throw new Error('unreadable');
        return files[name];
    };
    return { lib: new LoraLibrary({ install, builtIn, readHeader, statFile }), reads: () => reads };
}

test('each card model offers only the LoRAs made for it, read once', async () => {
    const files = {
        'realism.safetensors': header(['diffusion_model.layers.0.attention.to_k']),
        'angles.safetensors': header(['transformer.transformer_blocks.0.img_mod.1']),
        'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors': header(['transformer_blocks.0.img_mod.1']),
        'old-sd15.safetensors': header(['lora_unet_down_blocks_0_attentions_0_proj_in'], { width: 320 }),
    };
    const names = [...Object.keys(files), 'zimage-on-another-pc.safetensors', 'risky.ckpt'];
    const { lib, reads } = library(files);
    assert.deepEqual(await lib.stylesFor('zimage', names), [
        { value: 'realism.safetensors', label: 'realism' },
        { value: 'zimage-on-another-pc.safetensors', label: 'zimage-on-another-pc' },
    ]);
    assert.deepEqual((await lib.stylesFor('qwenedit', names)).map((s) => s.value), ['angles.safetensors']);
    assert.deepEqual(await lib.stylesFor('wan5b', names), []);
    assert.equal(reads(), 3, 'realism, angles and sd15 read once each; the built-in one is never read');
});

test('the Model list carries each local family\'s styles; music cards and an engine without LoRAs carry none', async () => {
    const { lib } = library({ 'realism.safetensors': header(['diffusion_model.layers.0.attention.to_k']) });
    const engine = { current: async () => ({ detected: true, presets, loras: ['realism.safetensors'] }) };
    const image = await cardSources({ engine, loras: lib })('image');
    assert.deepEqual(image.families.find((f) => f.id === 'zimage').styles, [{ value: 'realism.safetensors', label: 'realism' }]);
    assert.deepEqual(image.families.find((f) => f.id === 'qwenedit').styles, []);
    assert.equal((await cardSources({ engine, loras: lib })('audio')).families[0].styles, undefined);
    const bare = { current: async () => ({ detected: true, presets, loras: [] }) };
    assert.equal((await cardSources({ engine: bare, loras: lib })('image')).families[0].styles, undefined);
});

/** The compile stage for a card on `presetId` with these settings. */
async function compiled(presetId, settings, { loras = ['realism.safetensors', 'angles.safetensors'] } = {}) {
    const { lib } = library({
        'realism.safetensors': header(['diffusion_model.layers.0.attention.to_k']),
        'angles.safetensors': header(['transformer_blocks.0.img_mod.1']),
    });
    const ctx = {
        node: { id: 1, settings }, preset: presets.get(presetId), uploads: {}, prompt: 'a hangar',
        deps: { engine: { current: async () => ({ loras }) }, loras: lib },
    };
    await compile(ctx, async () => {});
    return ctx;
}

test('Generate renders with the card\'s style at its strength, and the take remembers both', async () => {
    const ctx = await compiled('zimage-t2i', { style: 'realism.safetensors', styleStrength: 0.75 });
    const style = Object.values(ctx.graph).find((n) => n._meta?.title === '@style');
    assert.deepEqual([style.inputs.lora_name, style.inputs.strength_model], ['realism.safetensors', 0.75]);
    assert.deepEqual([ctx.params.style, ctx.params.styleStrength], ['realism.safetensors', 0.75]);
    // An odd strength from another version becomes Full.
    const odd = await compiled('zimage-t2i', { style: 'realism.safetensors', styleStrength: 7 });
    assert.equal(odd.params.styleStrength, 1);
});

test('no style, or one made for another model, renders the workflow as shipped', async () => {
    for (const settings of [{}, { style: 'none' }]) {
        const ctx = await compiled('zimage-t2i', settings);
        assert.ok(!Object.values(ctx.graph).some((n) => n._meta?.title === '@style'));
        assert.equal(ctx.params.style, undefined);
    }
    // Two reference pictures moved this Z-Image card onto Qwen-Image-Edit: its Z-Image style would do nothing there.
    const moved = await compiled('qwenedit-ref2', { style: 'realism.safetensors' });
    assert.ok(!Object.values(moved.graph).some((n) => n._meta?.title === '@style'));
});

test('a style taken out of the loras folder says so instead of failing inside ComfyUI', async () => {
    await assert.rejects(compiled('zimage-t2i', { style: 'realism.safetensors' }, { loras: [] }), (error) => error instanceof StageError && /not in ComfyUI's loras folder any more/.test(error.message));
});

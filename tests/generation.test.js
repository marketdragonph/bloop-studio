import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, firstVariants, compileGraph, choosePreset, familiesFor } from '../src/server/generation/presets.js';
import { composePrompt } from '../src/server/generation/prompt.js';
import { runPipeline } from '../src/server/generation/pipeline.js';
import { phaseOf } from '../src/server/generation/stages.js';

const presets = firstVariants(loadCatalog());

test('every shipped preset loads and its bindings point at real nodes', () => {
    assert.ok(presets.size >= 6);
    for (const id of ['zimage-t2i', 'zimage-i2i', 'wan5b-t2v', 'wan5b-i2v', 'h3-t2va', 'h3-fl2va']) assert.ok(presets.has(id), id);
});

test('every variant of a preset binds the same inputs, so cards render on any machine', () => {
    for (const [id, variants] of loadCatalog()) {
        for (const v of variants) {
            assert.deepEqual(Object.keys(v.bindings).sort(), Object.keys(variants[0].bindings).sort(), `${id} ${v.variant}`);
            assert.deepEqual(v.needs ?? [], variants[0].needs ?? [], `${id} ${v.variant}`);
            assert.equal(v.card, variants[0].card, `${id} ${v.variant}`);
        }
    }
});

test('an image card picks text-to-image, and image-to-image once a picture is wired', () => {
    assert.equal(choosePreset(presets, { type: 'image', wired: [] }).id, 'zimage-t2i');
    assert.equal(choosePreset(presets, { type: 'image', wired: ['reference'] }).id, 'zimage-i2i');
});

test('a video card keeps its chosen family and switches to the first-frame variant', () => {
    assert.equal(choosePreset(presets, { type: 'video', wired: [] }).id, 'wan5b-t2v');
    assert.equal(choosePreset(presets, { type: 'video', settings: { family: 'h3' }, wired: ['first_frame'] }).id, 'h3-fl2va');
    assert.deepEqual(familiesFor(presets, 'video').map((f) => f.id), ['wan5b', 'h3', 'ltx']); // the default first
    assert.equal(choosePreset(presets, { type: 'video', settings: { family: 'ltx' }, wired: ['first_frame'] }).id, 'ltx-i2v');
});

test('compileGraph writes a multi-target binding into every node and leaves the preset untouched', () => {
    const preset = presets.get('wan5b-i2v');
    const graph = compileGraph(preset, { prompt: 'a mecha walks', seed: 7, width: 640, first_frame: 'still.png' });
    const byTitle = (title) => Object.values(graph).find((n) => n._meta.title === title);
    assert.equal(byTitle('@latent').inputs.width, 640);
    assert.equal(byTitle('@resize').inputs.width, 640);
    assert.equal(byTitle('@image').inputs.image, 'still.png');
    assert.equal(byTitle('@sampler').inputs.seed, 7);
    assert.equal(Object.values(preset.graph).find((n) => n._meta.title === '@latent').inputs.width, 832);
});

test('prompts come only from wired text; H3 gets its three sections', () => {
    const upstream = [{ to_socket: 'prompt', text_content: 'A hangar at night.' }, { to_socket: 'first_frame', text_content: 'ignored' }];
    assert.equal(composePrompt({ upstream }), 'A hangar at night.');
    const h3 = composePrompt({ upstream, dialect: 'h3' });
    assert.match(h3, /^integrated_multimodal_description: \[Shot 1\]/);
    assert.match(h3, /overall_soundscape:/);
    assert.match(h3, /non_diegetic_music:/);
});

test('cast and location text follow the shot text, named by their card label', () => {
    const upstream = [
        { to_socket: 'prompt', label: 'Cast · Officer Reyes', text_content: 'Woman, 40s, short grey hair, navy uniform.' },
        { to_socket: 'prompt', label: 'Location · Night market', text_content: 'Wet stalls under neon.' },
        { to_socket: 'prompt', label: 'Shot 3 · Sprint', text_content: 'Reyes sprints through the market.' },
    ];
    assert.equal(
        composePrompt({ upstream }),
        'Reyes sprints through the market.\n\nOfficer Reyes: Woman, 40s, short grey hair, navy uniform.\n\nNight market: Wet stalls under neon.',
    );
});

test('pipeline stages run in order and a stage can stop the chain', async () => {
    const seen = [];
    await runPipeline([
        async (ctx, next) => { seen.push('a'); await next(); },
        async (ctx) => { seen.push('b'); },
        async () => { seen.push('never'); },
    ], {});
    assert.deepEqual(seen, ['a', 'b']);
});

test('after the steps, the card says what ComfyUI is doing instead of sitting on 100%', () => {
    assert.equal(phaseOf('VAEDecodeTiled', 'video'), 'Decoding video');
    assert.equal(phaseOf('VAEDecode', 'image'), 'Decoding');
    assert.equal(phaseOf('SaveVideo', 'video'), 'Saving');
    assert.equal(phaseOf('UnetLoaderGGUF', 'video'), 'Loading models');
    assert.equal(phaseOf('KSampler', 'video'), null); // the sampler reports its own steps
});

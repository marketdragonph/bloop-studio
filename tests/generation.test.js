import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPresets, compileGraph, choosePreset, familiesFor } from '../src/server/generation/presets.js';
import { composePrompt } from '../src/server/generation/prompt.js';
import { runPipeline } from '../src/server/generation/pipeline.js';

const presets = loadPresets();

test('every shipped preset loads and its bindings point at real nodes', () => {
    assert.ok(presets.size >= 6);
    for (const id of ['zimage-t2i', 'zimage-i2i', 'wan5b-t2v', 'wan5b-i2v', 'h3-t2va', 'h3-fl2va']) assert.ok(presets.has(id), id);
});

test('an image card picks text-to-image, and image-to-image once a picture is wired', () => {
    assert.equal(choosePreset(presets, { type: 'image', wired: [] }).id, 'zimage-t2i');
    assert.equal(choosePreset(presets, { type: 'image', wired: ['reference'] }).id, 'zimage-i2i');
});

test('a video card keeps its chosen family and switches to the first-frame variant', () => {
    assert.equal(choosePreset(presets, { type: 'video', wired: [] }).id, 'wan5b-t2v');
    assert.equal(choosePreset(presets, { type: 'video', settings: { family: 'h3' }, wired: ['first_frame'] }).id, 'h3-fl2va');
    assert.deepEqual(familiesFor(presets, 'video').map((f) => f.id).sort(), ['h3', 'wan5b']);
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

test('prompts join wired text and the card direction; H3 gets its three sections', () => {
    const upstream = [{ to_socket: 'prompt', text_content: 'A hangar at night.' }, { to_socket: 'first_frame', text_content: 'ignored' }];
    const node = { prompt: 'Slow push-in.' };
    assert.equal(composePrompt({ node, upstream }), 'A hangar at night.\n\nSlow push-in.');
    const h3 = composePrompt({ node, upstream, dialect: 'h3' });
    assert.match(h3, /^integrated_multimodal_description: \[Shot 1\]/);
    assert.match(h3, /overall_soundscape:/);
    assert.match(h3, /non_diegetic_music:/);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePreset, compileGraph, familiesFor, firstVariants, loadCatalog } from '../src/server/generation/presets.js';
import { knobInputs, knobOptions } from '../src/shared/formats.js';
import { LyricsPrompt } from '../src/server/generation/prompt.js';
import { collectOutput } from '../src/server/generation/stages.js';
import { isTextSocket } from '../src/shared/node-types.js';
import { planFor } from '../src/server/engine-install/plan.js';

const presets = firstVariants(loadCatalog());
const findTitle = (graph, title) => Object.values(graph).find((n) => n._meta?.title === title);

test('an Audio card renders music on this PC: ACE-Step by default, MiniMax Music 3 when picked', () => {
    assert.equal(choosePreset(presets, { type: 'audio', wired: [] }).id, 'acestep-t2a');
    assert.equal(choosePreset(presets, { type: 'audio', settings: { family: 'music3' }, wired: [] }).id, 'music3-t2a');
    assert.deepEqual(familiesFor(presets, 'audio').map((f) => [f.id, f.label]), [['acestep', 'ACE-Step 1.5 Turbo'], ['music3', 'MiniMax Music 3']]);
});

test('Words is the style, Lyrics what is sung, and the length goes to every node that needs it', () => {
    const ace = presets.get('acestep-t2a');
    const graph = compileGraph(ace, { prompt: 'warm lo-fi, piano', lyrics: '[verse]\nhello', duration: 90, seed: 7 });
    assert.equal(findTitle(graph, '@positive').inputs.tags, 'warm lo-fi, piano');
    assert.equal(findTitle(graph, '@positive').inputs.lyrics, '[verse]\nhello');
    assert.equal(findTitle(graph, '@latent').inputs.seconds, 90);
    assert.equal(findTitle(graph, '@positive').inputs.duration, 90);
    // No lyrics wired: an instrumental, not an empty song.
    assert.equal(findTitle(compileGraph(ace, { prompt: 'x' }), '@positive').inputs.lyrics, '[Instrumental]');
    const mm = compileGraph(presets.get('music3-t2a'), { prompt: 'synthwave', duration: 60, seed: 1 });
    assert.equal(findTitle(mm, '@positive').inputs.caption, 'synthwave');
    assert.equal(findTitle(mm, '@positive').inputs.max_duration, 60);
});

test('music knobs: only a length, 30 s unless picked, no aspect or quality', () => {
    assert.deepEqual(knobInputs('acestep', {}), { duration: 30 });
    assert.deepEqual(knobInputs('music3', { duration: 120 }), { duration: 120 });
    assert.deepEqual(knobInputs('acestep', { duration: 7 }), { duration: 30 });
    const options = knobOptions('music3');
    assert.deepEqual([options.aspects, options.resolutions, options.qualities], [[], [], []]);
    assert.equal(options.durations.find((d) => d.value === 90).label, '1 min 30 s');
    assert.deepEqual(options.defaults, { duration: 30 });
});

test('a Lyrics wire is words, never a picture to render first', () => {
    assert.ok(isTextSocket('lyrics') && isTextSocket('prompt') && !isTextSocket('first_frame'));
    const upstream = [{ to_socket: 'prompt', text_content: 'rock' }, { to_socket: 'lyrics', text_content: '  la la  ' }];
    assert.equal(new LyricsPrompt(upstream).create(), 'la la');
    assert.equal(new LyricsPrompt([]).create(), '');
});

test('the song ComfyUI saved becomes the card\'s take', async () => {
    let saved;
    const ctx = {
        node: { id: 3, space_id: 1 }, promptId: 'p', seed: 5, params: {}, prompt: 'rock', preset: { id: 'acestep-t2a', variant: 'turbo' },
        deps: {
            comfy: { history: async () => ({ outputs: { 10: { audio: [{ filename: 'audio_00001_.mp3', subfolder: 'bloop-studio', type: 'output' }] } } }), download: async () => Buffer.from('mp3') },
            media: { saveTake: async (take) => { saved = take; return 'space-1/take.mp3'; } },
            jobs: { addTake() {} },
            spaces: { setNodeResult() {}, updateNode() {} },
        },
    };
    await collectOutput(ctx, async () => {});
    assert.equal(saved.mime, 'audio/mpeg');
    assert.equal(ctx.result.media_path, 'space-1/take.mp3');
});

test('the installer offers music on a 12 GB NVIDIA card, unticked, and not on AMD', () => {
    const nvidia = planFor({ gpu: { vendor: 'nvidia', vramGb: 12 } });
    const music = nvidia.families.filter((f) => f.kind === 'audio');
    assert.deepEqual(music.map((f) => [f.id, f.suggested]), [['acestep', false], ['music3', false]]);
    assert.ok(music.every((f) => f.licenses.every((l) => l.name === 'apache-2.0')));
    assert.ok(!planFor({ gpu: { vendor: 'amd', vramGb: 24 } }).families.some((f) => f.kind === 'audio'));
});

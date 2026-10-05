import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSocket, socketsOf, sourceKinds } from '../src/shared/node-types.js';
import { choosePreset, compileGraph, firstVariants, loadCatalog } from '../src/server/generation/presets.js';
import { knobInputs } from '../src/shared/formats.js';
import { cloudFamilies, cloudParams } from '../src/server/generation/cloud-models.js';
import { mimeFromName } from '../src/server/generation/media-store.js';

const presets = firstVariants(loadCatalog());
const findTitle = (graph, title) => Object.values(graph).find((n) => n._meta?.title === title);

test('a voice goes into a Video card\'s Voice / audio socket; an Audio card offers a voice and takes lyrics', () => {
    const video = { type: 'video' };
    assert.ok(socketsOf('video').some((s) => s.key === 'audio' && s.accepts.includes('audio')));
    const voice = { type: 'upload', media_mime: 'audio/mpeg' };
    assert.equal(socketsOf('video')[pickSocket(voice, video)].key, 'audio');
    assert.deepEqual(sourceKinds({ type: 'audio' }), ['audio']);
    assert.deepEqual(socketsOf('audio').map((s) => s.key), ['prompt', 'lyrics']);
    assert.equal(mimeFromName('line-01.mp3'), 'audio/mpeg');
    assert.equal(mimeFromName('line-01.wav'), 'audio/wav');
});

test('a picture and a voice wired in render lip sync on LTX, even when the card was set to another model', () => {
    const lipSync = choosePreset(presets, { type: 'video', settings: { family: 'h3' }, wired: ['first_frame', 'audio'] });
    assert.equal(lipSync.id, 'ltx-ia2v');
    // Without the voice, the card's own pick stands.
    assert.notEqual(choosePreset(presets, { type: 'video', settings: { family: 'h3' }, wired: ['first_frame'] }).id, 'ltx-ia2v');
});

test('the voice is trimmed to the clip\'s exact length and kept as it is (lips follow it)', () => {
    const preset = presets.get('ltx-ia2v');
    const inputs = knobInputs('ltx', { resolution: '480p', duration: 4 });
    const graph = compileGraph(preset, { ...inputs, prompt: 'She sings.', seed: 7, first_frame: 'face.png', audio: 'voice.mp3' });
    assert.equal(findTitle(graph, '@audio').inputs.audio, 'voice.mp3');
    assert.equal(findTitle(graph, '@audio_trim').inputs.duration, (inputs.length - 1) / 25);
    assert.equal(findTitle(graph, '@audio_keep').inputs.value, 0); // mask 0: the voice is not regenerated
    assert.equal(findTitle(graph, '@latent').inputs.length, inputs.length);
});

test('bloop voice models offer their voices on the card, whatever the vendor calls them', () => {
    const models = {
        audio: [
            { key: 'elevenlabs/turbo-v2.5', name: 'ElevenLabs Turbo', credits: 4, params: { voice: { type: 'select', options: ['Rachel', 'Adam'], default: 'Rachel' } } },
            { key: 'minimax/speech-2.8-hd', name: 'MiniMax HD', credits: 11, params: { voice_id: { type: 'select', options: ['Wise_Woman', 'Deep_Voice_Man'] } } },
            { key: 'elevenlabs/sound-effect-v2', name: 'Sound effects', credits: 2, params: { duration: { type: 'number', min: 1, max: 3, step: 1 } } },
        ],
    };
    const [eleven, minimax, sfx] = cloudFamilies(models, 'audio');
    assert.deepEqual(eleven.options.voices.map((v) => v.value), ['Rachel', 'Adam']);
    assert.equal(eleven.defaults.voice, 'Rachel');
    assert.deepEqual(minimax.options.voices.map((v) => v.value), ['Wise_Woman', 'Deep_Voice_Man']);
    assert.deepEqual(sfx.options.voices, []);
    assert.deepEqual(sfx.options.durations.map((d) => d.value), [1, 2, 3]);

    assert.deepEqual(cloudParams(models.audio[0], { voice: 'Adam' }), { voice: 'Adam' });
    assert.deepEqual(cloudParams(models.audio[1], { voice: 'Deep_Voice_Man' }), { voice_id: 'Deep_Voice_Man' });
    assert.deepEqual(cloudParams(models.audio[1], { voice: 'Not a voice' }), {}); // never a value the model does not offer
});

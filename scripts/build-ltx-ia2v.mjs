// Builds workflows/ltx-ia2v.json (picture + audio → talking video) from ltx-i2v.json, so the two
// stay one graph apart: the empty audio track is replaced by the wired audio, trimmed to the clip's
// length and FROZEN (noise mask 0), so LTX animates the picture to it — lips included — instead of
// inventing a soundtrack. Same pattern as the official video_ltx2_3_ia2v template, single stage.
//
//   node scripts/build-ltx-ia2v.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../workflows/', import.meta.url);
const base = JSON.parse(readFileSync(new URL('ltx-i2v.json', dir), 'utf8'));
const flow = structuredClone(base);

flow.id = 'ltx-ia2v';
flow.label = 'LTX-2.3 Distilled (lip sync a picture to audio)';
flow.needs = ['first_frame', 'audio'];
flow.bindings.audio = ['@audio', 'audio'];
flow.bindings.seconds = ['@audio_trim', 'duration'];
// The empty audio latent's length binding goes; the audio's own length sets it now.
flow.bindings.length = flow.bindings.length.filter(([title]) => title !== '@audio_latent');
flow.defaults = { ...flow.defaults, seconds: (flow.defaults.length - 1) / 25 };

const g = flow.graph;
const id = (title) => Object.keys(g).find((k) => g[k]._meta?.title === title);
const audioVae = id('@audio_vae');
const empty = id('@audio_latent');
delete g[empty];

g[25] = { class_type: 'LoadAudio', inputs: { audio: '' }, _meta: { title: '@audio' } };
g[26] = { class_type: 'TrimAudioDuration', inputs: { audio: ['25', 0], start_index: 0, duration: 4.8 }, _meta: { title: '@audio_trim' } };
g[27] = { class_type: 'LTXVAudioVAEEncode', inputs: { audio: ['26', 0], audio_vae: [audioVae, 0] }, _meta: { title: '@audio_encode' } };
g[28] = { class_type: 'SolidMask', inputs: { value: 0, width: 512, height: 512 }, _meta: { title: '@audio_keep' } };
g[29] = { class_type: 'SetLatentNoiseMask', inputs: { samples: ['27', 0], mask: ['28', 0] }, _meta: { title: '@audio_latent' } };

const concat = id('@av_latent');
g[concat].inputs.audio_latent = ['29', 0];

writeFileSync(new URL('ltx-ia2v.json', dir), `${JSON.stringify(flow, null, 2)}\n`);
console.log('workflows/ltx-ia2v.json', Object.keys(g).length, 'nodes');

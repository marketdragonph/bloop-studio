// Runs one workflow preset straight against ComfyUI (no app, no database) and saves the output.
// The variant is picked like the app does (first one this ComfyUI can run).
// Usage: node scripts/try-preset.mjs <presetId> "<prompt>" [imagePath[,lastImagePath]] [seed]
// Knob overrides as JSON in TRY_INPUTS, e.g. TRY_INPUTS='{"width":1344,"height":768,"length":124}'.
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadCatalog, compileGraph } from '../src/server/generation/presets.js';
import { pickVariants } from '../src/server/generation/engine-check.js';
import { composePrompt } from '../src/server/generation/prompt.js';
import { ComfyClient } from '../src/server/services/comfy-client.js';

const [presetId, text, imagePath, seedArg] = process.argv.slice(2);
const comfy = new ComfyClient(process.env.COMFY_URL ?? 'http://127.0.0.1:8188');
const { presets, report } = pickVariants(loadCatalog(), await comfy.objectInfo());
const preset = presets.get(presetId);
if (!preset) throw new Error(`${presetId} cannot run on this ComfyUI: ${report.find((r) => r.id === presetId)?.missing.join(', ') ?? 'unknown preset'}`);
console.log(`${presetId}: variant ${preset.variant}`);

const inputs = {
    prompt: composePrompt({ node: { prompt: '' }, upstream: [{ to_socket: 'prompt', text_content: text }], dialect: preset.dialect }),
    seed: Number(seedArg ?? 42),
    ...JSON.parse(process.env.TRY_INPUTS ?? '{}'),
};
const imagePaths = (imagePath ?? '').split(',').filter(Boolean); // first frame / reference, then last frame
for (const [i, need] of (preset.needs ?? []).entries()) {
    const path = imagePaths[i];
    if (!path) throw new Error(`${presetId} needs an image for ${need}.`);
    inputs[need] = await comfy.uploadImage(await readFile(path), `try-${basename(path)}`, 'image/png');
}

const clientId = `try-${randomUUID()}`;
const started = Date.now();
let lastStep = '';
const socket = comfy.listen(clientId, (msg) => {
    if (msg.type === 'progress') {
        const step = `step ${msg.data.value}/${msg.data.max}`;
        if (step !== lastStep) console.log(`${Math.round((Date.now() - started) / 1000)}s ${step}`);
        lastStep = step;
    }
});
await socket.opened;
const promptId = await comfy.submit(compileGraph(preset, inputs), clientId);
console.log(`submitted ${presetId} as ${promptId}`);

for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const entry = await comfy.history(promptId).catch(() => null);
    if (entry?.status?.status_str === 'error') throw new Error(JSON.stringify(entry.status.messages).slice(0, 800));
    if (entry?.status?.completed) {
        const file = Object.values(entry.outputs).flatMap((o) => [...(o.images ?? []), ...(o.videos ?? []), ...(o.gifs ?? [])])[0];
        const out = `C:/ComfyUI/output/test/try-${presetId}-${preset.variant}-${Date.now()}${file.filename.slice(file.filename.lastIndexOf('.'))}`;
        await writeFile(out, await comfy.download(file));
        console.log(`done in ${Math.round((Date.now() - started) / 1000)}s -> ${out}`);
        break;
    }
}
socket.close();

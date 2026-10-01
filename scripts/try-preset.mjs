// Runs one workflow preset straight against ComfyUI (no app, no database) and saves the output.
// Usage: node scripts/try-preset.mjs <presetId> "<prompt>" [imagePath] [seed]
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadPresets, compileGraph } from '../src/server/generation/presets.js';
import { composePrompt } from '../src/server/generation/prompt.js';
import { ComfyClient } from '../src/server/services/comfy-client.js';

const [presetId, text, imagePath, seedArg] = process.argv.slice(2);
const preset = loadPresets().get(presetId);
if (!preset) throw new Error(`Unknown preset ${presetId}`);

const comfy = new ComfyClient(process.env.COMFY_URL ?? 'http://127.0.0.1:8188');
const inputs = { prompt: composePrompt({ node: { prompt: '' }, upstream: [{ to_socket: 'prompt', text_content: text }], dialect: preset.dialect }), seed: Number(seedArg ?? 42) };
for (const need of preset.needs ?? []) {
    if (!imagePath) throw new Error(`${presetId} needs an image (${need}).`);
    inputs[need] = await comfy.uploadImage(await readFile(imagePath), `try-${basename(imagePath)}`, 'image/png');
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
        const out = `C:/ComfyUI/output/test/try-${presetId}-${Date.now()}${file.filename.slice(file.filename.lastIndexOf('.'))}`;
        await writeFile(out, await comfy.download(file));
        console.log(`done in ${Math.round((Date.now() - started) / 1000)}s -> ${out}`);
        break;
    }
}
socket.close();

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODEL_FAMILIES } from '../src/shared/model-sources.js';
import { filesFor, folderFor, MAX_FOLDER_CHARS, planFor } from '../src/server/engine-install/plan.js';
import { parseAdapters } from '../src/server/engine-install/hardware.js';
import { download } from '../src/server/engine-install/download.js';
import { EngineInstaller } from '../src/server/engine-install/installer.js';

const gpu = (vendor, vramGb, name = 'Card') => ({ vendor, vramGb, name });
const drives = [{ letter: 'C', freeGb: 1700, totalGb: 2000 }];
const suggested = (plan) => plan.families.filter((f) => f.suggested).map((f) => `${f.id}:${f.variant}`);

test('every model file a shipped workflow loads has a source to download it from', () => {
    const known = new Set(MODEL_FAMILIES.flatMap((f) => Object.values(f.variants).flat().map((file) => file.name)));
    const dir = new URL('../workflows/', import.meta.url);
    for (const name of ['zimage-t2i.json', 'zimage-t2i.int8.json', 'ltx-t2v.json', 'h3-t2va.int8.json', 'wan5b-t2v.json']) {
        const workflow = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
        for (const node of Object.values(workflow.graph)) {
            for (const value of Object.values(node.inputs ?? {})) {
                if (typeof value === 'string' && /\.safetensors$/.test(value)) assert.ok(known.has(value), `${name}: no source for ${value}`);
            }
        }
    }
});

test('the suggestions follow the card: 12 GB NVIDIA gets the int8 set, 24 GB the full one, AMD pictures (beta)', () => {
    assert.deepEqual(suggested(planFor({ gpu: gpu('nvidia', 12), drives })), ['zimage:int8', 'ltx:distilled-fp8']);
    assert.deepEqual(suggested(planFor({ gpu: gpu('nvidia', 24), drives })), ['zimage:bf16', 'ltx:distilled-fp8']);
    const amd = planFor({ gpu: gpu('amd', 24), drives });
    assert.deepEqual(suggested(amd), ['zimage:bf16']);
    assert.equal(amd.beta, true);
    assert.match(amd.comfy.url, /portable_amd\.7z$/);
    const small = planFor({ gpu: gpu('nvidia', 6), drives });
    assert.equal(small.tooSmall, true);
    assert.equal(small.families.length, 0);
    assert.equal(planFor({ gpu: null, drives }).tooSmall, true);
});

test('a shared file is fetched once; the folder is on C: with room, else the roomiest drive', () => {
    const plan = planFor({ gpu: gpu('nvidia', 12), drives });
    const files = filesFor(plan, ['zimage', 'ltx']);
    assert.equal(new Set(files.map((f) => f.name)).size, files.length);
    assert.match(folderFor(drives, 60, { LOCALAPPDATA: 'C:\\Users\\jo\\AppData\\Local' }), /^C:\\Users\\jo\\AppData\\Local\\Bloop Studio\\engine$/);
    assert.equal(folderFor([{ letter: 'D', freeGb: 900 }, { letter: 'C', freeGb: 30 }], 60, {}), 'D:\\Bloop Studio\\engine');
    // Short enough for ComfyUI's deepest file under Windows' 260-character limit, even with a long user name.
    assert.ok(folderFor(drives, 60, { LOCALAPPDATA: 'C:\\Users\\a-very-long-username\\AppData\\Local' }).length <= MAX_FOLDER_CHARS);
});

test('the biggest card in the registry is the one that renders', () => {
    const card = parseAdapters('Intel(R) UHD Graphics|1073741824|Intel Corporation\r\nNVIDIA GeForce RTX 3080 Ti|12884901888|NVIDIA\r\n');
    assert.deepEqual(card, { name: 'NVIDIA GeForce RTX 3080 Ti', vendor: 'nvidia', vramGb: 12 });
    assert.equal(parseAdapters('AMD Radeon RX 7900 XTX|25753026560|Advanced Micro Devices, Inc.').vendor, 'amd');
});

/** A local file server that honours Range, and can drop the connection once. */
async function fileServer(body, { dropAt = null } = {}) {
    let dropped = false;
    const server = createServer((req, res) => {
        const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0);
        res.writeHead(start ? 206 : 200, { 'Content-Length': body.length - start });
        if (dropAt && !dropped && start < dropAt) {
            dropped = true;
            res.write(body.subarray(start, dropAt));
            return res.destroy();
        }
        res.end(body.subarray(start));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}/file`, close: () => server.close() };
}

test('a dropped download resumes where it stopped and is checked against its SHA-256', async () => {
    const body = Buffer.alloc(256 * 1024, 7);
    const sha256 = createHash('sha256').update(body).digest('hex');
    const server = await fileServer(body, { dropAt: 100 * 1024 });
    const dir = mkdtempSync(join(tmpdir(), 'bloop-dl-'));
    try {
        const target = join(dir, 'models', 'vae', 'ae.safetensors');
        await download({ url: server.url, size: body.length, sha256 }, target);
        assert.deepEqual(readFileSync(target), body);
        assert.equal(existsSync(`${target}.part`), false);

        // A wrong checksum is refused and nothing is left in place.
        await assert.rejects(download({ url: server.url, size: body.length, sha256: '0'.repeat(64) }, join(dir, 'bad.bin')), /checksum/);
        assert.equal(existsSync(join(dir, 'bad.bin')), false);
    } finally {
        server.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the installer fetches ComfyUI, unpacks it, adds the models into its folders and starts it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bloop-install-'));
    const store = {};
    const fetched = [];
    const launcher = { started: 0, install() {}, state: () => ({ running: false }), start() { this.started++; } };
    const installer = new EngineInstaller({
        settings: { get: (k) => store[k], update: (v) => Object.assign(store, v) },
        launcher,
        freeGb: () => 5000,
        download: async (file, target) => fetched.push(target.slice(dir.length + 1)),
        unpack: async (_archive, into) => {
            // What the real archive holds: the portable folder with its python and ComfyUI.
            const root = join(into, 'ComfyUI_windows_portable');
            for (const f of ['python_embeded/python.exe', 'ComfyUI/main.py', 'run_nvidia_gpu.bat']) {
                const path = join(root, f);
                mkdirSync(join(path, '..'), { recursive: true });
                writeFileSync(path, f.endsWith('.bat') ? '.\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build' : '');
            }
        },
    });
    try {
        const plan = planFor({ gpu: gpu('nvidia', 12), drives });
        installer.start(plan, { folder: dir, families: ['zimage'] });
        assert.equal(store.engineInstall.families[0], 'zimage'); // remembered, so a closed app can carry on
        for (let i = 0; i < 50 && installer.state().phase !== 'done'; i++) await new Promise((r) => setTimeout(r, 20));

        assert.equal(installer.state().phase, 'done', installer.state().error);
        assert.match(fetched[0], /downloads[\\/]ComfyUI_windows_portable_0\.38\.0\.7z$/);
        assert.ok(fetched.some((f) => /ComfyUI_windows_portable[\\/]ComfyUI[\\/]models[\\/]diffusion_models[\\/]z_image_turbo_int8_convrot\.safetensors$/.test(f)));
        assert.equal(store.comfyPath, join(dir, 'ComfyUI_windows_portable'));
        assert.equal(store.engineInstall, null);
        assert.equal(launcher.started, 1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('no room, or nothing picked, is refused before anything is written', () => {
    const store = {};
    const installer = new EngineInstaller({ settings: { get: (k) => store[k], update: (v) => Object.assign(store, v) }, launcher: {}, freeGb: () => 10 });
    assert.throws(() => installer.start(planFor({ gpu: gpu('nvidia', 12), drives }), { folder: 'D:\\engine', families: ['zimage', 'ltx'] }), /Not enough free space/);
    assert.equal(store.engineInstall, undefined);
});

test('into the person\'s own ComfyUI: only the models, into its models folders, and it is not reinstalled', async () => {
    const store = {};
    const fetched = [];
    const installer = new EngineInstaller({
        settings: { get: (k) => store[k], update: (v) => Object.assign(store, v) },
        launcher: { start: () => assert.fail('an existing ComfyUI is not restarted behind the person\'s back') },
        freeGb: () => 5000,
        download: async (_file, target) => fetched.push(target),
        unpack: async () => assert.fail('nothing to unpack'),
    });
    installer.start(planFor({ gpu: gpu('nvidia', 12), drives }), { folder: '', families: ['zimage'], into: { root: 'C:\ComfyUI', kind: 'portable' } });
    for (let i = 0; i < 50 && installer.state().phase !== 'added'; i++) await new Promise((r) => setTimeout(r, 20));

    assert.equal(installer.state().phase, 'added', installer.state().error);
    assert.deepEqual(fetched, [
        join('C:\ComfyUI', 'ComfyUI', 'models', 'diffusion_models', 'z_image_turbo_int8_convrot.safetensors'),
        join('C:\ComfyUI', 'ComfyUI', 'models', 'text_encoders', 'qwen_3_4b_fp8_mixed.safetensors'),
        join('C:\ComfyUI', 'ComfyUI', 'models', 'vae', 'ae.safetensors'),
    ]);
    assert.equal(store.comfyPath, undefined); // still the person's own setting
});

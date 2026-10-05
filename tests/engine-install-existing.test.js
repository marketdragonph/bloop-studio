import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODEL_FAMILIES } from '../src/shared/model-sources.js';
import { planFor } from '../src/server/engine-install/plan.js';
import { EngineInstaller, modelsBytes } from '../src/server/engine-install/installer.js';
import { parseExtraPaths } from '../src/server/services/comfy-model-paths.js';

const plan12 = () => planFor({ gpu: { vendor: 'nvidia', vramGb: 12, name: 'Card' }, drives: [{ letter: 'C', freeGb: 1700 }] });

/** A portable ComfyUI that keeps its VAEs on "another drive" through extra_model_paths.yaml. */
function existingComfy() {
    const dir = mkdtempSync(join(tmpdir(), 'bloop-into-'));
    const root = join(dir, 'ComfyUI_windows_portable');
    const elsewhere = join(dir, 'models-on-another-drive');
    mkdirSync(join(root, 'ComfyUI', 'models'), { recursive: true });
    writeFileSync(join(root, 'ComfyUI', 'extra_model_paths.yaml'), `mine:\n    base_path: ${elsewhere.replaceAll('\\', '/')}\n    vae: vae\n`);
    const vae = MODEL_FAMILIES[0].variants.int8.find((f) => f.name === 'ae.safetensors');
    mkdirSync(join(elsewhere, 'vae'), { recursive: true });
    writeFileSync(join(elsewhere, 'vae', vae.name), '');
    truncateSync(join(elsewhere, 'vae', vae.name), vae.size); // already there, full size
    return { dir, root, vae };
}

test('into the person\'s own ComfyUI: only the models it lacks, looked for in its extra model folders too', async () => {
    const { dir, root } = existingComfy();
    const store = {};
    const fetched = [];
    const refreshed = [];
    const installer = new EngineInstaller({
        settings: { get: (k) => store[k], update: (v) => Object.assign(store, v) },
        launcher: { start: () => assert.fail('an existing ComfyUI is not restarted behind the person\'s back') },
        freeGb: () => 5000,
        download: async (_file, target) => fetched.push(target),
        unpack: async () => assert.fail('nothing to unpack'),
        engine: { current: async ({ refresh }) => (refreshed.push(refresh), { detected: true }) },
    });
    try {
        installer.start(plan12(), { folder: '', families: ['zimage'], into: { root, kind: 'portable' } });
        for (let i = 0; i < 50 && installer.state().phase !== 'added'; i++) await new Promise((r) => setTimeout(r, 20));

        assert.equal(installer.state().phase, 'added', installer.state().error);
        // New files go to its own models folder; the VAE it keeps elsewhere is not fetched again.
        assert.deepEqual(fetched, [
            join(root, 'ComfyUI', 'models', 'diffusion_models', 'z_image_turbo_int8_convrot.safetensors'),
            join(root, 'ComfyUI', 'models', 'text_encoders', 'qwen_3_4b_fp8_mixed.safetensors'),
        ]);
        assert.equal(store.comfyPath, undefined); // still the person's own setting
        // ComfyUI sees the new files at once; the app checks again, so the families show without Re-detect.
        assert.deepEqual(refreshed, [true]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('disk used counts the extra model folders too', async () => {
    const { dir, root, vae } = existingComfy();
    try {
        assert.equal(await modelsBytes({ root, kind: 'portable' }), vae.size);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('extra_model_paths.yaml: base paths, plain and block values, comments', () => {
    const sections = parseExtraPaths([
        '# my models',
        'comfyui:',
        '    base_path: D:/models/',
        '    is_default: true',
        '    checkpoints: checkpoints  # big ones',
        '    loras: |',
        '        loras',
        '        E:/more-loras',
        'other:',
        '    vae: vae',
    ].join('\n'), 'C:/ComfyUI/ComfyUI');
    assert.equal(sections.length, 2);
    assert.equal(sections[0].base, join('D:/models'));
    assert.deepEqual(sections[0].folders, { checkpoints: ['checkpoints'], loras: ['loras', 'E:/more-loras'] });
    assert.equal(sections[1].base, join('C:/ComfyUI/ComfyUI'));
});

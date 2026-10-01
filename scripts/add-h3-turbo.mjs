// One-off: adds the H3 Turbo 8-step LoRA to both H3 presets (tested 2026-10-01: 8 steps ≈ 4.7 min
// vs 8.5 min at 20, same quality). Idempotent.
import { readFileSync, writeFileSync } from 'node:fs';

const LORA = 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors';

for (const file of ['workflows/h3-t2va.json', 'workflows/h3-fl2va.json']) {
    const preset = JSON.parse(readFileSync(file, 'utf8'));
    const g = preset.graph;
    if (!g['150']) {
        g['150'] = { class_type: 'LoraLoaderModelOnly', _meta: { title: '@turbo' }, inputs: { model: ['130', 0], lora_name: LORA, strength_model: 1 } };
        g['126'].inputs.model = ['150', 0];
        g['124'].inputs.model = ['150', 0];
    }
    g['124'].inputs.steps = 8;
    preset.defaults.steps = 8;
    preset.label = preset.label.replace('MiniMax-H3', 'MiniMax-H3 Turbo');
    if (!preset.models.some(([, name]) => name === LORA)) preset.models.push(['loras', LORA]);
    writeFileSync(file, `${JSON.stringify(preset, null, 2)}\n`);
    console.log(`updated ${file}`);
}

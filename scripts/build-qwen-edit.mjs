// Builds workflows/qwenedit-ref{1,2,3}.json: Qwen-Image-Edit 2511 drawing a still FROM up to three reference
// pictures (cast and prop sheets, a place) in the card's own shape. Mirrors ComfyUI's image_qwen_image_edit_2511
// template (int8 diffusion model, 4-step Lightning LoRA, AuraFlow shift 3.1, CFGNorm), except the latent is an
// empty one at the card's size instead of the first picture re-encoded, so the output is the shot, not the sheet.
// One graph per picture count: a ComfyUI graph has a fixed number of LoadImage nodes.
//   node scripts/build-qwen-edit.mjs
import { writeFileSync } from 'node:fs';

for (const refs of [1, 2, 3]) {
    const graph = {
        1: { class_type: 'UNETLoader', _meta: { title: '@model' }, inputs: { unet_name: 'qwen_image_edit_2511_int8_convrot.safetensors', weight_dtype: 'default' } },
        2: { class_type: 'LoraLoaderModelOnly', _meta: { title: '@lightning' }, inputs: { model: ['1', 0], lora_name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors', strength_model: 1 } },
        3: { class_type: 'ModelSamplingAuraFlow', _meta: { title: '@shift' }, inputs: { model: ['2', 0], shift: 3.1 } },
        4: { class_type: 'CFGNorm', _meta: { title: '@cfgnorm' }, inputs: { model: ['3', 0], strength: 1 } },
        5: { class_type: 'CLIPLoader', _meta: { title: '@clip' }, inputs: { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image', device: 'default' } },
        6: { class_type: 'VAELoader', _meta: { title: '@vae' }, inputs: { vae_name: 'qwen_image_vae.safetensors' } },
        9: { class_type: 'EmptySD3LatentImage', _meta: { title: '@latent' }, inputs: { width: 1024, height: 576, batch_size: 1 } },
        10: { class_type: 'KSampler', _meta: { title: '@sampler' }, inputs: { model: ['4', 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['9', 0], seed: 0, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
        11: { class_type: 'VAEDecode', _meta: { title: '@decode' }, inputs: { samples: ['10', 0], vae: ['6', 0] } },
        12: { class_type: 'SaveImage', _meta: { title: '@output' }, inputs: { images: ['11', 0], filename_prefix: 'bloop-studio/image' } },
    };
    const pictures = {};
    for (let i = 1; i <= refs; i++) {
        graph[20 + i] = { class_type: 'LoadImage', _meta: { title: `@picture${i}` }, inputs: { image: 'example.png' } };
        // Each reference at about one megapixel, as the template scales them (FluxKontextImageScale).
        graph[30 + i] = { class_type: 'FluxKontextImageScale', _meta: { title: `@scale${i}` }, inputs: { image: [String(20 + i), 0] } };
        pictures[`image${i}`] = [String(30 + i), 0];
    }
    graph[7] = { class_type: 'TextEncodeQwenImageEditPlus', _meta: { title: '@positive' }, inputs: { clip: ['5', 0], prompt: '', vae: ['6', 0], ...pictures } };
    graph[8] = { class_type: 'TextEncodeQwenImageEditPlus', _meta: { title: '@negative' }, inputs: { clip: ['5', 0], prompt: '', vae: ['6', 0], ...pictures } };
    const bindings = {
        prompt: ['@positive', 'prompt'],
        seed: ['@sampler', 'seed'],
        width: ['@latent', 'width'],
        height: ['@latent', 'height'],
    };
    for (let i = 1; i <= refs; i++) bindings[`reference${i}`] = [`@picture${i}`, 'image'];
    const preset = {
        id: `qwenedit-ref${refs}`,
        variant: 'int8-lightning',
        minVramGb: 11,
        label: 'Qwen-Image-Edit 2511 (a still drawn from your reference pictures)',
        card: 'image',
        needs: ['reference'],
        references: refs,
        output: 'image',
        knobs: 'qwenedit',
        defaults: { width: 1024, height: 576 },
        bindings,
        graph,
    };
    writeFileSync(new URL(`../workflows/qwenedit-ref${refs}.json`, import.meta.url), `${JSON.stringify(preset, null, 2)}\n`);
    console.log(`qwenedit-ref${refs}.json`);
}

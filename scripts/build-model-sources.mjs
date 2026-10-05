// Builds src/shared/model-sources.js: every model file the engine installer can fetch, with its
// official download URL, size, SHA-256 and license, read from the publisher (Hugging Face reports
// size and SHA-256 of LFS files in X-Linked-Size / X-Linked-ETag; the license from the model card).
// We never host model files: the person downloads from the publisher, under its license.
//
//   node scripts/build-model-sources.mjs        (run again when a workflow needs a new file)
import { writeFileSync } from 'node:fs';

const HF = 'https://huggingface.co';
const zi = `${HF}/Comfy-Org/z_image_turbo/resolve/main/split_files`;
const mm = `${HF}/Comfy-Org/MiniMax-H3/resolve/main`;
const wan = `${HF}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files`;
const ace = `${HF}/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files`;
const mu = `${HF}/Comfy-Org/MiniMax-Music-3/resolve/main`;

// Family → variant (the workflow variant id it unlocks) → files [ComfyUI models folder, url].
const FAMILIES = [
    {
        id: 'zimage', label: 'Z-Image Turbo', what: 'Pictures from words or a picture', kind: 'image',
        variants: {
            int8: [['diffusion_models', `${zi}/diffusion_models/z_image_turbo_int8_convrot.safetensors`],
                ['text_encoders', `${zi}/text_encoders/qwen_3_4b_fp8_mixed.safetensors`], ['vae', `${zi}/vae/ae.safetensors`]],
            bf16: [['diffusion_models', `${zi}/diffusion_models/z_image_turbo_bf16.safetensors`],
                ['text_encoders', `${zi}/text_encoders/qwen_3_4b.safetensors`], ['vae', `${zi}/vae/ae.safetensors`]],
        },
    },
    {
        id: 'ltx', label: 'LTX-2.3 Distilled', what: 'Video with sound, fast', kind: 'video',
        variants: {
            'distilled-fp8': [['checkpoints', `${HF}/Lightricks/LTX-2.3-fp8/resolve/main/ltx-2.3-22b-distilled-fp8.safetensors`],
                ['text_encoders', `${HF}/Comfy-Org/ltx-2/resolve/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors`]],
        },
    },
    {
        id: 'h3', label: 'MiniMax-H3 Turbo', what: 'Video with sound, best quality', kind: 'video',
        variants: {
            int8: [['diffusion_models', `${mm}/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors`],
                ['text_encoders', `${mm}/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`],
                ['vae', `${mm}/vae/minimax_h3_video_vae_int8_convrot.safetensors`],
                ['vae', `${mm}/vae/minimax_h3_audio_vae_fp32.safetensors`],
                ['loras', `${mm}/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors`]],
        },
    },
    {
        id: 'wan5b', label: 'Wan 2.2 5B', what: 'Silent draft video, light', kind: 'video',
        variants: {
            fp16: [['diffusion_models', `${wan}/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors`],
                ['text_encoders', `${wan}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`], ['vae', `${wan}/vae/wan2.2_vae.safetensors`]],
        },
    },
    {
        id: 'acestep', label: 'ACE-Step 1.5 Turbo', what: 'Music and songs from words and lyrics, fast', kind: 'audio',
        variants: {
            turbo: [['diffusion_models', `${ace}/diffusion_models/acestep_v1.5_turbo.safetensors`],
                ['text_encoders', `${ace}/text_encoders/qwen_0.6b_ace15.safetensors`],
                ['text_encoders', `${ace}/text_encoders/qwen_1.7b_ace15.safetensors`], ['vae', `${ace}/vae/ace_1.5_vae.safetensors`]],
        },
    },
    {
        id: 'music3', label: 'MiniMax Music 3', what: 'Music and songs from words and lyrics, best quality', kind: 'audio',
        variants: {
            int8: [['diffusion_models', `${mu}/diffusion_models/minimax_music3_dit_int8_convrot.safetensors`],
                ['text_encoders', `${mu}/text_encoders/minimax_music3_text_encoder_pruned_int8_convrot.safetensors`],
                ['vae', `${mu}/vae/minimax_music3_dav.safetensors`]],
        },
    },
];

const licenses = new Map();
async function licenseOf(url) {
    const repo = new URL(url).pathname.split('/').slice(1, 3).join('/');
    if (!licenses.has(repo)) {
        const card = await (await fetch(`${HF}/api/models/${repo}`)).json();
        const id = card.cardData?.license ?? 'unknown';
        licenses.set(repo, {
            name: id === 'other' ? card.cardData?.license_name ?? 'other' : id,
            link: card.cardData?.license_link ?? `${HF}/${repo}`,
        });
    }
    return licenses.get(repo);
}

async function fileOf([folder, url]) {
    const head = await fetch(url, { method: 'HEAD', redirect: 'manual' });
    const size = Number(head.headers.get('x-linked-size'));
    const sha256 = head.headers.get('x-linked-etag')?.replaceAll('"', '');
    if (!size || !/^[0-9a-f]{64}$/.test(sha256 ?? '')) throw new Error(`no size/sha256 for ${url}`);
    return { folder, name: url.split('/').at(-1), url, size, sha256, license: await licenseOf(url) };
}

const families = [];
for (const family of FAMILIES) {
    const variants = {};
    for (const [variant, files] of Object.entries(family.variants)) variants[variant] = await Promise.all(files.map(fileOf));
    families.push({ ...family, variants });
    console.log(family.id, Object.keys(variants).join(', '));
}

writeFileSync(new URL('../src/shared/model-sources.js', import.meta.url), `// GENERATED by scripts/build-model-sources.mjs — do not edit by hand.
// Every model file the engine installer can fetch: official URL, size (bytes), SHA-256, license.
export const MODEL_FAMILIES = ${JSON.stringify(families, null, 4)};
`);

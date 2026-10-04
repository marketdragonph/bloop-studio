// What to install on this PC: a plain verdict, the model families it can run (with the variant
// that fits its card), which ones are suggested, the ComfyUI build, the folder and the space it
// takes. Pure: hardware in, plan out, so every tier is testable without the hardware.
import { join } from 'node:path';
import { MODEL_FAMILIES } from '../../shared/model-sources.js';

// The ComfyUI build we test against (the engine check and every workflow are tried on it).
export const COMFY_RELEASE = {
    version: '0.38.0',
    nvidia: { url: 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.38.0/ComfyUI_windows_portable_nvidia.7z', size: 1994326521, sha256: '8f137eac345707fd7e42bcf8e29377415243011ca15522a86aed6c77331fbd56' },
    amd: { url: 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.38.0/ComfyUI_windows_portable_amd.7z', size: 1612070856, sha256: 'f346e5c187b4e1647f0ea01d9978f53de1f259878656128c3296f61a5948fd1f' },
};

const UNPACKED_FACTOR = 2.6; // the portable .7z grows about this much once unpacked

/**
 * Longest install folder that works. ComfyUI's own Python packages sit up to 185 characters deep
 * inside the portable folder, and its Python cannot open a path past Windows' 260: a longer folder
 * unpacks fine and then fails to start (seen: transformers' configuration files "not found").
 */
export const MAX_FOLDER_CHARS = 70;
const GB = 1e9;

/**
 * Per vendor and memory: which variant of each family runs, and whether it is suggested.
 * `null` = not offered on this card. Tested: RTX 3080 Ti 12 GB (int8 set), RX 7900 XTX 24 GB.
 * Video with sound uses int8/fp8 kernels that are NVIDIA-only today, so AMD gets pictures and
 * the silent draft video (beta).
 */
function tierFor(gpu) {
    const vram = gpu?.vramGb ?? 0;
    if (gpu?.vendor === 'nvidia' && vram >= 20) {
        return { verdict: 'Ready for pictures and video with sound.', picks: { zimage: ['bf16', true], ltx: ['distilled-fp8', true], h3: ['int8', false], wan5b: ['fp16', false] } };
    }
    if (gpu?.vendor === 'nvidia' && vram >= 11) {
        return { verdict: 'Ready for pictures and video with sound.', picks: { zimage: ['int8', true], ltx: ['distilled-fp8', true], h3: ['int8', false], wan5b: ['fp16', false] } };
    }
    if (gpu?.vendor === 'nvidia' && vram >= 8) {
        return { verdict: 'Pictures and light silent video. Video with sound needs 12 GB: use bloop cloud for it.', picks: { zimage: ['int8', true], wan5b: ['fp16', false] } };
    }
    if (gpu?.vendor === 'amd' && vram >= 16) {
        return { verdict: 'Pictures and silent draft video (AMD support is in beta). Use bloop cloud for video with sound.', picks: { zimage: ['bf16', true], wan5b: ['fp16', false] }, beta: true };
    }
    return { verdict: 'This graphics card is too small for local renders. Use bloop cloud instead.', picks: {}, tooSmall: true };
}

/** The install folder: on C: when it has room, otherwise the drive with the most free space. */
export function folderFor(drives, neededGb, env = process.env) {
    const c = drives.find((d) => d.letter === 'C');
    if (c && c.freeGb >= neededGb + 20) return join(env.LOCALAPPDATA ?? 'C:\\Bloop Studio', 'Bloop Studio', 'engine');
    const roomiest = drives[0];
    return roomiest ? `${roomiest.letter}:\\Bloop Studio\\engine` : null;
}

export function planFor({ gpu, drives = [], env } = {}) {
    const tier = tierFor(gpu);
    const families = MODEL_FAMILIES.filter((f) => tier.picks[f.id]).map((family) => {
        const [variant, suggested] = tier.picks[family.id];
        const files = family.variants[variant];
        return {
            id: family.id, label: family.label, what: family.what, kind: family.kind, variant, suggested,
            files, sizeGb: files.reduce((sum, f) => sum + f.size, 0) / GB,
            licenses: [...new Map(files.map((f) => [f.license.name, f.license])).values()],
        };
    });
    const comfy = COMFY_RELEASE[gpu?.vendor === 'amd' ? 'amd' : 'nvidia'];
    const comfyGb = (comfy.size * UNPACKED_FACTOR) / GB;
    const suggestedGb = comfyGb + families.filter((f) => f.suggested).reduce((sum, f) => sum + f.sizeGb, 0);
    return {
        gpu, drives, verdict: tier.verdict, beta: Boolean(tier.beta), tooSmall: Boolean(tier.tooSmall),
        comfy: { ...comfy, version: COMFY_RELEASE.version, unpackedGb: comfyGb },
        families, suggestedGb, folder: folderFor(drives, suggestedGb, env),
    };
}

/** The files to fetch for the families picked, each once (Z-Image's VAE is shared, for one). */
export function filesFor(plan, picked) {
    const files = new Map();
    for (const family of plan.families.filter((f) => picked.includes(f.id))) {
        for (const file of family.files) files.set(`${file.folder}/${file.name}`, file);
    }
    return [...files.values()];
}

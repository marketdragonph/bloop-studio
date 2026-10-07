// Which model family a LoRA file is for, from its tensor names and widths (the safetensors header), never from its
// metadata: trainers copy `ss_base_model_version` from templates (a Qwen-Image-Edit LoRA that says "sd_1.5").
// A LoRA on the wrong family loads without error and changes nothing, so a card only offers the ones that fit.
import { open } from 'node:fs/promises';

const MAX_HEADER_BYTES = 64 * 1024 * 1024; // a LoRA header is a few hundred KB; anything bigger is not one

/** Separator-agnostic: PEFT/diffusers keys use dots, kohya keys use underscores (lora_unet_layers_0_attention…). */
const sep = '[._]';
const re = (source) => new RegExp(source.replaceAll('·', sep));

/**
 * One fingerprint per family we run, most specific first. `width`: the model's hidden size, read from the first
 * low-rank "down" matrix of a matching key, where two sizes of one architecture exist (Wan 2.2 5B against 14B).
 */
const FINGERPRINTS = [
    { family: 'qwenedit', key: re('transformer·blocks·\\d+·(img·mlp|txt·mlp|img·mod|txt·mod)') },
    { family: 'h3', key: re('blocks·\\d+·attn·qkv·proj') },
    { family: 'zimage', key: re('(^|·)layers·\\d+·(attention|adaLN·modulation)') },
    { family: 'wan5b', key: re('blocks·\\d+·(self·attn|cross·attn)·[qkvo]'), width: 3072 },
    { family: 'ltx', key: re('transformer·blocks·\\d+·attn1·to·[qkv]'), width: 4096 },
];

/** The input width of a LoRA's down matrix (lora_A / lora_down: [rank, in]); null for LoKr and the like. */
function widthOf(header, key) {
    const prefix = key.replace(/\.(lora_A|lora_B|lora_down|lora_up|alpha)(\.weight)?$/, '');
    const down = header[`${prefix}.lora_A.weight`] ?? header[`${prefix}.lora_down.weight`];
    return Array.isArray(down?.shape) && down.shape.length === 2 ? down.shape[1] : null;
}

/** The family a parsed safetensors header belongs to, or null when it is for a model we do not run. */
export function familyOfLora(header) {
    const keys = Object.keys(header ?? {}).filter((k) => k !== '__metadata__');
    for (const { family, key, width } of FINGERPRINTS) {
        const matching = keys.filter((k) => key.test(k));
        if (!matching.length) continue;
        if (!width) return family;
        const seen = matching.map((k) => widthOf(header, k)).find((w) => w != null);
        if (seen == null || seen === width) return family;
    }
    return null;
}

/** The family a file name suggests, for a LoRA the app cannot read (a ComfyUI on another PC). */
export function familyFromName(name) {
    const n = String(name).toLowerCase();
    if (/z[-_ ]?image|(^|[^a-z])zit[-_]/.test(n)) return 'zimage';
    if (/qwen/.test(n)) return 'qwenedit';
    if (/ltx/.test(n)) return 'ltx';
    if (/wan.?2\.?2.*5b|ti2v/.test(n)) return 'wan5b';
    if (/(^|[^a-z])h3[-_]/.test(n)) return 'h3';
    return null;
}

/** Reads a safetensors file's JSON header: 8 bytes of little-endian length, then the JSON. */
export async function readSafetensorsHeader(path) {
    const file = await open(path, 'r');
    try {
        const size = Buffer.alloc(8);
        await file.read(size, 0, 8, 0);
        const length = Number(size.readBigUInt64LE());
        if (!length || length > MAX_HEADER_BYTES) throw new Error(`${path} is not a safetensors file.`);
        const json = Buffer.alloc(length);
        await file.read(json, 0, length, 8);
        return JSON.parse(json.toString('utf8'));
    } finally {
        await file.close();
    }
}

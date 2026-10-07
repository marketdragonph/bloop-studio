// The stages one generation job passes through. ctx carries { job, node, deps, ... }.
import { randomInt } from 'node:crypto';
import { basename } from 'node:path';
import { choosePreset, compileGraph, familyOf, knobsOf, withStyle } from './presets.js';
import { composePrompt, LyricsPrompt } from './prompt.js';
import { mimeFromName } from './media-store.js';
import { StageError } from './pipeline.js';
import { knobInputs, styleStrength } from '../../shared/formats.js';
import { isTextSocket } from '../../shared/node-types.js';
import { measureTake } from './measure-take.js';

const MAX_SEED = 2 ** 32 - 1;

export async function resolvePreset(ctx, next) {
    const { spaces, engine } = ctx.deps;
    ctx.upstream = spaces.upstreamOf(ctx.node.space_id, ctx.node.id);
    // A picture wired in but not rendered must not silently turn image-to-video into text-to-video.
    const unrendered = ctx.upstream.find((n) => !isTextSocket(n.to_socket) && !n.media_path);
    if (unrendered) {
        throw new StageError(`The ${unrendered.type} card wired into ${unrendered.to_socket.replace('_', ' ')} has no render yet. Generate it first.`);
    }
    const wired = ctx.upstream.filter((n) => !isTextSocket(n.to_socket)).map((n) => n.to_socket);
    const { presets } = await engine.current();
    ctx.preset = choosePreset(presets, { type: ctx.node.type, settings: ctx.node.settings, wired });
    if (!ctx.preset && ctx.node.type === 'audio') {
        throw new StageError('No music model on this PC. Install ACE-Step or MiniMax Music in Settings → Engine, or sign in to bloop for voices.');
    }
    if (!ctx.preset) throw new StageError('No workflow on this PC fits this card and its wires. Settings → Engine lists what is missing.');
    // A wired picture the workflow cannot take (a last frame on Wan, or without a first frame) must not be dropped silently.
    const ignored = wired.find((socket) => !(ctx.preset.needs ?? []).includes(socket));
    if (ignored === 'audio') {
        throw new StageError('Lip sync to a voice needs LTX-2.3 and a picture in First frame. Settings → Engine shows if LTX is installed.');
    }
    if (ignored) {
        throw new StageError(`${ctx.preset.label.replace(/\s*\(.*\)$/, '')} cannot use the ${ignored.replace('_', ' ')} picture${ignored === 'last_frame' ? ' (it needs a first frame too)' : ''}. Remove that wire or pick another model.`);
    }
    await next();
}

export async function buildPrompt(ctx, next) {
    ctx.prompt = composePrompt({ upstream: ctx.upstream, dialect: ctx.preset.dialect });
    ctx.lyrics = new LyricsPrompt(ctx.upstream).create(); // none: the preset's instrumental default
    if (!ctx.prompt && !(ctx.preset.needs ?? []).length) {
        throw new StageError('Wire a Text card with your idea into the Words socket of this card.');
    }
    await next();
}

/** Copies each wired picture (first frame, reference) into ComfyUI's input folder. */
export async function uploadInputs(ctx, next) {
    const { comfy, media } = ctx.deps;
    ctx.uploads = {};
    // An edit preset takes several reference pictures, in wire order: reference1, reference2, reference3.
    if (ctx.preset.references) {
        const pictures = ctx.upstream.filter((n) => n.to_socket === 'reference' && n.media_path).slice(0, ctx.preset.references);
        for (const [i, source] of pictures.entries()) {
            const bytes = await media.read(source.media_path);
            ctx.uploads[`reference${i + 1}`] = await comfy.uploadImage(bytes, `bloop-${ctx.node.id}-reference${i + 1}-${basename(source.media_path)}`, source.media_mime);
        }
        return next();
    }
    for (const need of ctx.preset.needs ?? []) {
        const source = ctx.upstream.find((n) => n.to_socket === need && n.media_path);
        if (!source) throw new StageError(`Connect ${need === 'audio' ? 'a voice or song' : 'a picture'} to the ${need.replace('_', ' ')} socket.`);
        const bytes = await media.read(source.media_path);
        ctx.uploads[need] = await comfy.uploadImage(bytes, `bloop-${ctx.node.id}-${need}-${basename(source.media_path)}`, source.media_mime);
    }
    await next();
}

/**
 * Models from another family left in VRAM made Z-Image run ~14x slower after an H3 render
 * (Windows spilled into shared memory). Switching family frees ComfyUI's memory first.
 */
export async function freeOnFamilySwitch(ctx, next) {
    const family = familyOf(ctx.preset.id);
    const { worker } = ctx;
    // null (first render since launch) also frees: we cannot know what ComfyUI kept loaded.
    if (worker && worker.lastFamily !== family) {
        ctx.report({ status: 'generating', progress: 0, label: 'freeing GPU memory' });
        await ctx.deps.comfy.free();
    }
    if (worker) worker.lastFamily = family;
    await next();
}

export async function compile(ctx, next) {
    const settings = ctx.node.settings ?? {};
    ctx.seed = Number.isInteger(settings.seed) && settings.seedLocked ? settings.seed : randomInt(0, MAX_SEED);
    ctx.params = {
        ...knobInputs(knobsOf(ctx.preset), settings), // aspect, resolution, duration, quality → pixels, frames, steps
        ...pick(settings, ['strength']),
        ...ctx.uploads,
        ...(ctx.lyrics ? { lyrics: ctx.lyrics } : {}),
        prompt: ctx.prompt,
        seed: ctx.seed,
    };
    ctx.graph = compileGraph(ctx.preset, ctx.params);
    const style = await styleOf(ctx);
    if (style) {
        withStyle(ctx.graph, style);
        Object.assign(ctx.params, { style: style.name, styleStrength: style.strength });
    }
    await next();
}

/**
 * The card's Style LoRA when it fits the model this render runs on, else null: a card whose wires moved it to
 * another model (two reference pictures → Qwen-Image-Edit) renders without it rather than with a LoRA that does nothing.
 * One the person picked that is no longer in ComfyUI's loras folder is said plainly.
 */
async function styleOf(ctx) {
    const { style, styleStrength: strength } = ctx.node.settings ?? {};
    if (!style || style === 'none' || ctx.preset.card === 'audio' || !ctx.deps.loras) return null;
    const { loras = [] } = await ctx.deps.engine.current();
    if (!loras.includes(style)) throw new StageError(`The style "${style}" is not in ComfyUI's loras folder any more. Pick another style or None.`);
    const [entry] = await ctx.deps.loras.classify([style]);
    return entry?.family === familyOf(ctx.preset.id) ? { name: style, strength: styleStrength(strength) } : null;
}

/**
 * What ComfyUI is doing outside the sampler's steps, from the class of the node it is running.
 * The steps reach 100% long before a clip is done: a tiled video decode can take minutes.
 */
export function phaseOf(classType = '', cardType = 'image') {
    if (/VAEDecode/i.test(classType)) return cardType === 'video' ? 'Decoding video' : 'Decoding';
    if (/Save|CreateVideo|VideoCombine/i.test(classType)) return 'Saving';
    if (/TextEncode|CLIPLoader|Qwen.*VL/i.test(classType)) return 'Reading the prompt';
    if (/Loader|LoadImage/i.test(classType)) return 'Loading models';
    return null;
}

/** Submits to ComfyUI and resolves when it finishes, reporting step progress as it goes. */
export async function render(ctx, next) {
    const { comfy, jobs } = ctx.deps;
    const clientId = `bloop-job-${ctx.job.id}-${Date.now()}`;
    let promptId = null;
    let lastWrite = 0;

    const finished = new Promise((resolve, reject) => {
        ctx.socket = comfy.listen(clientId, (msg) => {
            const data = msg.data ?? {};
            if (promptId && data.prompt_id && data.prompt_id !== promptId) return;
            if (msg.type === 'progress' && data.max) {
                const progress = data.value / data.max;
                ctx.report({ status: 'generating', progress, label: `step ${data.value}/${data.max}`, phase: null });
                if (Date.now() - lastWrite > 1000) {
                    lastWrite = Date.now();
                    jobs.progress(ctx.job.id, progress, `step ${data.value}/${data.max}`);
                }
            } else if (msg.type === 'executing' && data.node != null) {
                const phase = phaseOf(ctx.graph[data.node]?.class_type, ctx.node.type);
                if (phase) ctx.report({ status: 'generating', phase });
            } else if (msg.type === 'executing' && data.node === null && data.prompt_id === promptId) {
                resolve();
            } else if (msg.type === 'execution_success' && data.prompt_id === promptId) {
                resolve();
            } else if (msg.type === 'execution_error' && data.prompt_id === promptId) {
                reject(new StageError(`${data.node_type ?? 'Workflow'} failed: ${data.exception_message ?? 'unknown error'}`.trim()));
            } else if (msg.type === 'execution_interrupted' && data.prompt_id === promptId) {
                reject(new StageError('Canceled.'));
            }
        });
    });

    try {
        await ctx.socket.opened;
        promptId = await comfy.submit(ctx.graph, clientId);
        jobs.setPromptId(ctx.job.id, promptId);
        ctx.promptId = promptId;
        ctx.report({ status: 'generating', progress: 0, label: 'loading models' });
        await Promise.race([finished, pollUntilDone(comfy, promptId, ctx)]);
    } finally {
        ctx.socket.close();
    }
    await next();
}

/** Backstop for a dropped socket: ComfyUI's history is the source of truth. */
export async function pollUntilDone(comfy, promptId, ctx, every = 10_000) {
    let missing = 0;
    for (;;) {
        await new Promise((r) => setTimeout(r, every));
        if (ctx.done) return;
        const entry = await comfy.history(promptId).catch(() => null);
        if (entry?.status?.completed) return;
        if (entry?.status?.status_str === 'error') throw new StageError('The workflow failed in ComfyUI.');
        // In neither the history nor the queue: ComfyUI was restarted (or stopped) and this render is gone. Twice in
        // a row, so a render moving from the queue to the history is never mistaken for a lost one; a ComfyUI that
        // does not answer at all is not counted (it may be busy loading a model).
        if (entry) continue;
        const queued = await comfy.queueHas(promptId).catch(() => null);
        missing = queued === false ? missing + 1 : 0;
        if (missing >= 2) throw new StageError('ComfyUI lost this render — it was probably restarted while it waited. Generate it again.');
    }
}

export async function collectOutput(ctx, next) {
    const { comfy, media, spaces, jobs } = ctx.deps;
    const entry = await comfy.history(ctx.promptId);
    const files = Object.values(entry?.outputs ?? {}).flatMap((out) => [...(out.images ?? []), ...(out.videos ?? []), ...(out.gifs ?? []), ...(out.audio ?? [])]);
    const file = files.find((f) => f.type === 'output') ?? files[0];
    if (!file) throw new StageError('ComfyUI finished but returned no file.');

    const bytes = await comfy.download(file);
    const mime = mimeFromName(file.filename);
    const mediaPath = await media.saveTake({ spaceId: ctx.node.space_id, nodeId: ctx.node.id, bytes, mime, seed: ctx.seed });
    // The variant says which machine's model set made this take (bf16 on the 24 GB card, int8 on 12 GB…).
    const params = { ...ctx.params, prompt: ctx.prompt, variant: ctx.preset.variant };
    jobs.addTake({ nodeId: ctx.node.id, mediaPath, mime, preset: ctx.preset.id, seed: ctx.seed, params });
    spaces.setNodeResult(ctx.node.id, { status: 'done', media_path: mediaPath, media_mime: mime });
    spaces.updateNode(ctx.node.space_id, ctx.node.id, { settings: { seed: ctx.seed } });
    ctx.result = { media_path: mediaPath, media_mime: mime };
    await next();
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined && obj[k] !== '').map((k) => [k, obj[k]]));

export const GENERATION_STAGES = [resolvePreset, buildPrompt, uploadInputs, freeOnFamilySwitch, compile, render, collectOutput, measureTake];

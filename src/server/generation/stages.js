// The stages one generation job passes through. ctx carries { job, node, deps, ... }.
import { randomInt } from 'node:crypto';
import { basename } from 'node:path';
import { choosePreset, compileGraph } from './presets.js';
import { composePrompt } from './prompt.js';
import { mimeFromName } from './media-store.js';
import { StageError } from './pipeline.js';
import { knobInputs } from '../../shared/formats.js';

const MAX_SEED = 2 ** 32 - 1;

export async function resolvePreset(ctx, next) {
    const { spaces, presets } = ctx.deps;
    ctx.upstream = spaces.upstreamOf(ctx.node.space_id, ctx.node.id);
    // A picture wired in but not rendered must not silently turn image-to-video into text-to-video.
    const unrendered = ctx.upstream.find((n) => n.to_socket !== 'prompt' && !n.media_path);
    if (unrendered) {
        throw new StageError(`The ${unrendered.type} card wired into ${unrendered.to_socket.replace('_', ' ')} has no render yet. Generate it first.`);
    }
    const wired = ctx.upstream.filter((n) => n.to_socket !== 'prompt').map((n) => n.to_socket);
    ctx.preset = choosePreset(presets, { type: ctx.node.type, settings: ctx.node.settings, wired });
    if (!ctx.preset) throw new StageError('No workflow fits this card and its wires.');
    await next();
}

export async function buildPrompt(ctx, next) {
    ctx.prompt = composePrompt({ upstream: ctx.upstream, dialect: ctx.preset.dialect });
    if (!ctx.prompt && !(ctx.preset.needs ?? []).length) {
        throw new StageError('Wire a Text card with your idea into the Words socket of this card.');
    }
    await next();
}

/** Copies each wired picture (first frame, reference) into ComfyUI's input folder. */
export async function uploadInputs(ctx, next) {
    const { comfy, media } = ctx.deps;
    ctx.uploads = {};
    for (const need of ctx.preset.needs ?? []) {
        const source = ctx.upstream.find((n) => n.to_socket === need && n.media_path);
        if (!source) throw new StageError(`Connect a picture to the ${need.replace('_', ' ')} socket.`);
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
    const family = ctx.preset.id.split('-')[0];
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
        ...knobInputs(ctx.preset.id.split('-')[0], settings), // aspect, resolution, duration, quality → pixels, frames, steps
        ...pick(settings, ['strength']),
        ...ctx.uploads,
        prompt: ctx.prompt,
        seed: ctx.seed,
    };
    ctx.graph = compileGraph(ctx.preset, ctx.params);
    await next();
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
async function pollUntilDone(comfy, promptId, ctx) {
    for (;;) {
        await new Promise((r) => setTimeout(r, 10_000));
        if (ctx.done) return;
        const entry = await comfy.history(promptId).catch(() => null);
        if (entry?.status?.completed) return;
        if (entry?.status?.status_str === 'error') throw new StageError('The workflow failed in ComfyUI.');
    }
}

export async function collectOutput(ctx, next) {
    const { comfy, media, spaces, jobs } = ctx.deps;
    const entry = await comfy.history(ctx.promptId);
    const files = Object.values(entry?.outputs ?? {}).flatMap((out) => [...(out.images ?? []), ...(out.videos ?? []), ...(out.gifs ?? [])]);
    const file = files.find((f) => f.type === 'output') ?? files[0];
    if (!file) throw new StageError('ComfyUI finished but returned no file.');

    const bytes = await comfy.download(file);
    const mime = mimeFromName(file.filename);
    const mediaPath = await media.saveTake({ spaceId: ctx.node.space_id, nodeId: ctx.node.id, bytes, mime, seed: ctx.seed });
    jobs.addTake({ nodeId: ctx.node.id, mediaPath, mime, preset: ctx.preset.id, seed: ctx.seed, params: { ...ctx.params, prompt: ctx.prompt } });
    spaces.setNodeResult(ctx.node.id, { status: 'done', media_path: mediaPath, media_mime: mime });
    spaces.updateNode(ctx.node.space_id, ctx.node.id, { settings: { seed: ctx.seed } });
    ctx.result = { media_path: mediaPath, media_mime: mime };
    await next();
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined && obj[k] !== '').map((k) => [k, obj[k]]));

export const GENERATION_STAGES = [resolvePreset, buildPrompt, uploadInputs, freeOnFamilySwitch, compile, render, collectOutput];

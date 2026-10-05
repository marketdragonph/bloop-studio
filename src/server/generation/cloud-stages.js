// The stages a card on a bloop cloud model passes through, instead of ComfyUI: the wired pictures
// and words go to bloop, which renders on its own models with the person's credits; the finished
// file comes back into the media folder as an ordinary take.
import { randomInt } from 'node:crypto';
import { basename } from 'node:path';
import { composePrompt } from './prompt.js';
import { mimeFromName } from './media-store.js';
import { StageError } from './pipeline.js';
import { cloudModelKey, cloudParams } from './cloud-models.js';
import { measureTake } from './measure-take.js';

const POLL_MS = 4000;
const GIVE_UP_MS = 30 * 60_000; // bloop gives up on a render well before this
const RENDER_ID = 'bloop:';

// Card socket → the picture slot bloop's API takes.
const SLOTS = { reference: 'picture', first_frame: 'first_frame', last_frame: 'last_frame' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function resolveCloudModel(ctx, next) {
    const { spaces, account } = ctx.deps;
    const key = cloudModelKey(ctx.node.settings.family);
    ctx.model = (await account.models())?.[ctx.node.type]?.find((m) => m.key === key);
    if (!ctx.model) throw new StageError('That bloop model is not available. Check Settings → Bloop account.');

    ctx.upstream = spaces.upstreamOf(ctx.node.space_id, ctx.node.id);
    // Lyrics are sung by the music models on this PC; bloop's audio models take only their words.
    if (ctx.upstream.some((n) => n.to_socket === 'lyrics')) {
        throw new StageError('Lyrics are sung by the music models on this PC: pick ACE-Step or MiniMax Music in Model, or remove the Lyrics wire.');
    }
    const unrendered = ctx.upstream.find((n) => n.to_socket !== 'prompt' && !n.media_path);
    if (unrendered) throw new StageError(`The ${unrendered.type} card wired into ${unrendered.to_socket.replace('_', ' ')} has no render yet. Generate it first.`);

    const wired = new Set(ctx.upstream.filter((n) => n.to_socket !== 'prompt').map((n) => n.to_socket));
    if (wired.has('last_frame') && !wired.has('first_frame')) throw new StageError('A last frame needs a first frame too.');
    if (wired.has('last_frame') && !ctx.model.has_end_frame) throw new StageError(`${ctx.model.name} cannot use a last frame. Remove that wire or pick another model.`);
    if (!wired.size && ctx.model.requires_image && !ctx.model.image_variant) throw new StageError(`${ctx.model.name} needs a picture. Wire one in, then press Generate.`);
    // Lip sync to a wired voice runs on this PC (LTX); bloop's video models are not sent audio.
    if (wired.has('audio')) throw new StageError('Lip sync to a voice runs on the offline engine: pick LTX-2.3 in Model, or remove the audio wire.');
    await next();
}

export async function buildCloudPrompt(ctx, next) {
    ctx.prompt = composePrompt({ upstream: ctx.upstream });
    if (!ctx.prompt) throw new StageError('Wire a Text card with your idea into the Words socket of this card.');
    await next();
}

/** Sends the render, or picks up the one a restart interrupted (it is already paid for). */
export async function submitCloud(ctx, next) {
    const { account, media, jobs } = ctx.deps;
    const resumed = ctx.job.comfy_prompt_id?.startsWith(RENDER_ID) ? ctx.job.comfy_prompt_id.slice(RENDER_ID.length) : null;
    if (resumed) {
        ctx.renderId = resumed;
        return next();
    }

    const pictures = {};
    for (const source of ctx.upstream.filter((n) => SLOTS[n.to_socket])) {
        // bloop's render route takes one picture per slot today: the first wired one is sent.
        if (pictures[SLOTS[source.to_socket]]) continue;
        pictures[SLOTS[source.to_socket]] = {
            bytes: await media.read(source.media_path),
            mime: source.media_mime ?? mimeFromName(source.media_path),
            name: basename(source.media_path),
        };
    }

    ctx.report({ status: 'generating', progress: 0, label: 'sending to bloop', phase: 'Sending to bloop' });
    const params = cloudParams(ctx.model, ctx.node.settings);
    let answer;
    try {
        answer = await account.client().render({ kind: ctx.node.type, model: ctx.model.key, prompt: ctx.prompt, label: ctx.node.label, params, pictures });
    } catch (error) {
        throw new StageError(error.message);
    }
    if (answer.status === 'failed') throw new StageError(answer.error ?? 'bloop could not start this render.');
    ctx.renderId = String(answer.id);
    ctx.params = params;
    jobs.setPromptId(ctx.job.id, `${RENDER_ID}${ctx.renderId}`);
    await next();
}

/** Polls bloop until the card there is done. Canceling stops waiting; bloop keeps the render. */
export async function awaitCloud(ctx, next) {
    const client = ctx.deps.account.client();
    const started = Date.now();
    for (;;) {
        if (ctx.canceled) throw new StageError('Canceled.');
        const elapsed = Math.round((Date.now() - started) / 1000);
        ctx.report({ status: 'generating', progress: 0, label: `rendering on bloop · ${elapsed}s`, phase: 'Rendering on bloop' });

        const status = await client.status(ctx.renderId).catch((error) => (error.status === 404 ? { status: 'failed', error: 'bloop no longer has this render.' } : null));
        if (status?.status === 'success') {
            ctx.resultUrl = status.video_url ?? status.image_url ?? status.audio_url;
            if (!ctx.resultUrl) throw new StageError('bloop finished but sent no file.');
            break;
        }
        if (status?.status === 'failed') {
            const refund = status.credits_returned ? ' Your credits were returned.' : '';
            throw new StageError(`${status.error ?? 'The render failed on bloop.'}${refund}`);
        }
        if (Date.now() - started > GIVE_UP_MS) throw new StageError('bloop took too long. Check the Bloop Studio board on bloop for this render.');
        await sleep(ctx.pollMs ?? POLL_MS);
    }
    await next();
}

export async function collectCloud(ctx, next) {
    const { account, media, spaces, jobs } = ctx.deps;
    ctx.report({ status: 'generating', phase: 'Saving' });
    const { bytes, mime: served } = await account.client().download(ctx.resultUrl);
    const mime = served && served !== 'application/octet-stream' ? served : mimeFromName(new URL(ctx.resultUrl).pathname);
    // bloop chooses its own seed; the take still needs one for its file name.
    const seed = randomInt(0, 2 ** 32 - 1);
    const mediaPath = await media.saveTake({ spaceId: ctx.node.space_id, nodeId: ctx.node.id, bytes, mime, seed });
    const params = { ...ctx.params, prompt: ctx.prompt, model: ctx.model.key, bloopRender: ctx.renderId };
    jobs.addTake({ nodeId: ctx.node.id, mediaPath, mime, preset: ctx.node.settings.family, seed, params });
    spaces.setNodeResult(ctx.node.id, { status: 'done', media_path: mediaPath, media_mime: mime });
    ctx.result = { media_path: mediaPath, media_mime: mime };
    await next();
}

export const CLOUD_STAGES = [resolveCloudModel, buildCloudPrompt, submitCloud, awaitCloud, collectCloud, measureTake];

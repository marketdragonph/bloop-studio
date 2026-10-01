// The single GPU worker: claims queued jobs one at a time and runs them through the pipeline.
import { runPipeline } from './pipeline.js';
import { GENERATION_STAGES } from './stages.js';

const IDLE_POLL_MS = 1000;
const DEFAULT_FAMILY = { image: 'zimage', video: 'wan5b' };

/** The model family a queued job will load (the card's chosen family, else the type's default). */
function jobFamily(job) {
    try {
        return JSON.parse(job.node_settings ?? '{}').family ?? DEFAULT_FAMILY[job.node_type] ?? null;
    } catch {
        return DEFAULT_FAMILY[job.node_type] ?? null;
    }
}

export class GenerationWorker {
    constructor(deps) {
        this.deps = deps; // { jobs, spaces, presets, media, events, comfy() }
        this.current = null;
        this.stopped = false;
        this.lastFamily = null; // model family of the last render (zimage, wan5b, h3)
    }

    start() {
        const { changes, orphans } = this.deps.jobs.requeueInterrupted();
        if (changes) console.log(`worker: re-queued ${changes} job(s) interrupted by a restart`);
        // ComfyUI kept running what we sent before the restart: drop it, or the re-queued run waits behind a twin.
        for (const promptId of orphans) this.deps.comfy().cancel(promptId).catch(() => {});
        this.#loop();
    }

    stop() {
        this.stopped = true;
    }

    async #loop() {
        while (!this.stopped) {
            const job = this.deps.jobs.claimNext({ preferFamily: this.lastFamily, familyOf: jobFamily });
            if (!job) {
                await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
                continue;
            }
            await this.#run(job);
        }
    }

    async #run(job) {
        const { spaces, jobs, events } = this.deps;
        const spaceId = job.node_id ? spaces.spaceOfNode(job.node_id) : null;
        const node = spaceId ? spaces.findNode(spaceId, job.node_id) : null;
        if (!node) return jobs.finish(job.id, 'canceled', 'The card was deleted.');

        const report = (update) => events.node({ spaceId: node.space_id, nodeId: node.id, jobId: job.id, ...update });
        const ctx = { job, node, report, worker: this, deps: { ...this.deps, comfy: this.deps.comfy() } };
        this.current = ctx;
        spaces.setNodeResult(node.id, { status: 'generating' });
        report({ status: 'generating', progress: 0, label: 'starting' });
        events.queue(jobs.activeQueue());

        try {
            await runPipeline(GENERATION_STAGES, ctx);
            jobs.finish(job.id, 'succeeded');
            report({ status: 'done', progress: 1, ...ctx.result });
        } catch (error) {
            const canceled = error.message === 'Canceled.';
            jobs.finish(job.id, canceled ? 'canceled' : 'failed', error.message);
            spaces.setNodeResult(node.id, { status: canceled ? 'idle' : 'failed', error: canceled ? null : error.message });
            report({ status: canceled ? 'idle' : 'failed', error: canceled ? null : error.message });
            if (!canceled) console.error(`job ${job.id} failed:`, error.message);
        } finally {
            ctx.done = true;
            this.current = null;
            events.queue(jobs.activeQueue());
        }
    }

    /** Cancels a card's queued or running job. */
    async cancel(nodeId) {
        const { jobs, spaces } = this.deps;
        const job = jobs.activeForNode(nodeId);
        if (!job) return false;
        if (job.status === 'queued') {
            jobs.finish(job.id, 'canceled');
            spaces.setNodeResult(nodeId, { status: 'idle' });
            this.deps.events.node({ spaceId: spaces.spaceOfNode(nodeId), nodeId, status: 'idle' });
            this.deps.events.queue(jobs.activeQueue());
            return true;
        }
        if (this.current?.job.id === job.id && this.current.promptId) await this.current.deps.comfy.cancel(this.current.promptId);
        return true;
    }
}

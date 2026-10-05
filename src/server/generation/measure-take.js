// MeasureTake: after a video or audio take is saved, ffprobe measures its real length (takes.duration_ms).
// The stage only queues the probe and moves on, so the GPU worker never waits on it. Probes run one at a
// time through the capped runner (20 s timeout each). With no video tools on this PC the length stays
// NULL and the Cut says "not measured"; nothing fails.

/** Milliseconds from ffprobe's JSON: the container's duration, else the longest stream. */
export function durationMs(info) {
    const seconds = [info?.format?.duration, ...(info?.streams ?? []).map((s) => s.duration)]
        .map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const format = Number(info?.format?.duration);
    const best = Number.isFinite(format) && format > 0 ? format : Math.max(0, ...seconds);
    return best > 0 ? Math.round(best * 1000) : null;
}

export class TakeMeasurer {
    /**
     * @param {{ ffmpeg: { probe: (file: string) => Promise<object> }, cuts: import('../repositories/cuts.js').CutsRepository,
     *   media: { resolve: (path: string) => string|null }, events: import('./events.js').BoardEvents, log?: Pick<Console, 'warn'> }} deps
     */
    constructor({ ffmpeg, cuts, media, events, log = console }) {
        Object.assign(this, { ffmpeg, cuts, media, events, log });
        this.chain = Promise.resolve();
        this.toolsMissing = false;
    }

    /** Queues one take behind the others. Resolves with the measured ms or null; never rejects. */
    measure(take) {
        const run = this.chain.then(() => this.#measure(take)).catch(() => null);
        this.chain = run;
        return run;
    }

    /** Resolves once every probe queued so far has finished (the live cut places a clip after its length is known). */
    settled() {
        return this.chain.then(() => undefined, () => undefined);
    }

    async #measure({ spaceId, nodeId, mediaPath }) {
        const take = this.cuts.takeFor(nodeId, mediaPath);
        const full = take && this.media.resolve(mediaPath);
        if (!full) return null;
        try {
            const ms = durationMs(await this.ffmpeg.probe(full));
            if (!ms || !this.cuts.setTakeDuration(take.id, ms)) return null;
            this.events.cut({ spaceId, revision: this.cuts.revision(spaceId), by: 'measure', changed: [nodeId] });
            return ms;
        } catch (error) {
            if (error.code !== 'ENOENT') this.log.warn(`MeasureTake: take ${take.id} not measured: ${error.message}`);
            else if (!this.toolsMissing) this.log.warn('MeasureTake: the video tools (ffprobe) are missing; clip lengths stay not measured.');
            this.toolsMissing ||= error.code === 'ENOENT';
            return null;
        }
    }
}

/** Pipeline stage, after the take is saved: tell the board a clip landed, then measure it off the worker's path. */
export async function measureTake(ctx, next) {
    const { measurer, cuts, events } = ctx.deps;
    const mediaPath = ctx.result?.media_path;
    if (mediaPath && ['video', 'audio'].includes(ctx.node.type)) {
        const spaceId = ctx.node.space_id;
        if (cuts && events?.cut) events.cut({ spaceId, revision: cuts.revision(spaceId), by: 'take', added: [ctx.node.id] });
        measurer?.measure({ spaceId, nodeId: ctx.node.id, mediaPath }); // not awaited: the GPU worker moves on
    }
    await next();
}

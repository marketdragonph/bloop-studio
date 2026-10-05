// The media-tools queue (katana.md settled conflict 5): exports, packs and clip analysis run here, one at a
// time, in this process. It is separate from the GPU worker (generation/worker.js), so an export never waits
// on a render and never blocks one. Exports and packs jump ahead of analysis. The work itself is child
// processes (ffmpeg through CappedFfmpeg, at below-normal priority) or streamed file copies, so the event loop
// never blocks. Each job gets an AbortSignal: cancel aborts a running job's child or drops a waiting one.

/** Lower runs first. */
export const PRIORITY = Object.freeze({ export: 0, pack: 0, analysis: 1 });

export class ToolsQueue {
    constructor({ log = console } = {}) {
        this.log = log;
        this.waiting = [];
        this.current = null;
        this.idle = Promise.resolve();
    }

    /**
     * Queues a job. `run(signal)` does the work; the returned promise settles with its result.
     * @param {{ key: string, kind: keyof PRIORITY, run: (signal: AbortSignal) => Promise<any> }} job
     */
    add({ key, kind, run }) {
        return new Promise((resolve, reject) => {
            const entry = { key, kind, run, resolve, reject, priority: PRIORITY[kind] ?? 1, controller: new AbortController() };
            // Stable by priority: a new export goes behind other exports but ahead of every analysis job.
            const at = this.waiting.findIndex((w) => w.priority > entry.priority);
            if (at < 0) this.waiting.push(entry);
            else this.waiting.splice(at, 0, entry);
            this.#next();
        });
    }

    /** 0 = running now, 1.. = jobs ahead + 1, -1 = not here. */
    position(key) {
        if (this.current?.key === key) return 0;
        const i = this.waiting.findIndex((w) => w.key === key);
        return i < 0 ? -1 : i + 1;
    }

    get busy() {
        return Boolean(this.current);
    }

    /**
     * Cancels a job: a waiting one is dropped (its promise rejects with AbortError), a running one is aborted.
     * @returns {'dropped'|'aborted'|null}
     */
    cancel(key) {
        const i = this.waiting.findIndex((w) => w.key === key);
        if (i >= 0) {
            const [entry] = this.waiting.splice(i, 1);
            entry.reject(abortError());
            return 'dropped';
        }
        if (this.current?.key === key) {
            this.current.controller.abort();
            return 'aborted';
        }
        return null;
    }

    /** Resolves when nothing runs and nothing waits (tests, shutdown). */
    async drain() {
        while (this.current || this.waiting.length) await this.idle;
    }

    #next() {
        if (this.current || !this.waiting.length) return;
        const entry = this.waiting.shift();
        this.current = entry;
        this.idle = (async () => {
            try {
                entry.resolve(await entry.run(entry.controller.signal));
            } catch (error) {
                entry.reject(error);
            } finally {
                this.current = null;
                this.#next();
            }
        })();
    }
}

export const abortError = () => Object.assign(new Error('Canceled.'), { name: 'AbortError', code: 'ABORT_ERR' });
export const isAbort = (error) => error?.name === 'AbortError';

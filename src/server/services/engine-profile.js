// What the connected ComfyUI can run: its hardware and, per preset, the variant that fits it.
// Detected from /system_stats + /object_info, cached per engine address for a few minutes (the
// object_info dump is large), and re-detected on demand after models or nodes are installed. An older profile is
// still answered at once while a new check runs in the background (a busy ComfyUI can take a minute to answer
// /object_info, and the cards' Model and Length lists must not wait on it); a failed check is remembered briefly.
import { firstVariants } from '../generation/presets.js';
import { lorasIn, pickVariants } from '../generation/engine-check.js';

const MAX_AGE_MS = 5 * 60_000;
const FAILED_AGE_MS = 30_000; // an engine that could not be reached is not asked again for this long

export class EngineProfile {
    #snapshot = null;
    #pending = null;
    #failed = null; // { url, at, result } of the last failed first check

    /** @param {{ catalog: Map, comfy: () => import('./comfy-client.js').ComfyClient }} deps */
    constructor({ catalog, comfy, maxAgeMs = MAX_AGE_MS, now = Date.now }) {
        this.catalog = catalog;
        this.comfy = comfy;
        this.maxAgeMs = maxAgeMs;
        this.now = now;
    }

    /**
     * { detected, url, hardware, presets: Map<id, preset>, report, loras: string[], error? }.
     * Never throws: an engine that cannot be reached keeps its last profile, or, never seen,
     * offers every preset's best variant unchecked (rendering then fails with ComfyUI's reason).
     */
    async current({ refresh = false } = {}) {
        const client = this.comfy();
        const snapshot = this.#snapshot;
        const known = snapshot?.url === client.baseUrl;
        if (known && !refresh) {
            if (this.now() - snapshot.detectedAt >= this.maxAgeMs) this.#check(client); // in the background
            return snapshot;
        }
        const failed = this.#failed;
        if (!refresh && failed?.url === client.baseUrl && this.now() - failed.at < FAILED_AGE_MS) return failed.result;
        return this.#check(client);
    }

    /** One check per engine address at a time (a check of the old address never answers for a new one). */
    #check(client) {
        if (this.#pending?.url === client.baseUrl) return this.#pending.promise;
        const pending = { url: client.baseUrl };
        pending.promise = this.#detect(client).finally(() => {
            if (this.#pending === pending) this.#pending = null;
        });
        this.#pending = pending;
        return pending.promise;
    }

    async #detect(client) {
        try {
            const [hardware, objectInfo] = await Promise.all([client.hardware(), client.objectInfo()]);
            // Only variants this card has the memory for (engine-check.js tooBigFor).
            const { presets, report } = pickVariants(this.catalog, objectInfo, { vramGb: hardware.vramTotalGb });
            this.#snapshot = { detected: true, url: client.baseUrl, detectedAt: this.now(), hardware, presets, report, loras: lorasIn(objectInfo) };
            this.#failed = null;
            return this.#snapshot;
        } catch (error) {
            if (this.#snapshot?.url === client.baseUrl) return this.#snapshot;
            const result = { detected: false, url: client.baseUrl, error: error.message, hardware: null, presets: firstVariants(this.catalog), report: [], loras: [] };
            this.#failed = { url: client.baseUrl, at: this.now(), result };
            return result;
        }
    }
}

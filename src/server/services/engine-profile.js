// What the connected ComfyUI can run: its hardware and, per preset, the variant that fits it.
// Detected from /system_stats + /object_info, cached per engine address for a few minutes (the
// object_info dump is large), and re-detected on demand after models or nodes are installed.
import { firstVariants } from '../generation/presets.js';
import { pickVariants } from '../generation/engine-check.js';

const MAX_AGE_MS = 5 * 60_000;

export class EngineProfile {
    #snapshot = null;
    #pending = null;

    /** @param {{ catalog: Map, comfy: () => import('./comfy-client.js').ComfyClient }} deps */
    constructor({ catalog, comfy, maxAgeMs = MAX_AGE_MS, now = Date.now }) {
        this.catalog = catalog;
        this.comfy = comfy;
        this.maxAgeMs = maxAgeMs;
        this.now = now;
    }

    /**
     * { detected, url, hardware, presets: Map<id, preset>, report, error? }.
     * Never throws: an engine that cannot be reached keeps its last profile, or, never seen,
     * offers every preset's best variant unchecked (rendering then fails with ComfyUI's reason).
     */
    async current({ refresh = false } = {}) {
        const client = this.comfy();
        const snapshot = this.#snapshot;
        const fresh = snapshot?.url === client.baseUrl && this.now() - snapshot.detectedAt < this.maxAgeMs;
        if (fresh && !refresh) return snapshot;
        this.#pending ??= this.#detect(client).finally(() => {
            this.#pending = null;
        });
        return this.#pending;
    }

    async #detect(client) {
        try {
            const [hardware, objectInfo] = await Promise.all([client.hardware(), client.objectInfo()]);
            const { presets, report } = pickVariants(this.catalog, objectInfo);
            this.#snapshot = { detected: true, url: client.baseUrl, detectedAt: this.now(), hardware, presets, report };
            return this.#snapshot;
        } catch (error) {
            if (this.#snapshot?.url === client.baseUrl) return this.#snapshot;
            return { detected: false, url: client.baseUrl, error: error.message, hardware: null, presets: firstVariants(this.catalog), report: [] };
        }
    }
}

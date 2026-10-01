// Thin client for a local ComfyUI server's HTTP API.
const TIMEOUT_MS = 5000;

export class ComfyClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }

    async #get(path, timeout = TIMEOUT_MS) {
        const response = await fetch(this.baseUrl + path, { signal: AbortSignal.timeout(timeout) });
        if (!response.ok) throw new Error(`ComfyUI ${path} answered ${response.status}`);
        return response.json();
    }

    /** Engine health for the status light: never throws, always returns a shape the view can render. */
    async status() {
        try {
            const stats = await this.#get('/system_stats');
            const device = stats.devices?.[0] ?? {};
            const queue = await this.#get('/queue');
            return {
                online: true,
                version: stats.system?.comfyui_version ?? 'unknown',
                gpu: (device.name ?? 'unknown').replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*native$/, ''),
                vramTotalGb: (device.vram_total ?? 0) / 1024 ** 3,
                vramFreeGb: (device.vram_free ?? 0) / 1024 ** 3,
                running: queue.queue_running?.length ?? 0,
                pending: queue.queue_pending?.length ?? 0,
            };
        } catch (error) {
            return { online: false, error: error.name === 'TimeoutError' ? 'No answer within 5 s' : error.message };
        }
    }

    /** Model files ComfyUI can see in one folder (diffusion_models, text_encoders, vae, loras...). */
    async models(folder) {
        return this.#get(`/models/${encodeURIComponent(folder)}`);
    }
}

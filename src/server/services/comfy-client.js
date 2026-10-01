// Client for a local ComfyUI server: status, models, uploads, prompt submission, live
// progress over its WebSocket, results and cancellation.
const TIMEOUT_MS = 5000;

export class ComfyError extends Error {}

export class ComfyClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }

    async #request(path, { method = 'GET', body, headers, timeout = TIMEOUT_MS, raw = false } = {}) {
        // ComfyUI can stall its HTTP thread during heavy VAE decodes, so long calls get long timeouts.
        const response = await fetch(this.baseUrl + path, { method, body, headers, signal: AbortSignal.timeout(timeout) });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new ComfyError(`ComfyUI ${method} ${path} answered ${response.status}: ${text.slice(0, 500)}`);
        }
        return raw ? response : response.json();
    }

    /** Engine health for the status light: never throws. */
    async status() {
        try {
            const stats = await this.#request('/system_stats');
            const device = stats.devices?.[0] ?? {};
            const queue = await this.#request('/queue');
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

    models(folder) {
        return this.#request(`/models/${encodeURIComponent(folder)}`);
    }

    nodeClasses() {
        return this.#request('/object_info', { timeout: 60_000 }).then((info) => new Set(Object.keys(info)));
    }

    /** Uploads image bytes into ComfyUI's input folder; returns the name LoadImage should use. */
    async uploadImage(bytes, filename, mime = 'image/png') {
        const form = new FormData();
        form.append('image', new Blob([bytes], { type: mime }), filename);
        form.append('overwrite', 'true');
        const result = await this.#request('/upload/image', { method: 'POST', body: form, timeout: 60_000 });
        return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
    }

    async submit(graph, clientId) {
        const result = await this.#request('/prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: graph, client_id: clientId }),
            timeout: 60_000,
        });
        if (result.node_errors && Object.keys(result.node_errors).length) {
            throw new ComfyError(`Workflow rejected: ${JSON.stringify(result.node_errors).slice(0, 500)}`);
        }
        return result.prompt_id;
    }

    async history(promptId) {
        return (await this.#request(`/history/${encodeURIComponent(promptId)}`, { timeout: 60_000 }))[promptId] ?? null;
    }

    async queueHas(promptId) {
        const q = await this.#request('/queue', { timeout: 60_000 });
        return [...(q.queue_running ?? []), ...(q.queue_pending ?? [])].some((item) => item[1] === promptId);
    }

    /** Downloads one output file ({ filename, subfolder, type }) as bytes. */
    async download(file) {
        const params = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' });
        const response = await this.#request(`/view?${params}`, { raw: true, timeout: 300_000 });
        return Buffer.from(await response.arrayBuffer());
    }

    /** Unloads every model and clears VRAM: needed when switching model families on 24 GB. */
    async free() {
        await this.#request('/free', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unload_models: true, free_memory: true }),
            timeout: 60_000,
        });
    }

    async cancel(promptId) {
        await this.#request('/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [promptId] }) }).catch(() => {});
        await this.#request('/interrupt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt_id: promptId }) }).catch(() => {});
    }

    /**
     * Opens ComfyUI's WebSocket for one client id. ComfyUI sends step progress only to the client
     * that submitted the prompt, so the same id must be used for submit(). Returns { close }.
     */
    listen(clientId, onMessage) {
        const url = `${this.baseUrl.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`;
        const socket = new WebSocket(url);
        socket.addEventListener('message', (event) => {
            if (typeof event.data !== 'string') return; // binary preview frames
            try {
                onMessage(JSON.parse(event.data));
            } catch {
                /* ignore malformed frames */
            }
        });
        const opened = new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, { once: true });
            socket.addEventListener('error', () => reject(new ComfyError('Could not open the ComfyUI progress socket.')), { once: true });
        });
        return { opened, close: () => socket.close() };
    }
}

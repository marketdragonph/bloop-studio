// The bloop web app's Studio API (api/v1/studio): the optional account that adds bloop's cloud
// models to cards, paid with the person's bloop credits. The token is only ever sent to that bloop.

export class BloopError extends Error {
    constructor(message, status, body = {}) {
        super(message);
        this.status = status;
        this.body = body;
    }
}

export class BloopClient {
    constructor(baseUrl, token = null, fetchImpl = fetch) {
        this.baseUrl = String(baseUrl).replace(/\/+$/, '');
        this.token = token;
        this.fetch = fetchImpl;
    }

    /** The browser page that asks the person to allow this app (PKCE, see BloopSignIn). */
    connectUrl({ port, state, challenge }) {
        const query = new URLSearchParams({ port: String(port), state, code_challenge: challenge });
        return `${this.baseUrl}/studio/connect?${query}`;
    }

    exchange({ code, verifier, deviceName }) {
        return this.#request('POST', '/token', { json: { code, code_verifier: verifier, device_name: deviceName } });
    }

    me() {
        return this.#request('GET', '/me');
    }

    models() {
        return this.#request('GET', '/models');
    }

    /** One render: { kind, model, prompt, label, params, pictures: { picture|first_frame|last_frame: { bytes, mime, name } } }. */
    render({ kind, model, prompt, label, params = {}, pictures = {} }) {
        const form = new FormData();
        form.set('kind', kind);
        form.set('model', model);
        form.set('prompt', prompt);
        if (label) form.set('label', label.slice(0, 120));
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== '') form.set(`params[${key}]`, String(value));
        }
        for (const [slot, file] of Object.entries(pictures)) {
            form.set(slot, new Blob([file.bytes], { type: file.mime }), file.name);
        }
        return this.#request('POST', '/renders', { form });
    }

    status(renderId) {
        return this.#request('GET', `/renders/${encodeURIComponent(renderId)}`);
    }

    signOut() {
        return this.#request('DELETE', '/token');
    }

    /** A finished render's file. */
    async download(url) {
        const response = await this.fetch(url);
        if (!response.ok) throw new BloopError(`Could not download the render (HTTP ${response.status}).`, response.status);
        return { bytes: Buffer.from(await response.arrayBuffer()), mime: response.headers.get('content-type')?.split(';')[0] ?? null };
    }

    async #request(method, path, { json, form } = {}) {
        const headers = { accept: 'application/json' };
        if (this.token) headers.authorization = `Bearer ${this.token}`;
        if (json) headers['content-type'] = 'application/json';

        let response;
        try {
            response = await this.fetch(`${this.baseUrl}/api/v1/studio${path}`, {
                method,
                headers,
                body: json ? JSON.stringify(json) : form,
                signal: AbortSignal.timeout(120_000),
            });
        } catch {
            throw new BloopError(`Could not reach bloop at ${this.baseUrl}.`, 0);
        }
        if (response.status === 204) return null;
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = body.message ?? body.error ?? Object.values(body.errors ?? {})[0]?.[0] ?? `bloop answered HTTP ${response.status}.`;
            throw new BloopError(message, response.status, body);
        }
        return body;
    }
}

// The optional bloop account. Sign-in is a browser hand-off with PKCE, like the GitHub CLI: we
// listen on 127.0.0.1, open bloop's "Connect Bloop Studio" page, and swap the one-time code it
// sends back for a token. No password ever passes through this app; any bloop login works.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { BloopClient } from './bloop-client.js';

// Where people sign in: always bloop itself. BLOOP_URL points a development run at a local bloop.
export const BLOOP_URL = process.env.BLOOP_URL ?? 'https://marketdragon.ph';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const MODELS_MAX_AGE_MS = 5 * 60_000; // older than this: still shown at once, and checked again in the background

const base64url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;background:#111113;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0">
<main style="text-align:center;max-width:28rem"><h1 style="font-size:1.25rem">${title}</h1><p>${text}</p></main></body>`;

export class BloopAccount {
    #pending = null; // { server, state, verifier, timer }
    #error = null;
    #models = null; // { at, data, who }: also saved in settings (bloopModels) so a launch shows it at once
    #fetching = null;

    /** @param {{ settings, openExternal: (url: string) => unknown, clientFor?: Function, now?: () => number }} deps */
    constructor({ settings, openExternal, baseUrl = BLOOP_URL, clientFor = (url, token) => new BloopClient(url, token), now = Date.now }) {
        this.baseUrl = baseUrl;
        this.settings = settings;
        this.openExternal = openExternal;
        this.clientFor = clientFor;
        this.now = now;
    }

    client() {
        return this.clientFor(this.baseUrl, this.settings.get('bloopToken'));
    }

    get signedIn() {
        return Boolean(this.settings.get('bloopToken'));
    }

    /** What Settings shows: signed out, waiting for the browser, or the account. */
    state() {
        if (this.#pending) return { status: 'waiting' };
        if (!this.signedIn) return { status: 'signed-out', error: this.#error };
        return { status: 'signed-in', account: this.settings.get('bloopAccount') ?? {}, error: this.#error };
    }

    /** Starts the browser hand-off; resolves once the browser is open (the answer arrives later). */
    async startSignIn() {
        this.#cancelPending();
        this.#error = null;
        const verifier = base64url(randomBytes(32));
        const state = base64url(randomBytes(24));
        const server = createServer((req, res) => this.#onCallback(req, res));
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const timer = setTimeout(() => this.#fail('Sign-in timed out. Press Sign in to try again.'), SIGN_IN_TIMEOUT_MS);
        this.#pending = { server, state, verifier, timer };

        const challenge = base64url(createHash('sha256').update(verifier).digest());
        const url = this.clientFor(this.baseUrl).connectUrl({ port: server.address().port, state, challenge });
        await this.openExternal(url);
        return url;
    }

    cancelSignIn() {
        this.#cancelPending();
    }

    /** Re-reads name, plan and credits. A revoked or expired token signs this app out. */
    async refresh() {
        if (!this.signedIn) return this.state();
        try {
            this.settings.update({ bloopAccount: await this.client().me() });
            this.#error = null;
        } catch (error) {
            if (error.status === 401) this.#forget('Your bloop sign-in expired. Sign in again to use bloop models.');
            else this.#error = error.message;
        }
        return this.state();
    }

    async signOut() {
        if (this.signedIn) await this.client().signOut().catch(() => {}); // revoke on bloop too, if it can be reached
        this.#forget(null);
    }

    /**
     * bloop's model list for the signed-in account; null when there is none to offer. bloop decides what a plan
     * sees (free plans: the lower-cost models), not this app. The last list is kept on this PC for this sign-in, so
     * cards show their models and durations at once, even right after launch; a list older than a few minutes is
     * still answered at once and checked again with bloop in the background (one request at a time). Only with no
     * list at all does a call wait for bloop.
     */
    async models({ refresh = false } = {}) {
        if (!this.signedIn) return null;
        const who = this.#who();
        if (this.#models?.who !== who) this.#models = this.#saved(who);
        const have = this.#models;
        if (have && !refresh) {
            if (this.now() - have.at >= MODELS_MAX_AGE_MS) this.#fetchModels();
            return have.data;
        }
        return this.#fetchModels();
    }

    /** One models request at a time; resolves with the list (or the last one when bloop cannot be reached). */
    #fetchModels() {
        this.#fetching ??= this.#loadModels().finally(() => { this.#fetching = null; });
        return this.#fetching;
    }

    async #loadModels() {
        const who = this.#who();
        try {
            const data = await this.client().models();
            if (this.#who() === who) this.#keep({ at: this.now(), data, who });
            return data;
        } catch (error) {
            if (error.status === 401) {
                this.#forget('Your bloop sign-in expired. Sign in again to use bloop models.');
                return null;
            }
            if (error.status === 402) {
                // This plan gets no bloop models: remember that, and refresh the account so Settings shows the
                // plan bloop now reports.
                this.#keep({ at: this.now(), data: null, who });
                await this.refresh();
                return null;
            }
            return this.#models?.data ?? null; // offline or slow: keep offering what we last saw
        }
    }

    /** Which sign-in a saved list belongs to: a short hash of the token (never the token itself). */
    #who() {
        const token = this.settings.get('bloopToken');
        return token ? createHash('sha256').update(token).digest('hex').slice(0, 16) : null;
    }

    #saved(who) {
        const saved = this.settings.get('bloopModels');
        return saved && saved.who === who && Number.isFinite(saved.at) ? saved : null;
    }

    #keep(entry) {
        this.#models = entry;
        this.settings.update({ bloopModels: entry });
    }

    async #onCallback(req, res) {
        const pending = this.#pending;
        const url = new URL(req.url, 'http://127.0.0.1');
        if (!pending || url.pathname !== '/callback') {
            res.writeHead(404).end();
            return;
        }
        if (url.searchParams.get('state') !== pending.state) {
            res.writeHead(400, { 'content-type': 'text/html' }).end(page('Sign-in link mismatch', 'Press Sign in in Bloop Studio again.'));
            return;
        }
        if (!url.searchParams.get('code')) {
            res.writeHead(200, { 'content-type': 'text/html' }).end(page('Sign-in canceled', 'You can close this tab.'));
            this.#fail('Sign-in was canceled.');
            return;
        }
        try {
            const { token, account } = await this.clientFor(this.baseUrl).exchange({
                code: url.searchParams.get('code'),
                verifier: pending.verifier,
                deviceName: hostname().slice(0, 60),
            });
            this.settings.update({ bloopToken: token, bloopAccount: account });
            this.#models = null;
            res.writeHead(200, { 'content-type': 'text/html' }).end(page('Bloop Studio is connected', 'You can close this tab and go back to Bloop Studio.'));
            this.#cancelPending();
        } catch (error) {
            res.writeHead(200, { 'content-type': 'text/html' }).end(page('Sign-in failed', 'Go back to Bloop Studio and press Sign in again.'));
            this.#fail(error.message);
        }
    }

    #fail(message) {
        this.#error = message;
        this.#cancelPending();
    }

    #forget(message) {
        this.settings.clearSecret('bloopToken');
        this.settings.update({ bloopAccount: null, bloopModels: null });
        this.#models = null;
        this.#error = message;
    }

    #cancelPending() {
        if (!this.#pending) return;
        clearTimeout(this.#pending.timer);
        this.#pending.server.close();
        this.#pending = null;
    }
}

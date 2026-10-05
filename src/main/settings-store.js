// Settings persisted as JSON in the user's app-data folder. Secrets (API keys) are
// encrypted with Electron safeStorage (DPAPI on Windows) and never leave this module in plain text
// except to the code that calls their own provider.
import { safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const SECRET_KEYS = new Set(['anthropicApiKey', 'openaiApiKey', 'bloopToken']);

const DEFAULTS = {
    comfyUrl: 'http://127.0.0.1:8188',
    mediaDir: join(homedir(), 'Videos', 'Bloop Studio'),
    llmProvider: 'anthropic',
    anthropicModel: 'claude-opus-5-5',
    openaiModel: 'gpt-5.5',
    theme: 'dark',
    // 'maximized' (window controls in the top bar) or 'fullscreen' (F11), restored on launch. Replaces the
    // old `fullscreen` key, which defaulted to true and left no visible way to minimize or close.
    windowMode: 'maximized',
    // Optional bloop account (cloud models on credits), always at bloop itself (BLOOP_URL in development).
    // The token is a secret; the account is the last name/plan/credits bloop reported, shown offline.
    bloopAccount: null,
    // The last bloop model list for this sign-in ({ at, data, who }: who is a hash of the token, never the token),
    // so cards show their bloop models and durations at once after launch. Cleared on sign-out.
    bloopModels: null,
    // The person's own ComfyUI folder ('' = found automatically) and whether it starts with the app.
    comfyPath: '',
    engineAutostart: false,
    // Settings › Video tools › Choose ffmpeg.exe… ('' = the copy that ships with the app).
    ffmpegPath: '',
    // Settings › Director › Editing style (Katana P4, 05 §3.8): how the person likes to cut, plain text, ≤ 600
    // characters, read by the Director on every turn. Per install, so the prompt stays cache-stable.
    editStyle: '',
};

export class SettingsStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = { ...DEFAULTS, secrets: {} };
        if (existsSync(filePath)) {
            this.data = { ...this.data, ...JSON.parse(readFileSync(filePath, 'utf8')) };
        }
    }

    /** Public settings only; secrets are reported as present/absent, never returned. */
    all() {
        const { secrets, ...rest } = this.data;
        const configured = Object.fromEntries([...SECRET_KEYS].map((k) => [k, Boolean(secrets?.[k])]));
        return { ...rest, configured };
    }

    get(key) {
        return SECRET_KEYS.has(key) ? this.#decrypt(this.data.secrets?.[key]) : this.data[key];
    }

    update(values) {
        for (const [key, value] of Object.entries(values)) {
            if (SECRET_KEYS.has(key)) {
                if (value === '') continue; // blank field keeps the stored key
                this.data.secrets[key] = this.#encrypt(value);
            } else if (key in DEFAULTS) {
                this.data[key] = value;
            }
        }
        this.#save();
    }

    clearSecret(key) {
        if (SECRET_KEYS.has(key)) {
            delete this.data.secrets[key];
            this.#save();
        }
    }

    #encrypt(plain) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is unavailable; refusing to store the key in plain text.');
        return safeStorage.encryptString(plain).toString('base64');
    }

    #decrypt(stored) {
        return stored ? safeStorage.decryptString(Buffer.from(stored, 'base64')) : null;
    }

    #save() {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        writeFileSync(tmp, JSON.stringify(this.data, null, 2));
        renameSync(tmp, this.filePath); // atomic replace: a crash never leaves half a settings file
    }
}

export const settingsPath = (userDataDir) => join(userDataDir, 'settings.json');

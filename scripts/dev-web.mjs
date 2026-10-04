// Browser-only dev server (no Electron) on a fixed port, with in-memory settings.
// Usage: node scripts/dev-web.mjs   then open http://127.0.0.1:5199
import { createServer } from '../src/server/server.js';

const store = {
    comfyUrl: 'http://127.0.0.1:8188',
    mediaDir: 'C:/Users/Public/Videos/Bloop Studio',
    llmProvider: 'anthropic',
    anthropicModel: 'claude-sonnet-5-5',
    openaiModel: 'gpt-5',
    bloopAccount: null,
    bloopToken: null, // in memory only, gone when this dev server stops
    launchSeen: Boolean(process.env.SKIP_LAUNCH), // SKIP_LAUNCH=1 opens straight on Spaces
};
const settings = {
    all: () => {
        const { bloopToken, ...rest } = store;
        return { ...rest, configured: { anthropicApiKey: false, openaiApiKey: false, bloopToken: Boolean(bloopToken) } };
    },
    get: (key) => store[key],
    update: (values) => {
        if (process.env.DEBUG_SETTINGS) console.log('settings.update', Object.keys(values).map((k) => `${k}=${values[k] == null ? values[k] : typeof values[k]}`).join(' '));
        Object.assign(store, Object.fromEntries(Object.entries(values).filter(([k]) => !k.endsWith('ApiKey'))));
    },
    clearSecret(key) {
        if (process.env.DEBUG_SETTINGS) console.log('settings.clearSecret', key, new Error().stack.split('\n').slice(2, 5).join(' | '));
        store[key] = null;
    },
};

import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Dev data lives in the temp folder, never in the repo.
const dataDir = join(tmpdir(), 'bloop-studio-dev');
// NO_BROWSER=1 prints the bloop sign-in link instead of opening it (to open it somewhere else).
const openExternal = process.env.NO_BROWSER ? (link) => console.log(`bloop sign-in: ${link}`) : undefined;
// The local bloop (Sail) by default; BLOOP_URL=https://… for another one.
const bloopUrl = process.env.BLOOP_URL ?? 'http://localhost';
const { url } = await createServer({ settings, dataDir, port: Number(process.env.PORT ?? 5199), openExternal, bloopUrl });
console.log(`dev data: ${dataDir}`);
console.log(`dev web server on ${url}`);

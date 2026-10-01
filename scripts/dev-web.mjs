// Browser-only dev server (no Electron) on a fixed port, with in-memory settings.
// Usage: node scripts/dev-web.mjs   then open http://127.0.0.1:5199
import { createServer } from '../src/server/server.js';

const store = {
    comfyUrl: 'http://127.0.0.1:8188',
    mediaDir: 'C:/Users/Public/Videos/Bloop Studio',
    llmProvider: 'anthropic',
    anthropicModel: 'claude-sonnet-5-5',
    openaiModel: 'gpt-5',
};
const settings = {
    all: () => ({ ...store, configured: { anthropicApiKey: false, openaiApiKey: false } }),
    get: (key) => store[key],
    update: (values) => Object.assign(store, Object.fromEntries(Object.entries(values).filter(([k]) => !k.endsWith('ApiKey')))),
    clearSecret() {},
};

const { url } = await createServer({ settings, dataDir: '.', port: Number(process.env.PORT ?? 5199) });
console.log(`dev web server on ${url}`);

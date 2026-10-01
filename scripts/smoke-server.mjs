// Smoke test: boots the server with in-memory settings (no Electron) and hits each route.
// Usage: node scripts/smoke-server.mjs
import { createServer } from '../src/server/server.js';

const store = { comfyUrl: 'http://127.0.0.1:8188', mediaDir: 'C:/tmp/media', llmProvider: 'anthropic', anthropicModel: 'claude-sonnet-5-5', openaiModel: 'gpt-5' };
const settings = {
    all: () => ({ ...store, configured: { anthropicApiKey: false, openaiApiKey: false } }),
    get: (key) => store[key],
    update: (values) => Object.assign(store, values),
    clearSecret() {},
};

const { server, url } = await createServer({ settings, dataDir: '.', dbPath: ':memory:' });
const marker = /Engine (online|offline)|Settings saved|CSRF token|Something went wrong[^<]*/;

async function check(path, options) {
    const response = await fetch(url + path, { redirect: 'manual', ...options });
    const text = await response.text();
    console.log(`${options?.method ?? 'GET'} ${path} -> ${response.status} (${text.length} bytes) ${(text.match(marker) ?? [''])[0]}`);
    return { response, text };
}

try {
    const { text: home } = await check('/');
    await check('/settings');
    await check('/engine/status');
    await check('/assets/css/app.css');
    await check('/assets/vendor/htmx.min.js');
    await check('/assets/%2e%2e/package.json');
    await check('/settings', { method: 'POST', body: new URLSearchParams({ comfyUrl: 'x' }) });

    const token = home.match(/X-CSRF-Token": "([a-f0-9]+)/)[1];
    const valid = { _csrf: token, comfyUrl: 'http://127.0.0.1:8188', mediaDir: 'C:/tmp/media', llmProvider: 'openai', anthropicApiKey: '', openaiApiKey: '' };
    const { response } = await check('/settings', { method: 'POST', body: new URLSearchParams(valid) });
    console.log(`  redirect -> ${response.headers.get('location')}, provider now ${store.llmProvider}`);

    const { text } = await check('/settings', { method: 'POST', body: new URLSearchParams({ _csrf: token, comfyUrl: 'nope', mediaDir: '', llmProvider: 'x' }) });
    console.log(`  validation errors shown: ${(text.match(/class="field__error"/g) ?? []).length}`);
} finally {
    server.close();
}

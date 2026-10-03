// Settings page: engine address, media folder, and the Director's LLM provider + keys.
import { Hono } from 'hono';
import { ComfyClient } from '../services/comfy-client.js';
import { THEMES } from '../views.js';

const PROVIDERS = ['anthropic', 'openai'];

function validate(body) {
    const errors = {};
    try {
        const url = new URL(body.comfyUrl);
        if (!['http:', 'https:'].includes(url.protocol)) errors.comfyUrl = 'Use an http:// or https:// address.';
    } catch {
        errors.comfyUrl = 'Enter a full address, e.g. http://127.0.0.1:8188';
    }
    if (!body.mediaDir?.trim()) errors.mediaDir = 'Choose a folder for generated media.';
    if (!PROVIDERS.includes(body.llmProvider)) errors.llmProvider = 'Pick Claude or OpenAI.';
    return errors;
}

export function settingsRoutes({ views, settings, onThemeChange }) {
    const routes = new Hono();

    const page = async (c, extra = {}) =>
        c.html(await views.render('pages/settings', { settings: settings.all(), errors: {}, ...extra }));

    routes.get('/', (c) => page(c, { saved: c.req.query('saved') === '1' }));

    routes.post('/', async (c) => {
        const body = await c.req.parseBody();
        const errors = validate(body);
        if (Object.keys(errors).length) return page(c, { errors, old: body });

        // Picking a provider with no key while the other has one would leave the Director dead:
        // follow the key.
        const hasKey = (name, typed) => Boolean(typed?.trim()) || settings.all().configured[name];
        const claudeKey = hasKey('anthropicApiKey', body.anthropicApiKey);
        const openaiKey = hasKey('openaiApiKey', body.openaiApiKey);
        let llmProvider = body.llmProvider;
        if (llmProvider === 'anthropic' && !claudeKey && openaiKey) llmProvider = 'openai';
        if (llmProvider === 'openai' && !openaiKey && claudeKey) llmProvider = 'anthropic';

        settings.update({
            comfyUrl: body.comfyUrl.trim(),
            mediaDir: body.mediaDir.trim(),
            llmProvider,
            anthropicModel: body.anthropicModel?.trim() || undefined,
            openaiModel: body.openaiModel?.trim() || undefined,
            anthropicApiKey: body.anthropicApiKey?.trim() ?? '',
            openaiApiKey: body.openaiApiKey?.trim() ?? '',
        });
        return c.redirect('/settings?saved=1');
    });

    routes.delete('/keys/:name', (c) => {
        const name = c.req.param('name');
        settings.clearSecret(name === 'openai' ? 'openaiApiKey' : 'anthropicApiKey');
        c.header('HX-Redirect', '/settings?saved=1');
        return c.body(null, 204);
    });

    // The top-bar theme switch: dark → light → system (follows Windows).
    routes.put('/theme', async (c) => {
        const { theme } = await c.req.json();
        if (!THEMES.includes(theme)) return c.json({ error: 'Unknown theme.' }, 422);
        settings.update({ theme });
        onThemeChange(theme); // the window controls in the top bar follow the theme
        return c.json({ theme });
    });

    // Lets the user test an address before saving it.
    routes.post('/test-engine', async (c) => {
        const { comfyUrl } = await c.req.parseBody();
        let status;
        try {
            status = await new ComfyClient(String(comfyUrl)).status();
        } catch (error) {
            status = { online: false, error: error.message };
        }
        return c.html(await views.render('partials/engine-test', { status }));
    });

    return routes;
}

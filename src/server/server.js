// Builds the Hono app and listens on 127.0.0.1 with an OS-assigned port.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { createViews } from './views.js';
import { csrf } from './middleware/csrf.js';
import { staticFiles } from './middleware/static-files.js';
import { ComfyClient } from './services/comfy-client.js';
import { homeRoutes } from './routes/home.js';
import { settingsRoutes } from './routes/settings.js';
import { engineRoutes } from './routes/engine.js';

export async function createServer({ settings, dataDir, port = 0 }) {
    const csrfToken = randomBytes(32).toString('hex');
    const views = createViews({ csrfToken });
    const comfy = () => new ComfyClient(settings.get('comfyUrl'));
    const deps = { settings, views, comfy, dataDir };

    const app = new Hono();
    app.use('*', csrf(csrfToken));
    app.use('/assets/*', staticFiles('/assets/'));
    app.route('/', homeRoutes(deps));
    app.route('/settings', settingsRoutes(deps));
    app.route('/engine', engineRoutes(deps));
    app.notFound((c) => c.html(views.render('pages/not-found', {}), 404));
    app.onError((error, c) => {
        console.error(error);
        return c.html(views.render('pages/error', { message: error.message }), 500);
    });

    return new Promise((resolve) => {
        const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
            resolve({ server, url: `http://127.0.0.1:${info.port}` });
        });
    });
}

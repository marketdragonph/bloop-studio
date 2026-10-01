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
import { spacesRoutes } from './routes/spaces.js';
import { openDatabase } from './db/database.js';
import { SpacesRepository } from './repositories/spaces.js';
import { join } from 'node:path';

export async function createServer({ settings, dataDir, port = 0, dbPath = join(dataDir, 'bloop-studio.db') }) {
    const csrfToken = randomBytes(32).toString('hex');
    const views = createViews({ csrfToken });
    const db = openDatabase(dbPath);
    const spaces = new SpacesRepository(db);
    const comfy = () => new ComfyClient(settings.get('comfyUrl'));
    const deps = { settings, views, comfy, dataDir, db, spaces };

    const app = new Hono();
    app.use('*', csrf(csrfToken));
    app.use('/assets/*', staticFiles('/assets/'));
    app.use('/shared/*', staticFiles('/shared/', '../../shared/')); // src/shared
    app.route('/', homeRoutes(deps));
    app.route('/settings', settingsRoutes(deps));
    app.route('/engine', engineRoutes(deps));
    app.route('/spaces', spacesRoutes(deps));
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

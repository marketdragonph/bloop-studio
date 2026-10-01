// Builds the Hono app and listens on 127.0.0.1 with an OS-assigned port.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createViews } from './views.js';
import { csrf } from './middleware/csrf.js';
import { staticFiles } from './middleware/static-files.js';
import { ComfyClient } from './services/comfy-client.js';
import { openDatabase } from './db/database.js';
import { SpacesRepository } from './repositories/spaces.js';
import { JobsRepository } from './repositories/jobs.js';
import { loadPresets } from './generation/presets.js';
import { MediaStore } from './generation/media-store.js';
import { BoardEvents } from './generation/events.js';
import { GenerationWorker } from './generation/worker.js';
import { homeRoutes } from './routes/home.js';
import { settingsRoutes } from './routes/settings.js';
import { engineRoutes } from './routes/engine.js';
import { spacesRoutes } from './routes/spaces.js';
import { generationRoutes } from './routes/generation.js';

export async function createServer({ settings, dataDir, port = 0, dbPath = join(dataDir, 'bloop-studio.db'), startWorker = true }) {
    const csrfToken = randomBytes(32).toString('hex');
    const views = createViews({ csrfToken, getTheme: () => settings.get('theme') });
    const db = openDatabase(dbPath);
    const spaces = new SpacesRepository(db);
    const jobs = new JobsRepository(db);
    const presets = loadPresets();
    const media = new MediaStore(() => settings.get('mediaDir'));
    const events = new BoardEvents();
    const comfy = () => new ComfyClient(settings.get('comfyUrl'));
    const worker = new GenerationWorker({ jobs, spaces, presets, media, events, comfy });
    const deps = { settings, views, comfy, dataDir, db, spaces, jobs, presets, media, events, worker };

    const app = new Hono();
    app.use('*', csrf(csrfToken));
    app.use('/assets/*', staticFiles('/assets/'));
    app.use('/shared/*', staticFiles('/shared/', '../../shared/')); // src/shared
    app.route('/', homeRoutes(deps));
    app.route('/settings', settingsRoutes(deps));
    app.route('/engine', engineRoutes(deps));
    app.route('/spaces', spacesRoutes(deps));
    app.route('/', generationRoutes(deps));
    app.notFound((c) => c.html(views.render('pages/not-found', {}), 404));
    app.onError((error, c) => {
        console.error(error);
        return c.html(views.render('pages/error', { message: error.message }), 500);
    });

    if (startWorker) worker.start();

    return new Promise((resolve) => {
        const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
            resolve({ server, url: `http://127.0.0.1:${info.port}`, worker });
        });
    });
}

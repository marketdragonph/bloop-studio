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
import { loadCatalog } from './generation/presets.js';
import { EngineProfile } from './services/engine-profile.js';
import { MediaStore } from './generation/media-store.js';
import { BoardEvents } from './generation/events.js';
import { GenerationWorker } from './generation/worker.js';
import { homeRoutes } from './routes/home.js';
import { settingsRoutes } from './routes/settings.js';
import { engineRoutes } from './routes/engine.js';
import { spacesRoutes } from './routes/spaces.js';
import { generationRoutes } from './routes/generation.js';
import { directorRoutes } from './routes/director.js';
import { appUpdateRoutes, NO_UPDATES } from './routes/app-update.js';
import { DirectorRepository } from './repositories/director.js';
import { DirectorService } from './director/service.js';

/** Default for browser-only dev: Explorer with the file selected. Electron passes shell.showItemInFolder. */
const explorerReveal = async (fullPath) => {
    const { spawn } = await import('node:child_process');
    spawn('explorer.exe', [`/select,${fullPath}`], { detached: true, stdio: 'ignore' }).unref();
};

export async function createServer({ settings, dataDir, port = 0, dbPath = join(dataDir, 'bloop-studio.db'), startWorker = true, reveal = explorerReveal, updates = NO_UPDATES }) {
    const csrfToken = randomBytes(32).toString('hex');
    const views = createViews({ csrfToken, getTheme: () => settings.get('theme') });
    const db = openDatabase(dbPath);
    const spaces = new SpacesRepository(db);
    const jobs = new JobsRepository(db);
    const media = new MediaStore(() => settings.get('mediaDir'));
    const events = new BoardEvents();
    const comfy = () => new ComfyClient(settings.get('comfyUrl'));
    const engine = new EngineProfile({ catalog: loadCatalog(), comfy });
    const worker = new GenerationWorker({ jobs, spaces, engine, media, events, comfy });
    const director = new DirectorRepository(db);
    const directorService = new DirectorService({ settings, spaces, director });
    const deps = { settings, views, comfy, dataDir, db, spaces, jobs, engine, media, events, worker, director, directorService, reveal, updates };

    const app = new Hono();
    app.use('*', csrf(csrfToken));
    app.use('/assets/*', staticFiles('/assets/'));
    app.use('/shared/*', staticFiles('/shared/', '../../shared/')); // src/shared
    app.route('/', homeRoutes(deps));
    app.route('/settings', settingsRoutes(deps));
    app.route('/engine', engineRoutes(deps));
    app.route('/app/update', appUpdateRoutes(deps));
    app.route('/spaces', spacesRoutes(deps));
    app.route('/', generationRoutes(deps));
    app.route('/', directorRoutes(deps));
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

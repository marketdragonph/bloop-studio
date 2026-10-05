// Builds the Hono app and listens on 127.0.0.1 with an OS-assigned port.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
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
import { DirectorRuns } from './director/runs.js';
import { DirectorPlans } from './repositories/director-plans.js';
import { BoardOps } from './director/ops/board-ops.js';
import { BuildStages } from './director/plan/stages.js';
import { BuildRunner } from './director/build/runner.js';
import { engineInfoFor } from './director/engine-info.js';
import { BloopAccount } from './services/bloop-account.js';
import { accountRoutes } from './routes/account.js';
import { ComfyLauncher } from './services/comfy-launcher.js';
import { EngineInstaller } from './engine-install/installer.js';
import { engineInstallRoutes } from './routes/engine-install.js';
import { CutsRepository } from './repositories/cuts.js';
import { BoardCut } from './cut/board-cut.js';
import { CappedFfmpeg } from './media/capped-ffmpeg.js';
import { TakeMeasurer } from './generation/measure-take.js';
import { cutRoutes } from './routes/cut.js';

/** Default for browser-only dev: Explorer with the file selected. Electron passes shell.showItemInFolder. */
const explorerReveal = async (fullPath) => {
    const { spawn } = await import('node:child_process');
    spawn('explorer.exe', [`/select,${fullPath}`], { detached: true, stdio: 'ignore' }).unref();
};

/** Default for browser-only dev: the default browser. Electron passes shell.openExternal. */
const startBrowser = async (url) => {
    const { spawn } = await import('node:child_process');
    spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
};

export async function createServer({ settings, dataDir, port = 0, dbPath = join(dataDir, 'bloop-studio.db'), startWorker = true, reveal = explorerReveal, openExternal = startBrowser, bloopUrl = undefined, updates = NO_UPDATES, onThemeChange = () => {} }) {
    const csrfToken = randomBytes(32).toString('hex');
    const views = createViews({ csrfToken, getTheme: () => settings.get('theme') });
    const db = openDatabase(dbPath);
    const spaces = new SpacesRepository(db);
    const jobs = new JobsRepository(db);
    const media = new MediaStore(() => settings.get('mediaDir'));
    const events = new BoardEvents();
    const comfy = () => new ComfyClient(settings.get('comfyUrl'));
    const engine = new EngineProfile({ catalog: loadCatalog(), comfy });
    const account = new BloopAccount({ settings, openExternal, baseUrl: bloopUrl }); // undefined = bloop itself
    const launcher = new ComfyLauncher({ settings }); // the person's own ComfyUI, started from the top bar
    const installer = new EngineInstaller({ settings, launcher, engine }); // "Install offline engine"
    // The Cut (Mini Katana): one cut per space, the one reader of the board, and take lengths measured off the GPU path.
    const cuts = new CutsRepository(db);
    const boardCut = new BoardCut({ db, exists: (path) => Boolean(media.resolve(path) && existsSync(media.resolve(path))) });
    const ffmpeg = new CappedFfmpeg({ getSettingsPath: () => settings.get('ffmpegPath') });
    const measurer = new TakeMeasurer({ ffmpeg, cuts, media, events });
    const worker = new GenerationWorker({ jobs, spaces, engine, media, events, comfy, account, cuts, measurer });
    const director = new DirectorRepository(db);
    // The Director (a port of bloop's Spaces Director): plans, the board ops, the staged rail, and the beat writers.
    const plans = new DirectorPlans(db);
    const ops = new BoardOps({ spaces });
    const stages = new BuildStages({ plans, ops, spaces });
    let directorService = null;
    const runner = new BuildRunner({ plans, stages, ops, events, write: (call) => directorService.complete(call) });
    directorService = new DirectorService({ settings, spaces, director, plans, stages, ops, runner, engineInfo: engineInfoFor(engine) });
    const directorRuns = new DirectorRuns({ director, service: directorService, events }); // the Director as a background job
    directorRuns.recover();
    runner.resume();
    const deps = { settings, views, comfy, dataDir, db, spaces, jobs, engine, media, events, worker, director, directorService, directorRuns, plans, runner, reveal, updates, onThemeChange, account, launcher, installer, cuts, boardCut };

    const app = new Hono();
    app.use('*', csrf(csrfToken));
    app.use('/assets/*', staticFiles('/assets/'));
    app.use('/shared/*', staticFiles('/shared/', '../../shared/')); // src/shared
    app.route('/', homeRoutes(deps));
    app.route('/settings', settingsRoutes(deps));
    app.route('/engine/install', engineInstallRoutes(deps));
    app.route('/engine', engineRoutes(deps));
    app.route('/app/update', appUpdateRoutes(deps));
    app.route('/account', accountRoutes(deps));
    app.route('/spaces', spacesRoutes(deps));
    app.route('/', generationRoutes(deps));
    app.route('/', directorRoutes(deps));
    app.route('/', cutRoutes(deps));
    app.notFound((c) => c.html(views.render('pages/not-found', {}), 404));
    app.onError((error, c) => {
        console.error(error);
        return c.html(views.render('pages/error', { message: error.message }), 500);
    });

    if (startWorker) worker.start();
    // "Start ComfyUI with Bloop Studio": only when it is not already running (by hand, or a second app).
    if (settings.get('engineAutostart') && launcher.state().available) {
        comfy().status().then((status) => status.online || launcher.start()).catch(() => {});
    }

    return new Promise((resolve) => {
        const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
            resolve({ server, url: `http://127.0.0.1:${info.port}`, worker, launcher });
        });
    });
}

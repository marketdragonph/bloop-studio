// "Install offline engine" (Settings → Engine): a modal that shows what this PC can run, suggests
// the model families for its card, and installs ComfyUI + the picked models in the background.
import { Hono } from 'hono';
import { isAbsolute } from 'node:path';
import { MAX_FOLDER_CHARS, planFor } from '../engine-install/plan.js';
import { readDrives, readGpu } from '../engine-install/hardware.js';

export function engineInstallRoutes({ views, installer, launcher, engine, hardware = { readGpu, readDrives } }) {
    const routes = new Hono();
    let cached = null; // the PC does not change while the app runs: read it once
    const plan = async () => (cached ??= planFor({ gpu: await hardware.readGpu(), drives: hardware.readDrives() }));

    const progress = async (c) => c.html(await views.render('partials/engine-install-progress', { install: installer.state() }));
    const wizard = async (c, extra = {}) => {
        const pending = installer.state().pending;
        // The person's own ComfyUI, when there is one: the models can go there instead of a new install.
        const existing = launcher?.install() ?? null;
        // Families the running ComfyUI can already render (engine check): shown as installed, not suggested.
        const report = (await engine?.current().catch(() => null))?.report ?? [];
        const installed = [...new Set(report.filter((r) => r.variant).map((r) => r.id.split('-')[0]))];
        return c.html(await views.render('partials/engine-install', { plan: await plan(), pending, existing, installed, errors: {}, ...extra }));
    };

    routes.get('/', (c) => (['idle', 'canceled', 'done', 'added', 'failed'].includes(installer.state().phase) ? wizard(c) : progress(c)));
    routes.get('/progress', progress);

    routes.post('/', async (c) => {
        const body = await c.req.parseBody({ all: true });
        const families = [body.families ?? []].flat().map(String);
        const folder = String(body.folder ?? '').trim();
        const errors = {};
        if (!families.length) errors.families = 'Pick at least one model family.';
        const target = body.target === 'existing' ? 'existing' : 'new';
        const into = target === 'existing' ? launcher?.install() ?? null : null;
        if (!into && (!folder || !isAbsolute(folder))) errors.folder = 'Enter a full folder path, e.g. D:\\Bloop Studio\\engine';
        else if (!into && folder.length > MAX_FOLDER_CHARS) {
            errors.folder = `Pick a shorter folder (at most ${MAX_FOLDER_CHARS} characters): ComfyUI cannot start from a deeper one.`;
        }
        if (body.consent !== '1') errors.consent = 'Tick this to accept the model licenses.';
        const old = { families, folder, target };
        if (Object.keys(errors).length) return wizard(c, { errors, old });
        try {
            installer.start(await plan(), { folder, families, into });
        } catch (error) {
            return wizard(c, { errors: { folder: error.message }, old });
        }
        return progress(c);
    });

    routes.post('/cancel', async (c) => {
        installer.cancel();
        return progress(c);
    });

    return routes;
}

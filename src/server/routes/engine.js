// The engine (ComfyUI) status light, polled by HTMX from the top bar, with its Start / Stop switch
// for a ComfyUI found on this PC; and the engine profile (which workflow variant each family uses on
// this PC) and the launcher panel shown in Settings.
import { Hono } from 'hono';

export function engineRoutes({ views, comfy, engine, launcher, account, installer }) {
    const routes = new Hono();

    const light = async (c) => {
        const status = await comfy().status();
        // Cloud only: no engine answering, none on this PC to start, and bloop's models are there instead.
        const launch = launcher.state({ online: status.online });
        const cloudOnly = !status.online && !launch.available && Boolean(account?.signedIn);
        return c.html(await views.render('partials/engine-status', { status, launch, cloudOnly }));
    };

    routes.get('/status', light);

    routes.post('/start', async (c) => {
        try {
            launcher.start();
        } catch {
            // The light says why (no install found); nothing else to do here.
        }
        return light(c);
    });

    routes.post('/stop', async (c) => {
        launcher.stop();
        return light(c);
    });

    const panel = async (c, extra = {}) => {
        const status = await comfy().status();
        const install = installer?.state() ?? { phase: 'idle' };
        return c.html(await views.render('partials/engine-launcher', { status, launch: launcher.state({ online: status.online }), log: launcher.log(), install, ...extra }));
    };

    // Settings → Engine → ComfyUI on this PC.
    routes.get('/launcher', (c) => panel(c));
    routes.post('/launcher/find', (c) => {
        launcher.install({ refresh: true });
        return panel(c);
    });
    routes.post('/launcher/:action{start|stop}', async (c) => {
        try {
            if (c.req.param('action') === 'start') launcher.start();
            else launcher.stop();
        } catch (error) {
            return panel(c, { problem: error.message });
        }
        return panel(c);
    });
    // Give the GPU back (a game, another app) without stopping ComfyUI: it reloads models on the next render.
    routes.post('/free', async (c) => {
        try {
            await comfy().free();
            return panel(c, { freed: true });
        } catch (error) {
            return panel(c, { problem: `Could not free GPU memory: ${error.message}` });
        }
    });

    const profile = async (c, refresh) =>
        c.html(await views.render('partials/engine-profile', { profile: await engine.current({ refresh }) }));

    routes.get('/profile', (c) => profile(c, false));
    // After installing models or nodes in ComfyUI: look again instead of waiting for the cache.
    routes.post('/profile', (c) => profile(c, true));

    return routes;
}

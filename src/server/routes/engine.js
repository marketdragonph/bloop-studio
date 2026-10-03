// The engine (ComfyUI) status light, polled by HTMX from the top bar, and the engine profile
// (which workflow variant each family uses on this PC) shown in Settings.
import { Hono } from 'hono';

export function engineRoutes({ views, comfy, engine }) {
    const routes = new Hono();

    routes.get('/status', async (c) => {
        const status = await comfy().status();
        return c.html(await views.render('partials/engine-status', { status }));
    });

    const profile = async (c, refresh) =>
        c.html(await views.render('partials/engine-profile', { profile: await engine.current({ refresh }) }));

    routes.get('/profile', (c) => profile(c, false));
    // After installing models or nodes in ComfyUI: look again instead of waiting for the cache.
    routes.post('/profile', (c) => profile(c, true));

    return routes;
}

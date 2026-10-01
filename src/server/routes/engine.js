// The engine (ComfyUI) status light, polled by HTMX from the top bar.
import { Hono } from 'hono';

export function engineRoutes({ views, comfy }) {
    const routes = new Hono();

    routes.get('/status', async (c) => {
        const status = await comfy().status();
        return c.html(await views.render('partials/engine-status', { status }));
    });

    return routes;
}

import { Hono } from 'hono';

export function homeRoutes({ views, settings }) {
    const routes = new Hono();

    routes.get('/', async (c) => {
        return c.html(await views.render('pages/home', { settings: settings.all() }));
    });

    return routes;
}

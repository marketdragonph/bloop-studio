import { Hono } from 'hono';

// The app opens on the Spaces list (the Hangar page is retired for now).
export function homeRoutes() {
    const routes = new Hono();

    routes.get('/', (c) => c.redirect('/spaces'));

    return routes;
}

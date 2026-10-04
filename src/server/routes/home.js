import { Hono } from 'hono';

const RECENT_BOARDS = 4;

// The app opens on the launch screen (an optional bloop sign-in) until the person signs in or
// continues without an account; from then on it opens straight on the Spaces list.
export function homeRoutes({ views, settings, account, spaces }) {
    const routes = new Hono();

    routes.get('/', async (c) => {
        if (settings.get('launchSeen') || account?.signedIn) return c.redirect('/spaces');
        return c.html(await views.render('pages/launch', { recent: spaces.list().slice(0, RECENT_BOARDS) }));
    });

    // "Continue without an account", or "Open Bloop Studio" once signed in: never shown again.
    // A recent board passes `to`; only a board path is honored, never an outside address.
    routes.post('/launch/continue', async (c) => {
        settings.update({ launchSeen: true });
        const { to } = await c.req.parseBody();
        c.header('HX-Redirect', /^\/spaces\/\d+$/.test(String(to ?? '')) ? to : '/spaces');
        return c.body(null, 204);
    });

    return routes;
}

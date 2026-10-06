import { Hono } from 'hono';

const RECENT_BOARDS = 4;

// Signed out, the app opens on the launch screen (an optional bloop sign-in) every time; signed in,
// straight on the Spaces list.
export function homeRoutes({ views, account, spaces }) {
    const routes = new Hono();

    routes.get('/', async (c) => {
        if (account?.signedIn) return c.redirect('/spaces');
        return c.html(await views.render('pages/launch', { recent: spaces.list({ limit: RECENT_BOARDS }) }));
    });

    // "Continue without an account", or "Open Bloop Studio" once signed in.
    // A recent board passes `to`; only a board path is honored, never an outside address.
    routes.post('/launch/continue', async (c) => {
        const { to } = await c.req.parseBody();
        c.header('HX-Redirect', /^\/spaces\/\d+$/.test(String(to ?? '')) ? to : '/spaces');
        return c.body(null, 204);
    });

    return routes;
}

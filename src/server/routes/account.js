// Settings → Bloop account: sign in through the browser, see the plan and credits, sign out.
import { Hono } from 'hono';

export function accountRoutes({ views, account }) {
    const routes = new Hono();
    const panel = async (c, state) => c.html(await views.render('partials/bloop-account', state));

    routes.get('/', async (c) => panel(c, c.req.query('refresh') === '0' ? account.state() : await account.refresh()));

    routes.post('/sign-in', async (c) => {
        try {
            await account.startSignIn();
        } catch (error) {
            return panel(c, { status: 'signed-out', error: `Could not open the browser: ${error.message}` });
        }
        return panel(c, account.state());
    });

    routes.post('/cancel', async (c) => {
        account.cancelSignIn();
        return panel(c, account.state());
    });

    routes.delete('/', async (c) => {
        await account.signOut();
        return panel(c, account.state());
    });

    return routes;
}

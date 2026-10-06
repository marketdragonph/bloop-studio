// App updates: the top-bar "Restart to update" key and the version line in Settings.
// `updates` comes from the Electron main process (src/main/updater.js); the browser-only dev
// server and tests get a stub that never updates.
import { Hono } from 'hono';

export const NO_UPDATES = {
    state: () => ({ version: 'dev', status: 'dev', available: null, progress: 0, error: null }),
    check: async () => {},
    checkIfStale: () => {},
    install: () => {},
};

export function appUpdateRoutes({ views, updates }) {
    const routes = new Hono();
    const render = async (c, view) => c.html(await views.render(view, { update: updates.state() }));

    routes.get('/', (c) => render(c, 'partials/update-key'));
    // Opening Settings checks again when the last check is a few minutes old (the line then polls itself).
    routes.get('/about', (c) => {
        updates.checkIfStale?.();
        return render(c, 'partials/update-about');
    });

    // Answers at once with "Checking…"; the line then polls itself until the check or download settles.
    routes.post('/check', (c) => {
        updates.check();
        return render(c, 'partials/update-about');
    });

    // Only a downloaded update installs; the app quits, the installer runs, the new version opens.
    routes.post('/install', (c) => {
        if (updates.state().status !== 'ready') return c.json({ error: 'No update is ready yet.' }, 409);
        updates.install();
        return c.html('<span class="ae-readout">Restarting…</span>');
    });

    return routes;
}

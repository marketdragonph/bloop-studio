// Settings › Video tools (01-core.md §9): which ffmpeg was found, its version and licence line, the encoders in
// use, and the ways forward when it is missing: Check again, Choose ffmpeg.exe… (a file picker; the folder must
// hold ffmpeg.exe and ffprobe.exe and `-version` must answer), and back to the bundled copy. Every "video tools
// are missing" message links here. HTMX gets the `partials/video-tools` row; other callers get JSON.
// CSRF guards every mutation (the app-wide middleware).
import { Hono } from 'hono';

const FILTERS = [{ name: 'ffmpeg', extensions: ['exe'] }];

export function videoToolsRoutes({ videoTools, views, pickFile = async () => null }) {
    const routes = new Hono();

    const reply = async (c, tools, { checked = false, problem = null, status = 200 } = {}) => {
        if (c.req.header('HX-Request') && views) {
            return c.html(await views.render('partials/video-tools', { tools, checked, problem }), status);
        }
        return c.json({ tools, checked, ...(problem ? { error: problem } : {}) }, status);
    };

    routes.get('/', async (c) => reply(c, await videoTools.state()));

    // Check again.
    routes.post('/check', async (c) => reply(c, await videoTools.check(), { checked: true }));

    // Choose ffmpeg.exe…: {path} from a caller, else the app's file picker. Closing the picker changes nothing.
    routes.post('/choose', async (c) => {
        let path = null;
        if (!c.req.header('HX-Request')) {
            try {
                path = (await c.req.json())?.path ?? null;
            } catch { /* no body: open the picker */ }
        }
        path ??= await pickFile({ title: 'Choose ffmpeg.exe', filters: FILTERS });
        if (!path) return reply(c, await videoTools.state());
        const result = await videoTools.choose(path);
        if (!result.ok) return reply(c, await videoTools.state(), { problem: result.error, status: c.req.header('HX-Request') ? 200 : 422 });
        return reply(c, result.state, { checked: true });
    });

    // Back to the copy that came with Bloop Studio.
    routes.delete('/choose', async (c) => reply(c, await videoTools.reset(), { checked: true }));

    return routes;
}

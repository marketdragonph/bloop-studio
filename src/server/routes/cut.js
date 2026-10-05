// The Cut (Mini Katana) for the dock. P1 is read-only: GET /spaces/:id/cut returns the stored cut and what
// the board can put in it (BoardCut's slots and beds). Live changes ride the board's event stream as `cut`
// events (GET /spaces/:id/events). The dock never renders and never exports from here.
import { Hono } from 'hono';

const int = (value) => Number.parseInt(value, 10);

export function cutRoutes({ spaces, cuts, boardCut }) {
    const routes = new Hono();

    routes.get('/spaces/:id/cut', (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: 'That space no longer exists.' }, 404);
        const cut = cuts.current(spaceId);
        const read = boardCut.read(spaceId, { cut });
        return c.json({
            cut: {
                revision: cut.revision, items: cut.items, sound: cut.sound, settings: cut.settings,
                auto: cut.auto, can_undo_draft: Array.isArray(cut.previous_items), updated_by: cut.updated_by,
            },
            slots: read.slots,
            beds: read.beds,
            clock: read.clock,
            total_ms: read.clock.total_ms,
            gaps_ms: read.clock.gaps_ms,
            ducks: [], // P4: duck windows from cut-sound.js
            beats_ms: [], // P4: music beat ticks from the analysis
            findings: read.findings,
            guessed: read.guessed,
        });
    });

    return routes;
}

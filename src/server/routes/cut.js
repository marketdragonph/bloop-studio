// The Cut (Mini Katana) for the dock. GET reads the stored cut and what the board can put in it (BoardCut's slots
// and beds). PUT saves the whole cut with its revision (a stale one is a 409 carrying the server copy, which the
// dock adopts in the same step). POST …/draft builds a draft through CutDraft, the same service the Director's
// stitch_cut calls; DELETE …/draft is the one-step Undo draft. Every save sends a `cut` event on the board's stream
// (GET /spaces/:id/events). The dock never renders and never exports from here. CSRF guards every mutation.
import { Hono } from 'hono';
import { CutConflictError } from '../repositories/cuts.js';
import { CutEdits } from '../cut/cut-edits.js';
import { CutDraft } from '../cut/cut-draft.js';
import { CutInvalidError } from '../cut/validate-cut.js';

const int = (value) => Number.parseInt(value, 10);
const GONE = 'That space no longer exists.';
const CONFLICT = 'This cut changed in another window.';

/** The cut as the dock sees it (GET, PUT, the draft routes and every 409 use this one shape). */
export const cutView = (cut) => ({
    revision: cut.revision, items: cut.items, sound: cut.sound, settings: cut.settings,
    auto: cut.auto, can_undo_draft: Array.isArray(cut.previous_items), updated_by: cut.updated_by,
});

const body = async (c) => {
    try {
        const value = await c.req.json();
        return value && typeof value === 'object' ? value : null;
    } catch {
        return null;
    }
};
const isRevision = (value) => Number.isInteger(value) && value >= 0;

export function cutRoutes({ db, spaces, cuts, boardCut, events, cutEdits, cutDraft }) {
    const routes = new Hono();
    const edits = cutEdits ?? new CutEdits({ db, cuts, events });
    const drafts = cutDraft ?? new CutDraft({ boardCut, cuts, edits });

    /** 409 with the server copy, 422 with the rule's plain reason; anything else is a real error. */
    const refused = (c, error) => {
        if (error instanceof CutConflictError) return c.json({ error: CONFLICT, cut: cutView(error.cut) }, 409);
        if (error instanceof CutInvalidError) return c.json({ error: error.message }, 422);
        throw error;
    };

    routes.get('/spaces/:id/cut', (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: GONE }, 404);
        const cut = cuts.current(spaceId);
        const read = boardCut.read(spaceId, { cut });
        return c.json({
            cut: cutView(cut),
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

    // The whole cut, guarded by its revision: {revision, items, sound?, settings?} → 200 {cut} | 409 {error, cut}.
    routes.put('/spaces/:id/cut', async (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: GONE }, 404);
        const input = await body(c);
        if (!input) return c.json({ error: 'The cut could not be read.' }, 400);
        if (!isRevision(input.revision)) return c.json({ error: 'The save needs the cut\'s revision.' }, 422);
        try {
            const cut = edits.save(spaceId, { items: input.items, sound: input.sound, settings: input.settings, revision: input.revision, by: 'person' });
            return c.json({ cut: cutView(cut) });
        } catch (error) {
            return refused(c, error);
        }
    });

    // Fill the cut / Add new clips / Replace my cut: {mode, revision?} → 200 {drafted, reason, added, missing, offer, cut}.
    routes.post('/spaces/:id/cut/draft', async (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: GONE }, 404);
        const input = (await body(c)) ?? {};
        if (input.revision != null && !isRevision(input.revision)) return c.json({ error: 'The draft needs the cut\'s revision.' }, 422);
        try {
            const { cut, ...result } = drafts.draft(spaceId, { mode: input.mode, revision: input.revision ?? null, by: 'person' });
            return c.json({ ...result, cut: cutView(cut) });
        } catch (error) {
            return refused(c, error);
        }
    });

    // Undo draft (one step): {revision} → 200 {cut}; 422 when there is no draft to undo.
    routes.delete('/spaces/:id/cut/draft', async (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: GONE }, 404);
        const input = (await body(c)) ?? {};
        if (!isRevision(input.revision)) return c.json({ error: 'Undo needs the cut\'s revision.' }, 422);
        try {
            return c.json({ cut: cutView(drafts.undo(spaceId, { revision: input.revision })) });
        } catch (error) {
            return refused(c, error);
        }
    });

    return routes;
}

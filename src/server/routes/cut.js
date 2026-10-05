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
import { CutTurns } from '../cut/cut-turns.js';
import { CutTurnsRepository } from '../repositories/cut-turns.js';
import { checkCut, soundOnCut } from '../cut/cut-check.js';
import { captionPlan } from '../cut/captions-plan.js';
import { DirectorPlans } from '../repositories/director-plans.js';

const int = (value) => Number.parseInt(value, 10);
const GONE = 'That space no longer exists.';
const CONFLICT = 'This cut changed in another window.';

/** What the dock says about measuring: missing tools, files still measuring, all measured, or nothing to measure. */
export function analysisState(check, cut) {
    const pending = check.unmeasured.filter((m) => m.measuring).length;
    const state = check.toolsMissing ? 'missing' : pending ? 'measuring' : cut.items.length && !check.unmeasured.length ? 'done' : 'idle';
    return { state, pending, unmeasured: check.unmeasured, tools_missing: check.toolsMissing };
}

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

export function cutRoutes({ db, spaces, cuts, boardCut, events, cutEdits, cutDraft, cutTurns, analysis = null, plans }) {
    const routes = new Hono();
    const edits = cutEdits ?? new CutEdits({ db, cuts, events });
    const drafts = cutDraft ?? new CutDraft({ boardCut, cuts, edits });
    const turns = cutTurns ?? new CutTurns({ cuts, repo: new CutTurnsRepository(db ?? cuts.db), edits });
    const planRepo = plans ?? new DirectorPlans(db ?? cuts.db);
    // The words of each beat's script card ("s2-cup · script"), for the spoken lines the dock shows.
    const scriptsOf = (spaceId) => new Map((db ?? cuts.db).prepare("SELECT label, text_content FROM space_nodes WHERE space_id = ? AND type = 'text' AND label LIKE '%· script'").all(spaceId)
        .map((n) => [String(n.label).replace(/\s*·\s*script$/i, '').trim(), n.text_content]));

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
        // P4: the measured numbers the Director used, placed on the cut (duck windows, beat ticks, spoken lines),
        // the timed Check your cut findings, and the newest Director turn for the turn strip.
        const check = checkCut({ boardCut, plans: planRepo, analysis }, spaceId, cut);
        const read = check.read;
        const sound = soundOnCut(cut, check.analysisOf, read.beds, scriptsOf(spaceId));
        const captions = captionPlan({ db: db ?? cuts.db, analysis }, spaceId, cut);
        return c.json({
            cut: cutView(cut),
            slots: read.slots,
            beds: read.beds,
            clock: read.clock,
            total_ms: read.clock.total_ms,
            gaps_ms: read.clock.gaps_ms,
            ducks: sound.ducks, // [{from_ms, to_ms}] export time: under the voice bed and every measured line
            beats_ms: sound.beats_ms, // the bed's estimated beats on the cut (export time)
            downbeats_ms: sound.downbeats_ms,
            bpm: sound.bpm, // estimated
            speech: sound.speech, // [{item_id, from_ms, to_ms}] spoken lines in export time
            captions: { default_on: captions.default_on, why_off: captions.why_off }, // P6: Captions' default, and why it is off
            music_peaks: sound.music_peaks, // {bars, ms_per_bar, values 0..100} or null
            voice_peaks: sound.voice_peaks,
            analysis: analysisState(check, cut), // {state: idle | measuring | missing | done, pending, unmeasured, tools_missing}
            turn: turns.view(spaceId, cut.revision), // the newest Director turn (CutTurns.view), for the turn strip
            findings: check.findings,
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

    // Undo turn (one press for a whole Director turn, 03 §3): {turn, revision} → 200 {cut}; 409 when the cut moved
    // past `revision`; 422 when later edits came after that turn (it is no longer on top) or there is none.
    routes.post('/spaces/:id/cut/undo-turn', async (c) => {
        const spaceId = int(c.req.param('id'));
        if (!spaces.find(spaceId)) return c.json({ error: GONE }, 404);
        const input = (await body(c)) ?? {};
        if (!isRevision(input.revision)) return c.json({ error: 'Undo needs the cut\'s revision.' }, 422);
        if (input.turn != null && !Number.isInteger(input.turn)) return c.json({ error: 'Undo needs the turn it takes back.' }, 422);
        try {
            const cut = turns.undo(spaceId, { turn: input.turn ?? null, revision: input.revision, by: 'person' });
            return c.json({ cut: cutView(cut), turn: turns.view(spaceId, cut.revision) });
        } catch (error) {
            return refused(c, error);
        }
    });

    return routes;
}

// The Director as a background job (like the GPU worker for renders): a request starts a run and
// returns at once; the turn keeps going when the panel closes or the page reloads, and its text and
// board actions reach every open window of that board over the board's event stream.
// A turn that runs out of steps carries on by itself (no button to press), up to MAX_PARTS turns;
// a run the app was closed in the middle of resumes when the app starts again. One run per board.

export const CONTINUE_REQUEST = 'Continue where you stopped: finish the request, then check the board.';
const MAX_PARTS = 4; // 4 × 30 model rounds: a whole film board, with a ceiling on a runaway turn
const LONG_BUILD = 'The Director stopped after a very long build. Ask it to keep going if anything is still missing.';

export class DirectorBusyError extends Error {
    constructor() {
        super('The Director is still working on the last request. Stop it first, or wait.');
    }
}

export class DirectorRuns {
    constructor({ director, service, events }) {
        this.director = director;
        this.service = service;
        this.events = events;
        this.live = new Map(); // spaceId → { runId, request, text, actions, info, abort, done }
    }

    /** At startup: runs cut off by a closed app pick up where they stopped (or say why they cannot). */
    recover() {
        for (const spaceId of this.director.interruptRuns()) {
            if (this.service.resolveProvider().missing) {
                this.director.addLog(spaceId, 'notice', 'The app closed while the Director was working. Ask it to keep going to finish.');
                continue;
            }
            this.director.addLog(spaceId, 'notice', 'The app closed while the Director was working: it is picking up where it stopped.');
            this.start(spaceId, CONTINUE_REQUEST, { logRequest: false });
        }
    }

    /** The run in progress on a board, for a panel opened mid-turn (or null). */
    active(spaceId) {
        const run = this.live.get(spaceId);
        return run ? { runId: run.runId, request: run.request, text: run.text, actions: run.actions, info: run.info } : null;
    }

    /** Starts a run in the background; returns its id. Throws DirectorBusyError while one is going. */
    start(spaceId, request, { logRequest = true } = {}) {
        if (this.live.has(spaceId)) throw new DirectorBusyError();
        const runId = this.director.startRun(spaceId, request);
        const run = { runId, request: logRequest ? request : null, text: '', actions: [], info: null, abort: new AbortController() };
        this.live.set(spaceId, run);

        const emit = (event, data) => {
            if (event === 'text') run.text += data.delta;
            if (event === 'actions') run.actions.push(...data.actions);
            if (event === 'notice') run.info = data.message;
            this.events.director({ spaceId, runId, event, data });
        };
        run.done = this.#work(spaceId, request, run, emit, logRequest)
            .catch((error) => {
                console.error('director run failed:', error);
                emit('error', { message: `The Director failed: ${error.message}`, actions: run.actions });
                return 'failed';
            })
            .then((status) => this.director.finishRun(runId, status))
            .finally(() => this.live.delete(spaceId));
        return runId;
    }

    /** Turns until the request is done: out of steps is not the end, only a very long build is. */
    async #work(spaceId, request, run, emit, logRequest) {
        let outcome;
        for (let part = 0; part < MAX_PARTS; part++) {
            if (part) emit('text', { delta: '\n\n' }); // the next part reads on in the same reply
            const ask = part ? CONTINUE_REQUEST : request;
            outcome = await this.service.turn(spaceId, ask, emit, run.abort.signal, { logRequest: logRequest && !part });
            if (outcome.status !== 'done' || !outcome.exhausted) break;
        }
        if (outcome.status !== 'done') {
            emit('error', { message: outcome.error, actions: run.actions });
            return outcome.status;
        }
        const notice = outcome.notice ?? (outcome.exhausted ? LONG_BUILD : null);
        if (notice && !outcome.notice) this.director.addLog(spaceId, 'notice', notice);
        emit('done', { text: run.text, actions: run.actions, notice });
        return 'done';
    }

    /** Stops the board's run; the cards it already added stay. */
    stop(spaceId) {
        const run = this.live.get(spaceId);
        if (!run) return false;
        run.abort.abort();
        return true;
    }
}

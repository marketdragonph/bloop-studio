// The Director as a background job (like the GPU worker for renders): a request starts a run and
// returns at once; the turn keeps going when the panel closes or the page reloads, and its text and
// board actions reach every open window of that board over the board's event stream.
// One run per board at a time. A run the app was closed in the middle of is offered as Continue.

export const CONTINUE_REQUEST = 'Continue where you stopped: finish the request, then check the board.';

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

    /** At startup: runs cut off by a closed app become a notice with Continue. */
    recover() {
        for (const spaceId of this.director.interruptRuns()) {
            this.director.addLog(spaceId, 'notice', 'The app closed while the Director was working. Press Continue to pick up where it stopped.', [], { continuable: true });
        }
    }

    /** The run in progress on a board, for a panel opened mid-turn (or null). */
    active(spaceId) {
        const run = this.live.get(spaceId);
        return run ? { runId: run.runId, request: run.request, text: run.text, actions: run.actions, info: run.info } : null;
    }

    /** Starts a run in the background; returns its id. Throws DirectorBusyError while one is going. */
    start(spaceId, request) {
        if (this.live.has(spaceId)) throw new DirectorBusyError();
        const runId = this.director.startRun(spaceId, request);
        const run = { runId, request, text: '', actions: [], info: null, abort: new AbortController() };
        this.live.set(spaceId, run);

        const emit = (event, data) => {
            if (event === 'text') run.text += data.delta;
            if (event === 'actions') run.actions.push(...data.actions);
            if (event === 'notice') run.info = data.message;
            this.events.director({ spaceId, runId, event, data });
        };
        run.done = this.service.turn(spaceId, request, emit, run.abort.signal)
            .catch((error) => {
                console.error('director run failed:', error);
                emit('error', { message: `The Director failed: ${error.message}` });
                return 'failed';
            })
            .then((status) => this.director.finishRun(runId, status))
            .finally(() => this.live.delete(spaceId));
        return runId;
    }

    /** Stops the board's run; the cards it already added stay. */
    stop(spaceId) {
        const run = this.live.get(spaceId);
        if (!run) return false;
        run.abort.abort();
        return true;
    }
}

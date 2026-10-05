// In-process event bus: the job worker publishes card updates (and the Director its runs), the SSE route streams them.
import { EventEmitter } from 'node:events';

export class BoardEvents extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50); // one per open board window
    }

    /** A card changed: { spaceId, nodeId, status, progress?, label?, media_path?, media_mime?, error? }. */
    node(update) {
        this.emit('node', update);
    }

    /** The render queue changed: [{ id, nodeId, spaceId, status }] in run order, for every board. */
    queue(order) {
        this.emit('queue', order);
    }

    /** A Director run on a board said something: { spaceId, runId, event, data } (see director/runs.js). */
    director(update) {
        this.emit('director', update);
    }

    /** What the Cut can hold changed (a take landed or was measured, a card deleted): { spaceId, revision, by, added?, changed? }. */
    cut(update) {
        this.emit('cut', update);
    }

    /** An export or pack job moved: { spaceId, exportId, kind, status, progress, step, error?, error_beat?, media_path?, bytes?, nodeId?, node? }. */
    cutExport(update) {
        this.emit('cut_export', update);
    }
}

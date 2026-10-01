// In-process event bus: the job worker publishes card updates, the SSE route streams them.
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
}

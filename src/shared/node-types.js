// THE ONE SOURCE OF TRUTH for card types and what their sockets accept.
// Imported by the server (validation) and served to the browser (board UI) unchanged,
// so the two can never drift the way bloop's PHP and JS copies did.

export const NODE_TYPES = {
    upload: { label: 'Upload', icon: 'upload', tone: 'neutral', creatable: true },
    text: { label: 'Text', icon: 'text', tone: 'neutral', creatable: true },
    note: { label: 'Note', icon: 'note', tone: 'warn', creatable: true },
    image: { label: 'Image', icon: 'image', tone: 'accent', creatable: true, generates: 'image' },
    video: { label: 'Video', icon: 'video', tone: 'sensor', creatable: true, generates: 'video' },
};

/** Input sockets per type, top to bottom. `accepts` lists the kinds a wire may carry in. */
export const SOCKETS = {
    image: [
        { key: 'prompt', label: 'Words', accepts: ['text'], icon: 'text' },
        { key: 'reference', label: 'Picture', accepts: ['image'], icon: 'image' },
    ],
    video: [
        { key: 'prompt', label: 'Words', accepts: ['text'], icon: 'text' },
        { key: 'first_frame', label: 'First frame', accepts: ['image'], icon: 'image' },
    ],
};

/** Can this specific socket on `to` take what `from` offers? */
export function socketAccepts(from, to, socketKey) {
    const socket = socketsOf(to.type).find((s) => s.key === socketKey);
    return Boolean(socket && socket.accepts.some((kind) => sourceKinds(from).includes(kind)));
}

export const DEFAULT_WIDTH = 280;
export const MAX_NODES_PER_SPACE = 300;

export const isNodeType = (type) => Object.hasOwn(NODE_TYPES, type);
export const socketsOf = (type) => SOCKETS[type] ?? [];
export const canReceive = (type) => socketsOf(type).length > 0;

/**
 * What a card can put down a wire: what it holds, plus what its type promises
 * (an image card with nothing rendered yet still offers an image: the wire is the promise).
 */
export function sourceKinds(node) {
    const kinds = new Set();
    const mime = node.media_mime ?? '';
    if (node.type === 'text' || node.text_content) kinds.add('text');
    if (node.type === 'image' || mime.startsWith('image/')) kinds.add('image');
    if (node.type === 'video' || mime.startsWith('video/')) kinds.add('video');
    if (mime.startsWith('audio/')) kinds.add('audio');
    return [...kinds];
}

/** First socket on `to` that takes something `from` offers and is still free; -1 if none. */
export function pickSocket(from, to, taken = []) {
    const offered = sourceKinds(from);
    return socketsOf(to.type).findIndex(
        (socket) => !taken.includes(socket.key) && socket.accepts.some((kind) => offered.includes(kind)),
    );
}

/** Would wiring from → to close a loop? `edges` is [{from_node_id, to_node_id}]. */
export function wouldCycle(edges, fromId, toId) {
    const queue = [toId];
    const seen = new Set();
    while (queue.length) {
        const current = queue.shift();
        if (current === fromId) return true;
        if (seen.has(current)) continue;
        seen.add(current);
        for (const edge of edges) if (edge.from_node_id === current) queue.push(edge.to_node_id);
    }
    return false;
}

/**
 * Validates a new wire. Returns { ok: true, socket } or { ok: false, reason } in words a person reads.
 * `existing` is every connection on the board.
 */
export function checkConnection({ from, to, existing, socketKey = null }) {
    if (!from || !to) return { ok: false, reason: 'That card no longer exists.' };
    if (from.id === to.id) return { ok: false, reason: 'A card cannot feed itself.' };
    if (!canReceive(to.type)) return { ok: false, reason: `${NODE_TYPES[to.type]?.label ?? 'This'} cards do not take inputs.` };
    if (existing.some((c) => c.from_node_id === from.id && c.to_node_id === to.id)) {
        return { ok: false, reason: 'Those cards are already connected.' };
    }
    if (wouldCycle(existing, from.id, to.id)) return { ok: false, reason: 'That wire would make a loop.' };

    const taken = existing.filter((c) => c.to_node_id === to.id).map((c) => c.to_socket);

    // Dropped on a specific socket: it must accept the source and be free.
    if (socketKey) {
        const socket = socketsOf(to.type).find((s) => s.key === socketKey);
        if (!socket) return { ok: false, reason: 'That socket does not exist.' };
        if (!socketAccepts(from, to, socketKey)) return { ok: false, reason: `${socket.label} takes ${socket.accepts.join(' or ')}, not this card.` };
        if (taken.includes(socketKey)) return { ok: false, reason: `${socket.label} is already connected. Remove that wire first.` };
        return { ok: true, socket: socketKey };
    }

    const index = pickSocket(from, to, taken);
    if (index < 0) {
        const wants = socketsOf(to.type).map((s) => s.label.toLowerCase()).join(' or ');
        return { ok: false, reason: `This card takes ${wants}, and those inputs are full or do not match.` };
    }
    return { ok: true, socket: socketsOf(to.type)[index].key };
}

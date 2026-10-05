// The Space Director's board actions. Defined once, provider-neutral (JSON Schema + zod).
// Every call is validated with zod before it touches the board, and applied through the
// same repository rules a person's edits use. The Director never renders: ⚡ stays a person's press.
import { z } from 'zod';
import { ValidationError } from '../repositories/spaces.js';
import { socketsOf } from '../../shared/node-types.js';
import { ASPECTS } from '../../shared/formats.js';
import { auditBoard, auditText } from './audit.js';

const MAX_CARDS_PER_TURN = 60; // a 9-shot film (3 cards each) plus its cast and locations
// Plan first (as bloop's planFirst gate): on an empty board nobody has talked about yet, a few cards
// are fine (one shot, one note), a whole board is not: the Director pitches and asks first.
const UNPLANNED_CARDS = 3;
const CARD_TYPES = ['text', 'note', 'image', 'video', 'audio'];
const SOCKETS = ['prompt', 'reference', 'first_frame', 'last_frame', 'audio', 'lyrics'];
const ASPECT_IDS = ASPECTS.map((a) => a.id);

const AddCard = z.object({
    ref: z.string().min(1).max(40),
    type: z.enum(CARD_TYPES),
    text: z.string().max(4000).optional(),
    label: z.string().max(80).optional(),
    column: z.number().int().min(0).max(30).optional(),
    row: z.number().int().min(0).max(60).optional(),
}).strict();

const Connect = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    socket: z.enum(SOCKETS).optional(),
}).strict();

const UpdateCard = z.object({
    card: z.string().min(1),
    text: z.string().max(4000).optional(),
    label: z.string().max(80).optional(),
    aspect: z.enum(ASPECT_IDS).optional(),
    duration: z.number().int().min(2).max(180).optional(),
}).strict();

const InspectCards = z.object({ cards: z.array(z.string().min(1)).min(1).max(30) }).strict();
const AuditBoard = z.object({}).strict();

export const TOOL_DEFINITIONS = [
    {
        name: 'add_card',
        description: 'Add a card to the board. text cards hold a description (a shot, a character, an idea) that feeds wired Image/Video/Audio cards; note cards are comments for the person; image, video and audio cards render from what is wired into them when the person presses Generate (audio: music from a style, plus sung lyrics). Place cards on a grid with column (left to right, story order) and row.',
        schema: {
            type: 'object',
            properties: {
                ref: { type: 'string', description: 'Your own short name for this card in this turn, e.g. "shot1-still", so you can connect it.' },
                type: { type: 'string', enum: CARD_TYPES },
                text: { type: 'string', description: 'For text and note cards: the content.' },
                label: { type: 'string', description: 'Short title shown on the card.' },
                column: { type: 'integer', description: 'Grid column, 0 = leftmost.' },
                row: { type: 'integer', description: 'Grid row, 0 = top.' },
            },
            required: ['ref', 'type'],
            additionalProperties: false,
        },
        validator: AddCard,
    },
    {
        name: 'connect',
        description: 'Wire one card into another. Words ("prompt") takes any number of text cards: the shot text plus every cast and location card in it. Without socket, the first free socket that fits is used: text → Words, image → video first frame, a second image → last frame. Name the socket for anything else: "lyrics" (a text card into an audio card), "audio" (an audio card into a video card: lip sync), "reference" (an image into an image card). Use refs from this turn or ids of existing cards ("#12").',
        schema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Source card: a ref from this turn or "#<id>" of an existing card.' },
                to: { type: 'string', description: 'Target card: a ref from this turn or "#<id>".' },
                socket: { type: 'string', enum: SOCKETS, description: 'Optional target socket.' },
            },
            required: ['from', 'to'],
            additionalProperties: false,
        },
        validator: Connect,
    },
    {
        name: 'update_card',
        description: 'Change the text or label of an existing card, or the aspect / duration (seconds) of an image, video or audio card. Image, video and audio cards have no text of their own: change the text card wired into them.',
        schema: {
            type: 'object',
            properties: {
                card: { type: 'string', description: 'A ref from this turn or "#<id>" of an existing card.' },
                text: { type: 'string' },
                label: { type: 'string' },
                aspect: { type: 'string', enum: ASPECT_IDS },
                duration: { type: 'integer', description: 'Seconds: a video clip (3-10) or a song (15-180).' },
            },
            required: ['card'],
            additionalProperties: false,
        },
        validator: UpdateCard,
    },
    {
        name: 'inspect_cards',
        description: 'Read cards in full: whole text, settings, render state, and every wire in and out with its socket. Use it before rewriting cards or answering a complaint about them.',
        schema: {
            type: 'object',
            properties: { cards: { type: 'array', items: { type: 'string' }, description: 'Refs or "#<id>"s.' } },
            required: ['cards'],
            additionalProperties: false,
        },
        validator: InspectCards,
    },
    {
        name: 'audit_board',
        description: 'Check the whole board: cards with nothing in Words, characters or places named in a shot but not wired into it, unused text cards, failed renders. Fix what it finds.',
        schema: { type: 'object', properties: {}, additionalProperties: false },
        validator: AuditBoard,
    },
];

// A column fits one card plus its sockets; a row fits the tallest card (a video card with all its
// knobs is ~500 px), so the Director's layout never stacks cards on top of each other.
const GRID_X = 380;
const GRID_Y = 580;

/** Applies validated tool calls for one Director turn. Holds the ref → id map and the turn's actions. */
export class BoardActions {
    constructor({ spaces, spaceId, origin, planned = true }) {
        this.spaces = spaces;
        this.spaceId = spaceId;
        this.origin = origin; // board point where the turn's grid starts (right of existing cards)
        this.refs = new Map();
        this.actions = []; // [{ kind, ...ids }] for the client and for one-step undo
        this.cardsAdded = 0;
        this.touched = new Set(); // cards changed since the last board check
        this.planned = planned; // false: a new, empty board with no conversation yet
    }

    /** After a round of tool calls: the board check for what that round changed, or null. */
    afterRound() {
        if (!this.touched.size) return null;
        const only = [...this.touched];
        this.touched.clear();
        return auditText(auditBoard(this.spaces.board(this.spaceId), { only }));
    }

    /** Runs one tool call. Returns { ok, content } where content is the text sent back to the model. */
    run(name, input) {
        const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
        if (!tool) return { ok: false, content: `Unknown tool "${name}".` };
        const parsed = tool.validator.safeParse(input);
        if (!parsed.success) return { ok: false, content: JSON.stringify({ INVALID_INPUT: parsed.error.issues.map((i) => i.message) }) };

        try {
            return { ok: true, content: this[name.replace(/_(\w)/g, (_, c) => c.toUpperCase())](parsed.data) };
        } catch (error) {
            if (error instanceof ValidationError) return { ok: false, content: error.message };
            throw error;
        }
    }

    resolve(handle) {
        if (handle.startsWith('#')) {
            const node = this.spaces.findNode(this.spaceId, Number(handle.slice(1)));
            if (!node) throw new ValidationError(`There is no card ${handle} on this board.`);
            return node.id;
        }
        const id = this.refs.get(handle);
        if (!id) throw new ValidationError(`No card named "${handle}" was added in this turn.`);
        return id;
    }

    addCard({ ref, type, text, label, column = 0, row = 0 }) {
        if (!this.planned && this.cardsAdded >= UNPLANNED_CARDS) {
            throw new ValidationError('STOP: this is a new board and nothing is agreed yet. Do not add more cards. Reply with your plan (pitch, cast, places, numbered shots with seconds) and at most 2 questions, then wait for the answer.');
        }
        if (this.cardsAdded >= MAX_CARDS_PER_TURN) throw new ValidationError(`At most ${MAX_CARDS_PER_TURN} cards per turn; ask the person before adding more.`);
        if (this.refs.has(ref)) throw new ValidationError(`The ref "${ref}" is already used in this turn.`);
        const node = this.spaces.createNode(this.spaceId, {
            type,
            label: label ?? null,
            text_content: type === 'text' || type === 'note' ? text ?? '' : null,
            position_x: this.origin.x + column * GRID_X,
            position_y: this.origin.y + row * GRID_Y,
        });
        this.refs.set(ref, node.id);
        this.cardsAdded++;
        this.touched.add(node.id);
        this.actions.push({ kind: 'card', nodeId: node.id });
        return `Added ${type} card #${node.id} (ref ${ref}).`;
    }

    connect({ from, to, socket }) {
        const toId = this.resolve(to);
        if (socket && !socketsOf(this.spaces.findNode(this.spaceId, toId)?.type).some((s) => s.key === socket)) {
            throw new ValidationError(`${to} has no "${socket}" socket.`);
        }
        const wire = this.spaces.connect(this.spaceId, this.resolve(from), toId, socket ?? null);
        this.actions.push({ kind: 'wire', connectionId: wire.id });
        this.touched.add(toId);
        return `Connected ${from} → ${to} (${wire.to_socket} socket).`;
    }

    updateCard({ card, text, label, aspect, duration }) {
        const id = this.resolve(card);
        const before = this.spaces.findNode(this.spaceId, id);
        const changes = {};
        if (text !== undefined) changes.text_content = text;
        if (label !== undefined) changes.label = label;
        const settings = Object.fromEntries(Object.entries({ aspect, duration }).filter(([, v]) => v !== undefined));
        if (Object.keys(settings).length) {
            if (!['image', 'video', 'audio'].includes(before.type)) throw new ValidationError(`${card} is a ${before.type} card: only image, video and audio cards have an aspect or duration.`);
            changes.settings = settings;
        }
        this.spaces.updateNode(this.spaceId, id, changes);
        this.actions.push({ kind: 'update', nodeId: id, before: { text_content: before.text_content, label: before.label, settings: before.settings } });
        this.touched.add(id);
        return `Updated card #${id}.`;
    }

    inspectCards({ cards }) {
        const { nodes, connections } = this.spaces.board(this.spaceId);
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const name = (id) => `#${id}${byId.get(id)?.label ? ` "${byId.get(id).label}"` : ''}`;
        return cards.map((handle) => {
            const node = byId.get(this.resolve(handle));
            const ins = connections.filter((c) => c.to_node_id === node.id).map((c) => `${name(c.from_node_id)} → ${c.to_socket}`);
            const outs = connections.filter((c) => c.from_node_id === node.id).map((c) => `${c.to_socket} of ${name(c.to_node_id)}`);
            return [
                `#${node.id} ${node.type}${node.label ? ` "${node.label}"` : ''} · ${stateOf(node)}`,
                node.text_content ? `text: ${node.text_content}` : null,
                Object.keys(node.settings ?? {}).length ? `settings: ${JSON.stringify(node.settings)}` : null,
                `wired in: ${ins.join(', ') || 'nothing'}`,
                `feeds: ${outs.join(', ') || 'nothing'}`,
            ].filter(Boolean).join('\n');
        }).join('\n\n');
    }

    auditBoard() {
        this.touched.clear();
        return auditText(auditBoard(this.spaces.board(this.spaceId)));
    }
}

/** A card's render state in words: what the snapshot and inspect_cards tell the model. */
export function stateOf(node) {
    if (!['image', 'video', 'audio'].includes(node.type)) return 'words';
    if (node.status === 'failed') return 'failed';
    if (node.status === 'queued' || node.status === 'generating') return 'rendering now';
    return node.media_path ? 'rendered' : 'not rendered yet';
}

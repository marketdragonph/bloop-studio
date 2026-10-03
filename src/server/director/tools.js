// The Space Director's board actions. Defined once, provider-neutral (JSON Schema + zod).
// Every call is validated with zod before it touches the board, and applied through the
// same repository rules a person's edits use. The Director never renders: ⚡ stays a person's press.
import { z } from 'zod';
import { ValidationError } from '../repositories/spaces.js';

const MAX_CARDS_PER_TURN = 60; // a 9-shot film (3 cards each) plus its cast and locations
const CARD_TYPES = ['text', 'note', 'image', 'video'];

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
}).strict();

const UpdateCard = z.object({
    card: z.string().min(1),
    text: z.string().max(4000).optional(),
    label: z.string().max(80).optional(),
}).strict();

export const TOOL_DEFINITIONS = [
    {
        name: 'add_card',
        description: 'Add a card to the board. text cards hold a description (a shot, a character, an idea) that feeds wired Image/Video cards; note cards are comments for the person; image and video cards render from what is wired into them when the person presses Generate. Place cards on a grid with column (left to right, story order) and row.',
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
        description: 'Wire one card into another: a text card into an image or video card (its words), or an image card into a video card (its first frame; a second image card becomes its last frame). Use refs from this turn or ids of existing cards ("#12").',
        schema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Source card: a ref from this turn or "#<id>" of an existing card.' },
                to: { type: 'string', description: 'Target card: a ref from this turn or "#<id>".' },
            },
            required: ['from', 'to'],
            additionalProperties: false,
        },
        validator: Connect,
    },
    {
        name: 'update_card',
        description: 'Change the text or label of an existing card. Image and video cards have no text of their own: change the text card wired into them.',
        schema: {
            type: 'object',
            properties: {
                card: { type: 'string', description: 'A ref from this turn or "#<id>" of an existing card.' },
                text: { type: 'string' },
                label: { type: 'string' },
            },
            required: ['card'],
            additionalProperties: false,
        },
        validator: UpdateCard,
    },
];

// A column fits one card plus its sockets; a row fits the tallest card (a video card with all its
// knobs is ~500 px), so the Director's layout never stacks cards on top of each other.
const GRID_X = 380;
const GRID_Y = 580;

/** Applies validated tool calls for one Director turn. Holds the ref → id map and the turn's actions. */
export class BoardActions {
    constructor({ spaces, spaceId, origin }) {
        this.spaces = spaces;
        this.spaceId = spaceId;
        this.origin = origin; // board point where the turn's grid starts (right of existing cards)
        this.refs = new Map();
        this.actions = []; // [{ kind, ...ids }] for the client and for one-step undo
        this.cardsAdded = 0;
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
        this.actions.push({ kind: 'card', nodeId: node.id });
        return `Added ${type} card #${node.id} (ref ${ref}).`;
    }

    connect({ from, to }) {
        const wire = this.spaces.connect(this.spaceId, this.resolve(from), this.resolve(to));
        this.actions.push({ kind: 'wire', connectionId: wire.id });
        return `Connected ${from} → ${to} (${wire.to_socket} socket).`;
    }

    updateCard({ card, text, label }) {
        const id = this.resolve(card);
        const changes = {};
        if (text !== undefined) changes.text_content = text;
        if (label !== undefined) changes.label = label;
        const before = this.spaces.findNode(this.spaceId, id);
        this.spaces.updateNode(this.spaceId, id, changes);
        this.actions.push({ kind: 'update', nodeId: id, before: { text_content: before.text_content, label: before.label } });
        return `Updated card #${id}.`;
    }
}

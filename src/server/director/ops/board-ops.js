// BoardOps (ported from bloop): the one way the Director changes a board. An op list is validated whole, then
// applied in order inside one transaction — all of it or none of it. Refs name cards made in this list,
// `@id` names cards already there; lane and stage are turned into coordinates here, never by the model.
import { transaction } from '../../db/database.js';
import { ValidationError } from '../../repositories/spaces.js';
import { MAX_NODES_PER_SPACE } from '../../../shared/node-types.js';
import { problemsWith, refusedText } from './validate.js';
import { compactSlots, freeOrigin, lanePitch, place } from './layout.js';

export class BoardOpsRejected extends Error {
    constructor(reasons) {
        super(reasons.join(' '));
        this.reasons = reasons;
    }

    forModel() {
        return refusedText(this.reasons);
    }
}

/** A text card's words go in text_content; a picture, clip or audio card keeps none of its own. */
const settingsOf = (op) => {
    const s = {};
    if (op.aspect_ratio !== undefined) s.aspect = op.aspect_ratio;
    if (op.duration !== undefined) s.duration = Number(op.duration);
    if (op.settings) Object.assign(s, op.settings); // set by the build itself (the clip's model family), never by the model
    return s;
};

export class BoardOps {
    constructor({ spaces }) {
        this.spaces = spaces;
    }

    /**
     * Applies an op list to a board. `origin` pins where a plan's lanes start (so rail and beats line up);
     * `aspect` sizes the lanes. Returns { nodes, connections, updated, refs, title, actions } or throws BoardOpsRejected.
     */
    apply(spaceId, ops, { origin = null, aspect = null } = {}) {
        const reasons = problemsWith(ops);
        if (reasons.length) throw new BoardOpsRejected(reasons);
        const board = this.spaces.board(spaceId);
        const adding = ops.filter((o) => o.op === 'note' || o.op === 'node').length;
        if (board.nodes.length + adding > MAX_NODES_PER_SPACE) {
            throw new BoardOpsRejected([`That would put ${adding} cards on a board that already has ${board.nodes.length}, over the ${MAX_NODES_PER_SPACE} limit. Ask the person what to drop, or plan fewer lanes.`]);
        }
        const pitch = lanePitch(aspect);
        const { start, slotOf } = this.#layout(board, ops, origin, pitch);

        return transaction(this.spaces.db, () => {
            const applied = { nodes: [], connections: [], updated: [], refs: {}, title: null, actions: [] };
            const problems = [];
            const resolve = (handle, n) => {
                if (handle.startsWith('@')) {
                    const node = this.spaces.findNode(spaceId, Number(handle.slice(1)));
                    if (!node) problems.push(`op ${n}: \`${handle}\` is not a node on this board.`);
                    return node?.id ?? null;
                }
                return applied.refs[handle] ?? null;
            };

            ops.forEach((op, i) => {
                const n = i + 1;
                try {
                    if (op.op === 'title') {
                        this.spaces.rename(spaceId, String(op.text).trim().slice(0, 120));
                        applied.title = String(op.text).trim().slice(0, 120);
                    } else if (op.op === 'note' || op.op === 'node') {
                        const type = op.op === 'note' ? 'text' : op.type;
                        const { lane, stage } = slotOf(op);
                        const at = place(start, lane, stage, pitch);
                        const worded = type === 'text' || type === 'note';
                        let node = this.spaces.createNode(spaceId, {
                            type,
                            label: String(op.title ?? op.label ?? '').trim().slice(0, 120) || null,
                            text_content: worded ? String(op.body ?? '') : null,
                            position_x: at.x,
                            position_y: at.y,
                        });
                        const settings = settingsOf(op);
                        if (Object.keys(settings).length && !worded) node = this.spaces.updateNode(spaceId, node.id, { settings });
                        applied.refs[op.ref] = node.id;
                        applied.nodes.push(node);
                        applied.actions.push({ kind: 'card', nodeId: node.id });
                    } else if (op.op === 'wire') {
                        const from = resolve(op.from, n);
                        const to = resolve(op.to, n);
                        if (!from || !to) return;
                        const wire = this.spaces.connect(spaceId, from, to, op.socket ?? null);
                        applied.connections.push(wire);
                        applied.actions.push({ kind: 'wire', connectionId: wire.id });
                    } else if (op.op === 'update') {
                        const id = resolve(op.node, n);
                        if (!id) return;
                        const before = this.spaces.findNode(spaceId, id);
                        const changes = {};
                        if (op.body !== undefined) {
                            if (!['text', 'note'].includes(before.type)) return problems.push(`op ${n}: ${op.node} is a ${before.type} card and has no words of its own — update the text card wired into it.`);
                            changes.text_content = op.body;
                        }
                        if (op.label !== undefined) changes.label = op.label.slice(0, 120);
                        const settings = settingsOf(op);
                        if (Object.keys(settings).length) {
                            if (!['image', 'video', 'audio'].includes(before.type)) return problems.push(`op ${n}: ${op.node} is a ${before.type} card: only picture, clip and audio cards have an aspect or a duration.`);
                            changes.settings = settings;
                        }
                        applied.updated.push(this.spaces.updateNode(spaceId, id, changes));
                        applied.actions.push({ kind: 'update', nodeId: id, before: { text_content: before.text_content, label: before.label, settings: before.settings } });
                    }
                } catch (error) {
                    if (!(error instanceof ValidationError)) throw error;
                    problems.push(`op ${n}: ${error.message}`);
                }
            });
            if (problems.length) throw new BoardOpsRejected(problems); // rolls the whole list back
            return applied;
        });
    }

    /**
     * A plan pins its origin, so its lanes line up with the rail. A free turn's cards start at lane 1, stage 1,
     * beside the cards they wire to (else the newest card), on clear board.
     */
    #layout(board, ops, origin, pitch) {
        if (origin) return { start: origin, slotOf: (op) => ({ lane: op.lane, stage: op.stage ?? 1 }) };
        const cards = ops.filter((o) => o.op === 'note' || o.op === 'node');
        const slots = compactSlots(cards);
        const wired = new Set(ops.filter((o) => o.op === 'wire').flatMap((o) => [o.from, o.to]).filter((h) => String(h).startsWith('@')).map((h) => Number(String(h).slice(1))));
        const anchors = board.nodes.filter((n) => wired.has(n.id));
        return { start: freeOrigin(board.nodes, anchors, [...slots.values()], pitch), slotOf: (op) => slots.get(op) };
    }
}

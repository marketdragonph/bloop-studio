// The board skills, ported from bloop: propose_board_ops (the one general writer, with the plan-first gate and the
// critic), inspect_board and audit_board (read only). Descriptions and tool-result texts are bloop's.
import { BoardOpsRejected } from '../ops/board-ops.js';
import { NODE_TYPES, OPS, SOCKETS } from '../ops/validate.js';
import { auditBoard, auditText } from '../audit.js';
import { socketsOf } from '../../../shared/node-types.js';
import { stateOf } from '../card-state.js';
import { checkCut } from '../../cut/cut-check.js';
import { cutSectionText } from '../cut/audit-cut.js';

const PLAN_FIRST_STOP = 'STOP — do not build this yet. This board is empty and nobody has said what the work is for. Call plan_board instead: say how you would approach it, ask AT MOST TWO questions whose answers would change what you build, and say plainly what you are assuming. Nothing has been put on the board and nothing is wrong — you are one step early. Build it in the turn after they answer.';

export const proposeBoardOps = {
    name: 'propose_board_ops',
    description: 'Put work on the canvas: create notes and cards, wire them together, or change a card that is already there. Use this whenever the person asks for something to be built, planned, added, extended, tightened or reshaped on the board — "plan a six-shot spot", "add a clip after that still", "make shot 3 vertical", "write me three post concepts". Everything for the turn goes in ONE call, applied in order, all of it or none of it. It creates cards only — it never renders. "Generate" and "let\'s generate" mean THIS on a small board: making the cards, not rendering them.',
    schema: {
        type: 'object',
        properties: {
            ops: {
                type: 'array',
                description: 'The operations, in the order they apply.',
                items: {
                    type: 'object',
                    properties: {
                        op: { type: 'string', enum: OPS, description: 'note = a written brief (a text card); node = a picture, clip, audio or sticky note card; wire = connect two; update = change one that exists; title = rename the board itself.' },
                        ref: { type: 'string', description: 'kebab-case handle for a card you are creating, unique in this turn.' },
                        type: { type: 'string', enum: NODE_TYPES, description: 'On `node`: the card type.' },
                        title: { type: 'string', description: 'On `note`: what the note is called.' },
                        body: { type: 'string', description: 'On `note`: the written brief itself. On `update`: the new words of a text card.' },
                        text: { type: 'string', description: 'On `title`: the board\'s new name, at most 120 characters.' },
                        label: { type: 'string', description: 'The card\'s short name.' },
                        aspect_ratio: { type: 'string', description: 'Only when the shape matters, e.g. 16:9 or 9:16.' },
                        duration: { type: 'integer', description: 'On a clip or a song: seconds, only when the length matters.' },
                        lane: { type: 'integer', description: 'The row: one per beat, shot or post. 1 is the top row.' },
                        stage: { type: 'integer', description: 'The column: where in the pipeline, left to right.' },
                        from: { type: 'string', description: 'On `wire`: a ref from this turn, or @<id>.' },
                        to: { type: 'string', description: 'On `wire`: a ref from this turn, or @<id>.' },
                        socket: { type: 'string', enum: SOCKETS, description: 'On `wire`, only for anything but Words: lyrics, first_frame, last_frame, audio, reference.' },
                        node: { type: 'string', description: 'On `update`: @<id> of the card to change.' },
                    },
                    required: ['op'],
                },
            },
        },
        required: ['ops'],
    },

    run({ ops }, t) {
        const board = t.spaces.board(t.spaceId);
        // planFirst (bloop): two or more new lanes on an empty, unplanned board is a piece of work nobody has talked about.
        const lanes = new Set((ops ?? []).filter((o) => o?.op === 'note' || o?.op === 'node').map((o) => o.lane ?? 1));
        const directed = board.nodes.some((n) => n.text_content?.trim());
        if (lanes.size >= 2 && !t.plans.latest(t.spaceId) && !directed) return { ok: false, content: PLAN_FIRST_STOP };

        let applied;
        try {
            applied = t.ops.apply(t.spaceId, ops, { aspect: t.plans.latest(t.spaceId)?.aspect });
        } catch (error) {
            if (!(error instanceof BoardOpsRejected)) throw error;
            t.ledger.refused();
            return { ok: false, content: error.forModel() };
        }
        t.ledger.record(applied);
        t.emit('actions', { actions: applied.actions });
        if (applied.title) t.emit('renamed', { title: applied.title });
        let content = `Done — ${applied.nodes.length} cards, ${applied.connections.length} wires, ${applied.updated.length} changed. It is on the board already: say what you built in a sentence or two, do not list every card, and do not repeat the prompts. Nothing has rendered.`;
        if (t.ledger.claimAudit()) {
            const touched = [...applied.nodes.map((n) => n.id), ...applied.updated.map((n) => n.id)];
            const check = auditText(auditBoard(t.spaces.board(t.spaceId), { only: touched }), { ownWork: true });
            if (check) content += `\n\n${check}`;
        }
        return { ok: true, content };
    },
};

export const inspectBoard = {
    name: 'inspect_board',
    description: 'Read named cards on the board IN FULL — their whole text, their settings, and exactly what is wired into and out of them. The board listing in your instructions is a summary with the text cut short, so use this before you change, tighten, shorten, translate, extend or comment on a card that already exists, and before you answer a question about what a specific card says. It reads only — it changes nothing.',
    schema: {
        type: 'object',
        properties: { nodes: { type: 'array', description: 'The cards to read, as `@42` handles from the board listing.', items: { type: 'string' } } },
        required: ['nodes'],
    },

    run({ nodes }, t) {
        const ids = [...new Set((nodes ?? []).map((h) => Number(String(h).replace(/^@/, ''))).filter((n) => n > 0))].slice(0, 12);
        if (!ids.length) return { ok: false, content: 'No card was named. Address cards as `@42`, using the ids from the board listing in your instructions — never an id you invented.' };
        const board = t.spaces.board(t.spaceId);
        const byId = new Map(board.nodes.map((n) => [n.id, n]));
        const found = ids.filter((id) => byId.has(id));
        if (!found.length) return { ok: false, content: `None of those are on this board: ${ids.map((i) => `@${i}`).join(', ')}. Check the board listing and try the ids that are actually there.` };
        const blocks = found.map((id) => {
            const n = byId.get(id);
            const fed = board.connections.filter((c) => c.to_node_id === id).map((c) => `@${c.from_node_id}${c.to_socket !== 'prompt' ? ` (${c.to_socket})` : ''}`);
            const feeds = board.connections.filter((c) => c.from_node_id === id).map((c) => `@${c.to_node_id}${c.to_socket !== 'prompt' ? ` (${c.to_socket})` : ''}`);
            const settings = Object.entries(n.settings ?? {}).filter(([k]) => !['seed', 'seedLocked'].includes(k)).map(([k, v]) => `${k}=${v}`);
            const takes = socketsOf(n.type).map((s) => s.label);
            return [
                `@${id} — ${n.type}${n.label ? ` "${n.label}"` : ''}`,
                n.text_content ? `TEXT (in full): ${n.text_content}` : null,
                settings.length ? `SETTINGS: ${settings.join(' ')}` : null,
                `FED BY: ${fed.join(' ') || 'nothing'}`,
                `FEEDS: ${feeds.join(' ') || 'nothing'}`,
                `ITS SOCKETS TAKE: ${takes.join(', ') || 'nothing — it is an end card'}`,
                ['image', 'video', 'audio'].includes(n.type) ? `STATE: ${stateOf(n)}` : null,
            ].filter(Boolean).join('\n');
        });
        const missing = ids.filter((id) => !byId.has(id));
        return { ok: true, content: `${blocks.join('\n\n')}${missing.length ? `\n\nNOT ON THIS BOARD: ${missing.map((i) => `@${i}`).join(' ')}` : ''}\n\nNow do what they asked. Nothing has changed yet.` };
    },
};

/** audit_board's THE CUT (03 §6): the whole cut's findings, whenever the board has a cut with clips. */
function cutSection(t) {
    const cut = t.cut?.cuts.current(t.spaceId);
    if (!cut?.items.length) return null;
    const c = t.cut;
    return cutSectionText(checkCut({ boardCut: c.boardCut, plans: c.plans, analysis: c.analysis }, t.spaceId, cut).findings);
}

export const auditBoardSkill = {
    name: 'audit_board',
    description: 'Check the whole board for real problems and get them back as a list: cards with nothing wired in, notes wired to nothing, people and places named in a shot but not wired into it, renders that failed. Use it whenever someone asks why something is not working, why a card looks wrong, whether the board is finished or ready, or asks you to check, review or tidy what is there. It reads only — it changes nothing.',
    schema: { type: 'object', properties: {} },

    run(_input, t) {
        const plan = t.plans.latest(t.spaceId);
        const beats = plan ? t.plans.beats(plan.id) : [];
        const progress = beats.length ? { beats: beats.length, built: beats.filter((b) => b.state === 'written').length, failed: beats.filter((b) => b.state === 'failed').length } : null;
        const board = auditText(auditBoard(t.spaces.board(t.spaceId), { plan: progress }), { ownWork: false });
        const text = [board, cutSection(t)].filter(Boolean).join('\n\n') || null;
        if (!text) return { ok: true, content: 'Nothing is wrong with the board: every card has something to render from, every note feeds something, and nothing has failed. Say so in a sentence.' };
        return { ok: true, content: `You are wearing the script supervisor's hat for this answer: report what is actually on the board, plainly, and do not soften it.\n\n${text}` };
    },
};

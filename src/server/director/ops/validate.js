// BoardOpsValidator (ported from bloop): every reason an op list would be refused, collected before anything is
// applied, in words the model can act on. The wording follows bloop's; the card types are Bloop Studio's.
import { ASPECTS } from '../../../shared/formats.js';

export const OPS = ['note', 'node', 'wire', 'update', 'title'];
export const NODE_TYPES = ['image', 'video', 'audio', 'note'];
export const SOCKETS = ['prompt', 'reference', 'first_frame', 'last_frame', 'audio', 'lyrics'];
const UPDATABLE = ['body', 'label', 'aspect_ratio', 'duration'];
const FORBIDDEN = ['x', 'y', 'position_x', 'position_y', 'left', 'top', 'width', 'height', 'position', 'coords'];
const MAX_OPS = 60;
const REF = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ASPECT_IDS = ASPECTS.map((a) => a.id);

const isHandle = (v) => typeof v === 'string' && /^@\d+$/.test(v.trim());

/** Every problem with an op list, or [] when it can be applied. `refs` are the refs created earlier in it. */
export function problemsWith(ops) {
    if (!Array.isArray(ops) || !ops.length) return ['`ops` must be a non-empty list of operations.'];
    if (ops.length > MAX_OPS) return [`Too many operations (${ops.length}) — the limit is ${MAX_OPS} in one turn. Send the rest next turn.`];
    const reasons = [];
    const refs = new Set();
    let titles = 0;
    ops.forEach((op, i) => {
        const n = i + 1;
        if (!op || typeof op !== 'object' || Array.isArray(op)) return reasons.push(`op ${n} is not an object.`);
        if (!op.op) return reasons.push(`op ${n} has no \`op\`. Every operation names one of: ${OPS.join(', ')}.`);
        if (!OPS.includes(op.op)) return reasons.push(`op ${n}: there is no \`${op.op}\` operation. Use one of: ${OPS.join(', ')}.`);
        const geometry = FORBIDDEN.filter((k) => k in op);
        if (geometry.length) reasons.push(`op ${n} sets ${geometry.join(', ')} — the canvas owns layout, not you. Say which \`lane\` (the row, one per beat) and \`stage\` (the column, where in the pipeline) instead, and the board places it.`);

        if (op.op === 'note' || op.op === 'node') {
            if (op.lane === undefined) reasons.push(`op ${n} has no \`lane\` — every card you make needs the row it belongs to, or it lands at the bottom of the board where nobody is looking. \`lane\` is the row, one per beat; adding a card to a beat that already exists means the same lane as that beat's other cards, which the board listing shows you.`);
            else if (!Number.isInteger(op.lane) || op.lane < 1 || op.lane > 80) reasons.push(`op ${n}: \`lane\` is a whole number from 1 to 80. 1 is the top row.`);
            if (op.stage !== undefined && (!Number.isInteger(op.stage) || op.stage < 1 || op.stage > 20)) reasons.push(`op ${n}: \`stage\` is a whole number from 1 to 20.`);
            if (op.ref === undefined || !REF.test(String(op.ref)) || String(op.ref).length > 48) reasons.push(`op ${n}: \`ref\` must be a short kebab-case handle like \`s1-still\` — it is how you wire this node up later.`);
            else if (refs.has(op.ref)) reasons.push(`op ${n}: \`${op.ref}\` is already used earlier in this turn. Refs must be unique.`);
            else refs.add(op.ref);
        }
        if (op.op === 'note' && !String(op.body ?? '').trim()) reasons.push(`op ${n}: a note needs a \`body\` — that is the text downstream cards read.`);
        if (op.op === 'node') {
            if (!op.type) reasons.push(`op ${n} has no \`type\`.`);
            else if (!NODE_TYPES.includes(op.type)) reasons.push(`op ${n}: you cannot create a \`${op.type}\` node. The types you can make are: ${NODE_TYPES.join(', ')} (a text card is a \`note\` op).`);
            if (op.prompt !== undefined && op.type !== 'note') reasons.push(`op ${n}: a \`${op.type}\` card is told what to render by a text card WIRED INTO IT, not by its own \`prompt\` — nothing on the canvas shows that field, so the person could never read or edit it. Send the words as a \`note\` and wire it in.`);
            if (op.type === 'note' && !String(op.body ?? '').trim()) reasons.push(`op ${n}: a \`note\` card needs a \`body\` — that is the comment on it.`);
        }
        if (op.op === 'node' || op.op === 'update') reasons.push(...knobProblems(op, n));
        if (op.op === 'wire') {
            for (const end of ['from', 'to']) {
                const v = op[end];
                if (typeof v !== 'string' || !v.trim()) reasons.push(`op ${n}: \`${end}\` must be a ref from this turn or \`@<id>\` of a node already on the board.`);
                else if (v.startsWith('@') && !isHandle(v)) reasons.push(`op ${n}: \`${v}\` is not a node id. Existing nodes are addressed as \`@42\`.`);
                else if (!v.startsWith('@') && !refs.has(v)) reasons.push(`op ${n}: nothing in this turn is called \`${v}\`. Wire a ref you created above, or \`@<id>\` for a node already on the board.`);
            }
            if (op.socket !== undefined && !SOCKETS.includes(op.socket)) reasons.push(`op ${n}: \`socket\` is a connector name: ${SOCKETS.join(', ')}.`);
        }
        if (op.op === 'update') {
            if (!isHandle(op.node)) reasons.push(`op ${n}: \`update\` addresses a node already on the board, as \`@42\`. To make a new one, use \`note\` or \`node\`.`);
            if (!UPDATABLE.some((k) => op[k] !== undefined)) reasons.push(`op ${n}: nothing to change. An update sets one of: ${UPDATABLE.join(', ')}.`);
            for (const k of ['body', 'label']) if (op[k] !== undefined && typeof op[k] !== 'string') reasons.push(`op ${n}: \`${k}\` must be text.`);
            if (op.prompt !== undefined) reasons.push(`op ${n}: \`prompt\` is not on any card here — update the text card wired into it (its \`body\`).`);
        }
        if (op.op === 'title') {
            titles += 1;
            if (!String(op.text ?? '').trim()) reasons.push(`op ${n}: a \`title\` op needs \`text\` — the board's new name.`);
            else if (String(op.text).length > 120) reasons.push(`op ${n}: a board title is at most 120 characters. It sits in the header, so it has to be a name rather than a sentence.`);
            if (titles > 1) reasons.push(`op ${n}: the board can only be renamed once in a turn.`);
        }
    });
    return reasons;
}

function knobProblems(op, n) {
    const reasons = [];
    if (op.aspect_ratio !== undefined && !ASPECT_IDS.includes(op.aspect_ratio)) reasons.push(`op ${n}: \`aspect_ratio\` is one of ${ASPECT_IDS.join(', ')} — not \`${op.aspect_ratio}\`.`);
    if (op.duration !== undefined) {
        const s = Number(op.duration);
        if (!Number.isInteger(s) || s < 2 || s > 180) reasons.push(`op ${n}: \`duration\` is whole seconds — a clip 3 to 10, a song 15 to 180 — not \`${op.duration}\`.`);
    }
    if (op.model !== undefined) reasons.push(`op ${n}: leave \`model\` out — the card starts on the person's own default.`);
    return reasons;
}

/** The refusal as the model reads it (BoardOpsRejected::forModel). */
export const refusedText = (reasons) => `NOTHING was applied — the whole op list was refused:\n- ${reasons.join('\n- ')}\n\nFix these and send propose_board_ops again. Do not tell the user it worked.`;

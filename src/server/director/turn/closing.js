// After the tool loop (bloop's closing logic, in its order): ops written into the reply instead of the call are
// recovered once; a turn whose changes the board refused says so; a plan turn with no words prints its questions;
// a silent turn says it did not manage; a turn that changed the board but said nothing gets the ledger's words.

const OP_NAMES = ['note', 'node', 'wire', 'update', 'title'];
const CUT_UNCHANGED = 'Nothing in the cut changed this turn.';
const SAID_NOTHING_CHANGED = /\b(nothing (in the cut )?(was |has )?(changed|written)|did not change|didn't change|no change|left (it|the cut) as it (was|is))\b/i;

/** OpsFromProse: an op list written into the reply — whole message, a fenced block, or the first balanced span. */
export function opsFromProse(reply) {
    if (!/[{[]/.test(reply)) return null;
    const candidates = [reply.trim(), ...[...reply.matchAll(/```[a-z]*\s*\n([\s\S]*?)```/gi)].map((m) => m[1]), firstBalanced(reply)].filter(Boolean);
    for (const candidate of candidates) {
        let data;
        try {
            data = JSON.parse(candidate);
        } catch {
            continue;
        }
        const ops = Array.isArray(data) ? data : data?.ops;
        if (Array.isArray(ops) && ops.length && ops.every((o) => o && typeof o === 'object' && OP_NAMES.includes(o.op))) {
            const text = reply.replace(candidate, '').replace(/```[a-z]*\s*```/gi, '').replace(/\n{3,}/g, '\n\n').trim();
            return { ops, text };
        }
    }
    return null;
}

function firstBalanced(text) {
    const start = text.search(/[{[]/);
    if (start < 0) return null;
    const stack = [];
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            if (c === '\\') i++;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') inString = true;
        else if (c === '{' || c === '[') stack.push(c);
        else if (c === '}' || c === ']') {
            stack.pop();
            if (!stack.length) return text.slice(start, i + 1);
        }
    }
    return null;
}

/**
 * The cut's closing words, from the same applied list as the tool result and the strip (applied-edits.js): the count
 * and what each edit did, never more. A turn that only put the clips in says that.
 */
export function cutWords(cutEdits) {
    const edits = cutEdits.reduce((sum, e) => sum + (e.edits || 0), 0);
    if (cutEdits.every((e) => e.drafted)) return 'I put the clips into the cut in beat order.';
    const lines = cutEdits.flatMap((e) => e.lines ?? []);
    const head = edits === 1 ? 'I made one edit to the cut' : `I made ${edits || 'no'} edits to the cut`;
    return lines.length ? `${head}: ${lines.join('; ')}.` : `${head}.`;
}

/** The ledger's own words when the board changed and the model said nothing. */
export function ledgerWords(ledger) {
    if (ledger.touchedCut?.() && !ledger.nodeIds.length && !ledger.wires) {
        return cutWords(ledger.cutEdits);
    }
    const cards = ledger.actions.filter((a) => a.kind === 'card').length;
    if (!cards) return 'I wired that up on the board.';
    return cards === 1 ? 'I put one card on the board.' : `I put ${cards} cards on the board.`;
}

/**
 * Settles the reply. `recover(ops)` applies recovered ops (or throws BoardOpsRejected).
 * Returns { text, failed, replaced } — replaced: the panel shows `text` instead of what streamed.
 */
export function closeTurn({ streamed, ledger, recover }) {
    let text = String(streamed ?? '').trim();
    let replaced = false;
    let explained = false;

    const found = opsFromProse(text);
    if (found) {
        replaced = true;
        if (ledger.proposed()) {
            text = found.text || (ledger.touched() ? 'That is on the board.' : '');
        } else {
            try {
                const applied = recover(found.ops);
                const n = applied.nodes.length + applied.updated.length;
                text = found.text || (n === 1 ? 'Added one card to the board.' : `Added ${n} cards to the board.`);
            } catch {
                ledger.refused();
                explained = true;
                text = found.text ? `${found.text}\n\nI could not put that on the board, though. Say it again and I will fix it.` : 'I worked that out but could not put it on the board. Say it again and I will fix it.';
            }
        }
    }
    const refused = ledger.proposed() && !ledger.touched() && !ledger.built;
    if (refused && !explained && ledger.onlyCut?.()) {
        // A refused cut write (or a draft that wrote nothing, 03 §2): the reply may not claim an edit.
        if (!SAID_NOTHING_CHANGED.test(text)) text = [text, CUT_UNCHANGED].filter(Boolean).join('\n\n');
        replaced = true;
    } else if (refused && !explained) {
        text = [text, 'None of that reached the board, though — the board turned the changes down and I could not fix them in time. Nothing has changed. Say it again, or more plainly, and I will try a different shape.'].filter(Boolean).join('\n\n');
        replaced = true;
    }
    if (ledger.plannedThisTurn() && !text) {
        text = ledger.questions.length ? `Before I build this:\n\n${ledger.questions.map((q) => `- ${q}`).join('\n')}` : 'Let me think about that one — say a little more about what it is for and I will build it.';
        replaced = true;
    }
    const silent = !text && !ledger.touched();
    if (silent) {
        text = 'I did not manage that one. Try saying it again, or more plainly.';
        replaced = true;
    } else if (!text) {
        text = ledgerWords(ledger);
        replaced = true;
    }
    return { text, failed: silent || refused, replaced };
}

/** EchoedReply: the person pasted the Director's last reply back; it is refused before reaching the model. */
export function isEcho(message, lastReply) {
    const plain = (s) => String(s ?? '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
    const ask = plain(message);
    const reply = plain(lastReply);
    return Boolean(ask && reply && (ask === reply || (ask.length >= 80 && reply.includes(ask))));
}

export const ECHO_SAY = 'That is my last reply, sent back. Tell me what you want in your own words, like "go on" or "make it at night".';

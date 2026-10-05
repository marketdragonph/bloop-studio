// BoardAudit (ported from bloop): the critic. After the first apply of a turn it reads what that turn touched and
// hands the model its own work back ("CHECK YOUR OWN WORK"); audit_board runs it over the whole board. It reports
// and never rewires. Wording is bloop's; plates here are wired by their look NOTE (words), not their picture.

const RENDERS = new Set(['image', 'video', 'audio']);
const PLATE = /^(cast|prop|location):\s*([^·]+)$/i;

export const finding = (code, nodeId, message, severity = 'fix') => ({ code, nodeId, message, severity });
const line = (f) => `${f.nodeId ? `@${f.nodeId}: ` : ''}${f.message}`;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The names a shot may call a plate by: `mira-sen` → "mira sen" and "mira"; `corner-shop` → "corner shop". */
export function namesOf(tag) {
    const words = tag.replace(/-/g, ' ').trim();
    const first = words.split(' ')[0];
    return first.length > 2 && first !== words ? [words, first] : [words];
}

const names = (text, tag) => namesOf(tag).some((n) => new RegExp(`(^|[^\\p{L}])${escape(n)}(?:e?s|'s)?($|[^\\p{L}])`, 'iu').test(text));

/** Plate look notes on the board: [{ id, kind, tag }]. */
function platesOn(nodes) {
    return nodes.filter((n) => n.type === 'text' && PLATE.test(n.label ?? '')).map((n) => {
        const [, kind, tag] = PLATE.exec(n.label);
        return { id: n.id, kind: kind.toLowerCase(), tag: tag.trim() };
    });
}

/**
 * Findings for the board, or (turn scope) only the cards in `only` and what they feed.
 * `plan` (optional): { beats: n planned, built: n written } for SHORT OF PLAN.
 */
export function auditBoard({ nodes, connections }, { only = null, plan = null } = {}) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const into = (id) => connections.filter((c) => c.to_node_id === id);
    const plates = platesOn(nodes);
    const plateIds = new Set(plates.map((p) => p.id));
    const scope = only ? new Set([...only, ...connections.filter((c) => only.includes(c.from_node_id)).map((c) => c.to_node_id)]) : null;
    const findings = [];

    if (!only) {
        if (plan?.beats && plan.built < plan.beats) {
            findings.push(finding('short_of_plan', null, `the plan says ${plan.beats} beats and ${plan.built} ${plan.built === 1 ? 'is' : 'are'} on the board.${plan.failed ? ` ${plan.failed} of them failed and the reason is on the beat.` : ''} Say the two numbers plainly — do not guess at which ones are missing, and do not claim it is finished.`, 'note'));
        }
        const voices = nodes.filter((n) => n.type === 'text' && /^voice:/i.test(n.label ?? '')).length;
        const scripts = nodes.filter((n) => n.type === 'text' && /· script$/i.test(n.label ?? '')).length;
        if (voices && !scripts) {
            findings.push(finding('cast_but_silent', null, `this board cast ${voices} voice${voices === 1 ? '' : 's'} and wrote no lines at all — every beat came back silent. A beat writer reads only its brief, so briefs made of events alone produce no speech however many voices are cast. Say so plainly, and offer to rewrite the briefs that should turn on something said, naming who speaks and to whom.`, 'note'));
        }
    }

    for (const card of nodes) {
        if (scope && !scope.has(card.id)) continue;
        const wires = into(card.id);
        if (RENDERS.has(card.type)) {
            if (!wires.some((c) => c.to_socket === 'prompt')) {
                findings.push(finding('underfed', card.id, `this ${card.type} card has nothing wired into Words — it will render whatever it likes. Wire a note into it.`));
            }
            if (card.status === 'failed') {
                findings.push(finding('failed', card.id, 'its last render failed. Nothing is broken — it can simply be generated again.', 'note'));
            }
            if (card.type === 'video' && wires.some((c) => c.to_socket === 'last_frame') && !wires.some((c) => c.to_socket === 'first_frame')) {
                findings.push(finding('underfed', card.id, 'it has a last frame and no first frame: wire the beat\'s still into its First frame.'));
            }
        }
        if (card.type === 'text' && !connections.some((c) => c.from_node_id === card.id) && card.text_content?.trim() && !/^voice:/i.test(card.label ?? '')) {
            findings.push(finding('dangling', card.id, 'this note is wired to nothing, so nothing renders from it. Wire it into the cards it is the brief for.', only ? 'fix' : 'note'));
        }
    }

    // LANE WIRING (turn scope, as bloop): a plate named in a shot's words must be wired into that shot.
    if (only) {
        for (const card of nodes.filter((n) => (n.type === 'image' || n.type === 'video') && scope.has(n.id) && !plateIds.has(n.id) && !PLATE.test(n.label ?? ''))) {
            const wired = new Set(into(card.id).map((c) => c.from_node_id));
            const words = into(card.id).filter((c) => c.to_socket === 'prompt' && !plateIds.has(c.from_node_id))
                .map((c) => byId.get(c.from_node_id)?.text_content ?? '').join('\n');
            const what = card.type === 'image' ? 'still' : 'clip';
            const gaps = plates.filter((p) => !wired.has(p.id) && names(words, p.tag));
            if (gaps.length) {
                findings.push(finding('lane_unlinked', card.id, `\`${card.label ?? card.type}\` is written about ${gaps.map((p) => `${p.tag} (@${p.id})`).join(', ')}, and ${gaps.length === 1 ? 'it is' : 'they are'} not wired into this ${what}. The shot is drawn without them — their face or look is invented at render. Wire each look card into @${card.id} in this call. A tag can be an ordinary word: skip it if the words mean something else. Anyone new in the words with no card on the board needs one first.`));
            }
            const over = plates.filter((p) => p.kind !== 'location' && wired.has(p.id) && !names(words, p.tag));
            if (over.length && words.trim()) {
                findings.push(finding('lane_overcast', card.id, `\`${card.label ?? card.type}\` has ${over.map((p) => p.tag).join(', ')} wired in, and its words never name ${over.length === 1 ? 'it' : 'them'}. A subject who is not in the shot is drawn into it. There is no unwire op: name ${over.length === 1 ? 'it' : 'them'} in the words if ${over.length === 1 ? 'it belongs' : 'they belong'} in the shot, or tell the person that wire should go. Check first: a brief can call somebody "she" or "the pilot".`, 'note'));
            }
        }
    }
    return findings;
}

/** The findings as the tool result reads them (BoardAudit::forModel), or null when there are none. */
export function auditText(findings, { ownWork }) {
    if (!findings.length) return null;
    const fix = findings.filter((f) => f.severity === 'fix');
    const notes = findings.filter((f) => f.severity !== 'fix');
    const parts = [];
    if (fix.length) {
        parts.push([
            ownWork ? 'CHECK YOUR OWN WORK — what you just built has these problems:' : 'Problems on this board:',
            ...fix.map((f) => `- ${line(f)}`),
            ownWork ? 'Fix them with ONE more propose_board_ops call — wire and update ops, nothing rebuilt. If you cannot, say so plainly instead of claiming it is finished.'
                : 'Say what is wrong in plain words and offer to fix the ones you can with wire and update ops.',
        ].join('\n'));
    }
    if (notes.length) parts.push(['Also worth mentioning, but not yours to fix:', ...notes.map((f) => `- ${line(f)}`)].join('\n'));
    return parts.join('\n\n');
}

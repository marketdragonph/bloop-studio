// The Director's critic (ported from bloop's BoardAudit): reads the board and lists what is wrong in
// words the model can act on. It reports and never rewires: fixing is the Director's next step.
// Pure (board in, findings out), so the panel, the audit_board tool and the after-round check agree.

const MAX_FINDINGS = 20;
const RENDERS = new Set(['image', 'video', 'audio']);
const REFERENCE = /^(cast|location)\s*·\s*(.+)$/i;

const tag = (n) => `#${n.id} ${n.type}${n.label ? ` "${n.label}"` : ''}`;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Cast · Mira Sen" → the names a shot may call her by: "Mira Sen", "Mira". */
function namesOf(card) {
    const name = REFERENCE.exec(card.label ?? '')?.[2]?.trim();
    if (!name) return [];
    const first = name.split(/\s+/)[0];
    return first.length > 2 && first !== name ? [name, first] : [name];
}

const mentions = (text, names) => names.some((name) => new RegExp(`(^|[^\\p{L}])${escape(name)}($|[^\\p{L}])`, 'iu').test(text));

/** Findings for the whole board, or only for the cards in `only` (ids) and what they feed. */
export function auditBoard({ nodes, connections }, { only = null } = {}) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const into = (id) => connections.filter((c) => c.to_node_id === id);
    const outOf = (id) => connections.filter((c) => c.from_node_id === id);
    const references = nodes.filter((n) => n.type === 'text' && REFERENCE.test(n.label ?? ''));
    const touched = only ? new Set([...only, ...connections.filter((c) => only.includes(c.from_node_id)).map((c) => c.to_node_id)]) : null;
    const findings = [];

    for (const card of nodes) {
        if (touched && !touched.has(card.id)) continue;
        const wires = into(card.id);
        if (RENDERS.has(card.type)) {
            const words = wires.filter((c) => c.to_socket === 'prompt');
            if (!words.length) findings.push(`${tag(card)} has nothing in Words: wire its shot text card into it.`);
            if (card.type === 'video' && wires.some((c) => c.to_socket === 'last_frame') && !wires.some((c) => c.to_socket === 'first_frame')) {
                findings.push(`${tag(card)} has a last frame but no first frame: wire the shot's image card into it first.`);
            }
            if (card.type === 'video' && wires.some((c) => c.to_socket === 'audio') && !wires.some((c) => c.to_socket === 'first_frame')) {
                findings.push(`${tag(card)} has a voice but no first frame: lip sync needs a picture.`);
            }
            if (card.status === 'failed') findings.push(`${tag(card)} failed its last render${card.error ? `: ${card.error}` : ''}.`);
            // Characters and places named in the shot's words keep their look only when their card is wired in too.
            const shotText = words.map((c) => byId.get(c.from_node_id)).filter((n) => n && !REFERENCE.test(n.label ?? ''))
                .map((n) => n.text_content ?? '').join('\n');
            const wiredIn = new Set(words.map((c) => c.from_node_id));
            for (const ref of references) {
                if (!wiredIn.has(ref.id) && mentions(shotText, namesOf(ref))) {
                    findings.push(`${tag(card)} names ${namesOf(ref)[0]} but ${tag(ref)} is not wired into it: connect it, or the look drifts.`);
                }
            }
        }
        if (card.type === 'text' && !outOf(card.id).length && !REFERENCE.test(card.label ?? '')) {
            findings.push(`${tag(card)} is not wired into anything, so it changes no render.`);
        }
    }
    if (findings.length > MAX_FINDINGS) return [...findings.slice(0, MAX_FINDINGS), `…and ${findings.length - MAX_FINDINGS} more.`];
    return findings;
}

/** The audit as tool-result text. */
export const auditText = (findings) => (findings.length
    ? `Board check found ${findings.length} problem${findings.length > 1 ? 's' : ''}:\n- ${findings.join('\n- ')}\nFix them with your tools before you reply, unless the person asked for it this way.`
    : 'Board check: no problems found.');

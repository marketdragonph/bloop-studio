// Which captions a cut can carry (05-irresistible.md §5.5), read from the board: each beat's script card
// ("s2-cup · script"), the clip's measured spoken lines (export time) and a caption fix the person or the Director
// set (settings.outputs.caption_text). Burned-in captions default ON only when every captioned clip speaks its own
// script: its voice card and its script card are both wired into the clip, and its lines are measured. Otherwise
// they default off and the sheet says why. Read only.
import { captionCues, scriptLines } from '../../shared/cut-captions.js';
import { speechInCut } from '../../shared/cut-ducks.js';

const OWN_SOUND = (tag) => `${tag}: this clip makes its own sound; its words may not match the script.`;
const NO_LINES = 'No spoken line in the cut is measured yet, so there is nothing to caption.';

/** label (beat tag) → {id, text} of each script card on the board. */
export function scriptsOf(db, spaceId) {
    const rows = db.prepare("SELECT id, label, text_content FROM space_nodes WHERE space_id = ? AND type = 'text' AND label LIKE '%· script'").all(spaceId);
    return new Map(rows.map((n) => [String(n.label).replace(/\s*·\s*script$/i, '').trim().toLowerCase(), { id: n.id, text: n.text_content ?? '' }]));
}

/** node ids wired into each clip card, with their types. */
function wiresInto(db, nodeIds) {
    if (!nodeIds.length) return new Map();
    const rows = db.prepare(`SELECT c.to_node_id AS clip, c.from_node_id AS id, n.type FROM space_connections c JOIN space_nodes n ON n.id = c.from_node_id
        WHERE c.to_node_id IN (${nodeIds.map(() => '?').join(',')})`).all(...nodeIds);
    const map = new Map();
    for (const r of rows) map.set(r.clip, [...(map.get(r.clip) ?? []), { id: r.id, type: r.type }]);
    return map;
}

/**
 * @param {{ db: object, analysis?: { cached: (paths: string[]) => Map<string, object> } | null }} deps
 * @param {number} spaceId
 * @param {{ items: object[], settings?: object }} cut the cut (or a snapshot of it)
 * @returns {{ cues: object[], default_on: boolean, why_off: string|null, mode: 'off'|'burned', trimmed: string[], dropped: number }}
 */
export function captionPlan({ db, analysis = null }, spaceId, cut) {
    const items = cut.items ?? [];
    const cache = analysis?.cached(items.map((i) => i.media_path)) ?? new Map();
    const speech = speechInCut(items, (path) => cache.get(path)?.speech ?? null);
    const scripts = scriptsOf(db, spaceId);
    const fixes = cut.settings?.outputs?.caption_text ?? {};
    const scriptFor = (item) => scripts.get(String(item.beat_tag ?? '').toLowerCase()) ?? null;
    const textOf = (item) => {
        const fix = fixes[item.beat_tag];
        if (typeof fix === 'string' && fix.trim()) return fix;
        const lines = scriptLines(scriptFor(item)?.text);
        return lines.length ? lines.join('\n') : null;
    };
    const { cues, trimmed, dropped } = captionCues({ items, speech, textOf });
    const wires = wiresInto(db, [...new Set(cues.map((c) => items.find((i) => i.id === c.item_id)?.node_id).filter(Boolean))]);
    const unvoiced = items.find((item) => {
        if (!cues.some((c) => c.item_id === item.id)) return false;
        const into = wires.get(item.node_id) ?? [];
        const script = scriptFor(item);
        return !(script && into.some((w) => w.id === script.id) && into.some((w) => w.type === 'audio'));
    });
    const defaultOn = cues.length > 0 && !unvoiced;
    const whyOff = !cues.length ? NO_LINES : unvoiced ? OWN_SOUND(unvoiced.beat_tag ?? `Clip ${items.indexOf(unvoiced) + 1}`) : null;
    const chosen = cut.settings?.outputs?.captions;
    const mode = !cues.length ? 'off' : (chosen ?? (defaultOn ? 'burned' : 'off'));
    return { cues, default_on: defaultOn, why_off: whyOff, mode, trimmed, dropped };
}

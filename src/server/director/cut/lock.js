// The edit lock (03-director.md §4, owner decision Q2 = A). The Director may edit a clip it (or the live cut)
// placed that the person has not touched since. A clip the person placed or changed is theirs, and stays locked
// unless the person names it in words THIS turn — its beat tag, "beat/shot/clip N", "the first/last clip" — or
// names the whole cut ("the whole cut", "everything", "all of it", "tighten the cut"). The server reads the
// request text; the model's say-so never opens a lock. stitch_cut never edits at all.

const WHOLE_CUT = [
    /\bthe (whole|entire|full) (cut|film|video|edit|thing|piece)\b/i,
    /\b(all of it|everything|every (clip|shot|beat|cut)|all (the )?(clips|shots|beats))\b/i,
    /\b(tighten|trim|re-?cut|re-?edit|redo|shorten|cut down) (the|my) (cut|film|video|edit)\b/i,
    /\b(the cut|my cut) as a whole\b/i,
];
const NUMBERED = /\b(beat|shot|clip|scene)\s*(?:#|no\.?|number)?\s*(\d{1,2})\b/gi;
const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const WORDED = /\b(?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final|opening|closing) (?:beat|shot|clip|scene)|(?:beat|shot|clip|scene) (one|two|three|four|five|six|seven|eight|nine|ten))\b/gi;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const isLocked = (item) => item?.placed_by === 'person' || item?.person_rev != null;

/** The whole cut named in words. */
export const namesWholeCut = (request) => WHOLE_CUT.some((re) => re.test(String(request ?? '')));

/**
 * The item ids the request names this turn ('all' for the whole cut).
 * @param {string} request the person's words this turn
 * @param {object[]} items the cut's items, in order
 * @param {string[]} beats the plan's beat tags in order ([] with no plan: then numbers count clips in the cut)
 * @returns {'all'|Set<string>}
 */
export function namedItems(request, items, beats = []) {
    const text = String(request ?? '');
    if (namesWholeCut(text)) return 'all';
    const ids = new Set();
    const byTag = (tag) => items.filter((i) => String(i.beat_tag ?? '').toLowerCase() === String(tag).toLowerCase());
    const byNumber = (n) => (beats.length ? byTag(beats[n - 1] ?? '') : items[n - 1] ? [items[n - 1]] : []);
    for (const item of items) {
        const tag = String(item.beat_tag ?? '').trim();
        if (!tag) continue;
        const loose = escape(tag).replace(/\\?-/g, '[-\\s_]?');
        if (new RegExp(`(^|[^\\p{L}\\p{N}])${loose}($|[^\\p{L}\\p{N}])`, 'iu').test(text)) ids.add(item.id);
    }
    for (const [, , n] of text.matchAll(NUMBERED)) for (const item of byNumber(Number(n))) ids.add(item.id);
    for (const [, ordinal, spelled] of text.matchAll(WORDED)) {
        const word = String(ordinal ?? spelled).toLowerCase();
        if (['last', 'final', 'closing'].includes(word)) items.at(-1) && ids.add(items.at(-1).id);
        else if (word === 'opening') items[0] && ids.add(items[0].id);
        else for (const item of byNumber(WORD_NUMBERS[word])) ids.add(item.id);
    }
    return ids;
}

/** Locked items the request did not open. */
export function stillLocked(items, opened) {
    if (opened === 'all') return [];
    return items.filter((item) => isLocked(item) && !opened.has(item.id));
}

/** The refusal for a locked item (03 §4, verbatim for the Director's own clip the person changed). */
export function lockedReason(item) {
    const tag = item.beat_tag ?? `@${item.node_id}`;
    return item.placed_by === 'person'
        ? `${tag} was placed by the person, so it is theirs. Leave it, or ask them in one sentence whether you may change it.`
        : `${tag} was changed by the person after you placed it, so it is theirs. Leave it, or ask them in one sentence whether you may change it.`;
}

/** The snapshot's lock line: tags the person owns, or null. */
export function lockLine(items) {
    const tags = [...new Set(items.filter(isLocked).map((i) => i.beat_tag ?? `@${i.node_id}`))];
    return tags.length ? `Locked (the person changed them since): ${tags.join(', ')}.` : null;
}

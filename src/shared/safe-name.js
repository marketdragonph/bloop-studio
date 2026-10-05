// File and folder names that Windows accepts (05-irresistible.md §5.2, 01-core.md §8): no <>:"/\|?* or control
// characters, no reserved device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9, with or without an extension), no
// trailing dot or space, at most 80 characters. Export files, Pack zips and every path inside a zip use it.
// Pure, no Node or DOM APIs.

export const NAME_MAX = 80;
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i;
// eslint-disable-next-line no-control-regex
const BAD = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;

/**
 * One path segment Windows accepts. Keeps the person's words (spaces, accents, case); only what Windows
 * refuses is replaced by `-`.
 * @param {string} text
 * @param {{ max?: number, fallback?: string }} [options]
 */
export function safeName(text, { max = NAME_MAX, fallback = 'untitled' } = {}) {
    let name = String(text ?? '').normalize('NFC').replace(BAD, '-').replace(/\s+/g, ' ').trim();
    name = cut(name, max).replace(/[. ]+$/, '');
    if (!name || /^[.\- ]+$/.test(name)) name = fallback;
    const stem = name.split('.')[0].trim();
    if (RESERVED.test(stem)) name = `_${name}`;
    return cut(name, max).replace(/[. ]+$/, '') || fallback;
}

/**
 * A lower-case, hyphenated name for story file names: "Night Market!" → "night-market".
 * Letters and digits of any script are kept.
 */
export function slugName(text, { max = 48, fallback = 'cut' } = {}) {
    const slug = String(text ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    return safeName(cut(slug, max).replace(/-+$/, ''), { max, fallback });
}

/** Every segment of a relative path made safe; joined with `/` (zip entries). */
export function safePath(path, options) {
    return String(path ?? '').split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..').map((s) => safeName(s, options)).join('/');
}

/** "night-market" + "youtube" + 12 + "mp4" → "night-market-youtube-r12.mp4"; `n` > 1 adds "-2" before the extension. */
export function storyFileName({ story, preset, revision, ext, suffix = '', n = 1 }) {
    const parts = [slugName(story), preset, `r${revision}`].filter(Boolean).join('-');
    const tail = `${suffix}${n > 1 ? `-${n}` : ''}.${ext}`;
    return safeName(cut(parts, NAME_MAX - tail.length) + tail);
}

/** Cuts at a whole character (never half a surrogate pair). */
function cut(text, max) {
    const chars = [...text];
    return chars.length > max ? chars.slice(0, max).join('') : text;
}

const MEDIA_EXT = /\.(mp4|webm|mov|m4v|mkv|png|jpe?g|webp|gif|mp3|wav|ogg|oga|flac|m4a|aac)$/i;

/** "open-lanterns.mp4" → "open-lanterns": a media file's name without its extension (a card label, a Pack name). */
export function withoutExtension(name) {
    const text = String(name ?? '').trim();
    return text.replace(MEDIA_EXT, '').trim() || text;
}

// Parses one HTTP Range header against a file size. Pure, so the route stays small and the rules are tested.
// Only a single "bytes=" range is honoured; a header in another unit is ignored (the whole file is sent).

/**
 * @param {string|undefined} header the Range request header
 * @param {number} size the file size in bytes
 * @returns {null | { start: number, end: number } | 'unsatisfiable'}
 *   null = no range asked (send the whole file), a range (end inclusive), or 'unsatisfiable' (answer 416)
 */
export function parseByteRange(header, size) {
    if (!header) return null;
    const trimmed = header.trim();
    if (!/^bytes=/i.test(trimmed)) return null;
    const spec = trimmed.slice('bytes='.length).trim();
    if (spec.includes(',')) return 'unsatisfiable'; // one range only: a video element never asks for more
    const match = /^(\d*)-(\d*)$/.exec(spec);
    if (!match || (match[1] === '' && match[2] === '')) return 'unsatisfiable';
    if (size === 0) return 'unsatisfiable';

    if (match[1] === '') {
        // Suffix range: the last N bytes.
        const suffix = Number(match[2]);
        if (suffix === 0) return 'unsatisfiable';
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(match[1]);
    const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    if (start >= size || end < start) return 'unsatisfiable';
    return { start, end };
}

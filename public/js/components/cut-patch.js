// Keeps the dock's view lists stable while they change (P5 performance, 02-dock.md §11). cutLayout() runs every
// frame of a trim drag; replacing 50 item objects re-ran every binding of every clip. When the keys are the same
// in the same order, the old objects are patched field by field instead, so Alpine re-runs only the bindings that
// read a value that changed (the dragged clip's width, the x of the clips after it).

const same = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

/**
 * @param {object[]|null|undefined} prev  the list on screen (Alpine's reactive copy)
 * @param {object[]} next  the freshly computed list
 * @param {(item: object) => unknown} [keyOf]
 * @returns {object[]} `prev`, patched in place, when every key matches in order; else `next`
 */
export function patchList(prev, next, keyOf = (item) => item.key) {
    if (!Array.isArray(prev) || prev.length !== next.length) return next;
    for (let i = 0; i < next.length; i++) if (keyOf(prev[i]) !== keyOf(next[i])) return next;
    for (let i = 0; i < next.length; i++) {
        const target = prev[i];
        const source = next[i];
        for (const field of Object.keys(source)) if (!same(target[field], source[field])) target[field] = source[field];
    }
    return prev;
}

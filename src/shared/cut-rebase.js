// The live cut's silent rebase (05-irresistible.md §2.1). The dock holds an edit the server has not seen yet, and the
// server's copy moved on: when the ONLY difference is clips the live cut placed by itself (`placed_by: 'auto'`, plus
// the music bed it may have added under a cut with none), the dock keeps the person's edit and adds those clips. No
// banner: nothing of the person's was changed elsewhere. Anything else is a real conflict and returns null.
// Pure, shared by the dock and its tests.
import { sameCut } from './cut-edit.js';

const withoutMusic = (sound) => {
    if (!sound) return null;
    const { music, ...rest } = sound;
    return Object.keys(rest).length ? rest : null;
};

/**
 * @param {{ items: object[], sound: object|null }|null} base   the server copy the person's edit started from
 * @param {{ items: object[], sound: object|null }} local       what the dock shows (with the person's edit)
 * @param {{ items: object[], sound: object|null }} server      the newer server copy
 * @returns {{ items: object[], sound: object|null }|null} the person's edit with the auto clips added, or null
 */
export function rebaseAuto(base, local, server) {
    if (!base || !local || !Array.isArray(server?.items)) return null;
    const known = new Set(base.items.map((item) => item.id));
    const extra = server.items.filter((item) => !known.has(item.id));
    if (extra.some((item) => item.placed_by !== 'auto')) return null;
    const bedAdded = !base.sound?.music && Boolean(server.sound?.music);
    const kept = server.items.filter((item) => known.has(item.id));
    // What both sides had must be untouched on the server, or someone else edited it.
    if (!sameCut({ items: kept, sound: bedAdded ? withoutMusic(server.sound) : server.sound ?? null }, base)) return null;
    if (!extra.length && !bedAdded) return null;

    // Each placed clip goes right after the nearest clip before it (in the server's order) that the dock still has.
    const items = [...local.items];
    server.items.forEach((item, index) => {
        if (known.has(item.id) || items.some((i) => i.id === item.id)) return;
        let at = 0;
        for (let k = index - 1; k >= 0; k--) {
            const position = items.findIndex((i) => i.id === server.items[k].id);
            if (position >= 0) {
                at = position + 1;
                break;
            }
        }
        items.splice(at, 0, item);
    });
    const sound = bedAdded && !local.sound?.music ? { ...(local.sound ?? {}), music: server.sound.music } : local.sound ?? null;
    return { items, sound };
}

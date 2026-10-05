// What this PC's clip model can do, for the Director: the family its lanes render on (one that makes its own sound
// when the PC has one: LTX-2.3 first, then MiniMax-H3), whether it makes sound, and its clip lengths at 480p.
import { familiesFor } from '../generation/presets.js';
import { FAMILIES } from '../../shared/formats.js';

const SOUND_FAMILIES = ['ltx', 'h3'];

export function engineInfoFor(engine) {
    return async () => {
        let families = [];
        try {
            families = familiesFor((await engine.current()).presets, 'video');
        } catch {
            /* no engine answering: cloud only, or nothing yet */
        }
        const chosen = SOUND_FAMILIES.map((id) => families.find((f) => f.id === id)).find(Boolean) ?? families[0] ?? null;
        const table = chosen ? FAMILIES[chosen.knobs] : null;
        const lengths = table?.durations?.filter((s) => s <= (table.longest?.['480p'] ?? Infinity)) ?? [5, 10];
        return { clipFamily: chosen?.id ?? null, withSound: !chosen || SOUND_FAMILIES.includes(chosen.id), lengths };
    };
}

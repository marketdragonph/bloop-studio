// What this PC's models can do, for the Director: the family its clips render on (one that makes its own sound
// when the PC has one: LTX-2.3 first, then MiniMax-H3), whether it makes sound, its clip lengths at 480p, and
// whether stills can be drawn from reference pictures (Qwen-Image-Edit: the cast sheets wired into every still).
import { familiesFor } from '../generation/presets.js';
import { FAMILIES } from '../../shared/formats.js';

const SOUND_FAMILIES = ['ltx', 'h3'];

export function engineInfoFor(engine) {
    return async () => {
        let families = [];
        let stills = [];
        try {
            const { presets } = await engine.current();
            families = familiesFor(presets, 'video');
            stills = familiesFor(presets, 'image');
        } catch {
            /* no engine answering: cloud only, or nothing yet */
        }
        const chosen = SOUND_FAMILIES.map((id) => families.find((f) => f.id === id)).find(Boolean) ?? families[0] ?? null;
        const table = chosen ? FAMILIES[chosen.knobs] : null;
        const lengths = table?.durations?.filter((s) => s <= (table.longest?.['480p'] ?? Infinity)) ?? [5, 10];
        const editFamily = stills.some((f) => f.id === 'qwenedit') ? 'qwenedit' : null;
        return { clipFamily: chosen?.id ?? null, withSound: !chosen || SOUND_FAMILIES.includes(chosen.id), lengths, editFamily };
    };
}

// A card type's Model list on this PC right now: this engine's families and bloop's (signed in), ordered by the one
// rule in src/shared/card-source.js. Used by GET /presets/:type, Generate on a card with no pick, Render missing
// beats and the starter boards, so all four agree on what an untouched card renders on. Each local family carries the
// Style LoRAs in ComfyUI's loras folder that fit it (services/lora-library.js).
import { familiesFor } from './presets.js';
import { cloudFamilies } from './cloud-models.js';
import { defaultSource } from '../../shared/card-source.js';

/**
 * @param {{ engine: { current: () => Promise<{ detected: boolean, presets: Map }> }, account?: { signedIn?: boolean, models: () => Promise<object|null> } | null,
 *   launcher?: { state: () => { available: boolean } } | null, loras?: import('../services/lora-library.js').LoraLibrary | null }} deps
 * @returns {(type: string) => Promise<ReturnType<typeof defaultSource>>}
 */
export function cardSources({ engine, account = null, launcher = null, loras = null }) {
    return async (type) => {
        const profile = await engine.current();
        const local = await withStyles(familiesFor(profile.presets, type), type, profile.loras, loras);
        const cloud = cloudFamilies(await account?.models(), type);
        const engineReady = Boolean(profile.detected || launcher?.state().available);
        return defaultSource({ engineReady, signedIn: Boolean(account?.signedIn ?? cloud.length), local, cloud });
    };
}

/** Image and video families with the LoRAs that fit each (an empty list hides the card's Style knob). */
async function withStyles(families, type, names = [], loras = null) {
    if (!loras || !names?.length || type === 'audio') return families;
    return Promise.all(families.map(async (f) => ({ ...f, styles: await loras.stylesFor(f.id, names) })));
}

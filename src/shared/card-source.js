// Where a new card renders by default (05-irresistible.md §2.6): the ONE rule for a card's Model list order and its
// first pick. Shared by the server (the Model list, Generate on a card with no pick, Render missing beats, starter
// boards) and the browser. Pure: no Node or DOM APIs. (`model-sources.js` is the engine's model catalogue, not this.)
//
//   engine ready (ComfyUI answers, or the app can start it)  → this PC's models first, bloop's after: an untouched
//                                                              card never spends credits by surprise
//   no engine, signed in to bloop with models on the plan   → bloop's models first: renders with no engine wall
//   neither                                                  → nothing can render yet, said plainly

export const NOTHING_CAN_RENDER = 'Nothing can render yet. Install the engine in Settings, or sign in to bloop to render in the cloud.';

/**
 * @param {{ engineReady: boolean, signedIn: boolean, local?: {id: string}[], cloud?: {id: string}[] }} input
 *   `local`: this PC's families for the card type; `cloud`: bloop's families the signed-in plan offers.
 * @returns {{ kind: 'local'|'cloud'|'none', families: object[], family: string|null, reason: string|null }}
 *   `families` in Model list order; `family` the first, what a card with no pick renders on.
 */
export function defaultSource({ engineReady, signedIn, local = [], cloud = [] }) {
    const offeredCloud = signedIn ? cloud : [];
    if (engineReady) {
        const families = [...local, ...offeredCloud];
        return { kind: local.length ? 'local' : offeredCloud.length ? 'cloud' : 'none', families, family: families[0]?.id ?? null, reason: families.length ? null : NOTHING_CAN_RENDER };
    }
    if (offeredCloud.length) {
        const families = [...offeredCloud, ...local];
        return { kind: 'cloud', families, family: families[0].id, reason: null };
    }
    // No engine and no cloud: the list still shows this PC's models (a ComfyUI started by hand later can run them).
    return { kind: 'none', families: [...local], family: local[0]?.id ?? null, reason: NOTHING_CAN_RENDER };
}

/** The first family that makes music (a music bed must never go to a voice model). */
export const musicFamily = (families = []) => families.find((f) => /music|song|ace-?step/i.test(`${f.id} ${f.label ?? ''}`)) ?? null;

/** True when this family renders on bloop (credits), not on this PC. */
export const isCloudSource = (family) => typeof family === 'string' && family.startsWith('bloop:');

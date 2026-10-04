// bloop's cloud models as card families. A family id is "bloop:<model key>"; its knob options come
// from the model's own params (bloop's GET models), so the card offers exactly what that model takes.

export const CLOUD_PREFIX = 'bloop:';

export const isCloudFamily = (family) => typeof family === 'string' && family.startsWith(CLOUD_PREFIX);
export const cloudModelKey = (family) => family.slice(CLOUD_PREFIX.length);

// Card knob → the bloop model params it may set (the first one the model declares), and the knob's
// list name in the card's options. A voice is named differently per vendor: ElevenLabs `voice`,
// MiniMax `voice_id`, Qwen `speaker`.
const KNOB_PARAMS = {
    aspect: ['aspect_ratio'], resolution: ['resolution'], duration: ['duration'], quality: ['quality'],
    voice: ['voice', 'voice_id', 'speaker'],
};
const OPTION_LISTS = { aspect: 'aspects', resolution: 'resolutions', duration: 'durations', quality: 'qualities', voice: 'voices' };

/** The param a knob sets on this model, or undefined when the model takes none of its names. */
const paramFor = (knob, params) => KNOB_PARAMS[knob].find((name) => params[name]);

/** A select's options, or a number param's min…max by step (a duration slider becomes choices). */
function choicesOf(param) {
    if (!param) return [];
    if (Array.isArray(param.options)) return param.options.map((option) => (typeof option === 'object' ? option.value ?? option.id : option));
    if (param.type === 'number' && param.min != null && param.max != null) {
        const step = Number(param.step) || 1;
        const values = [];
        for (let v = Number(param.min); v <= Number(param.max) && values.length < 30; v += step) values.push(v);
        return values;
    }
    return [];
}

const labelled = (key, values) => values.map((value) => ({ value, label: key === 'duration' ? `${value} s` : String(value) }));

/** The families a card type offers from bloop's model list, cheapest first as bloop sorts them. */
export function cloudFamilies(models, type) {
    return (models?.[type] ?? []).map((model) => {
        const params = { ...(model.image_variant?.params ?? {}), ...(model.params ?? {}) };
        const options = Object.fromEntries(
            Object.keys(KNOB_PARAMS).map((knob) => [OPTION_LISTS[knob], labelled(knob, choicesOf(params[paramFor(knob, params)]))]),
        );
        const defaults = Object.fromEntries(
            Object.keys(KNOB_PARAMS)
                .map((knob) => [knob, params[paramFor(knob, params)]?.default])
                .filter(([, value]) => value != null),
        );
        return {
            id: `${CLOUD_PREFIX}${model.key}`,
            label: model.name,
            description: model.credits != null ? `bloop cloud · from ${model.credits} credits` : 'bloop cloud · uses credits',
            cloud: true,
            credits: model.credits ?? null,
            needsPicture: Boolean(model.requires_image && !model.image_variant),
            endFrame: Boolean(model.has_end_frame),
            options,
            defaults,
        };
    });
}

/** The model params a card's knob settings set, only those the model declares. */
export function cloudParams(model, settings = {}) {
    const params = { ...(model.image_variant?.params ?? {}), ...(model.params ?? {}) };
    const out = {};
    for (const knob of Object.keys(KNOB_PARAMS)) {
        const param = paramFor(knob, params);
        const value = settings[knob];
        if (value === undefined || value === null || value === '' || !param) continue;
        const offered = choicesOf(params[param]);
        if (!offered.length || offered.some((o) => String(o) === String(value))) out[param] = value;
    }
    return out;
}

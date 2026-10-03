// Card knobs (aspect, resolution, duration, quality) as in MarketDragon Spaces. Options come from
// the shared formats table the server names for the card's family on this machine (e.g. "h3" on
// the 24 GB card, "h3-int8" on 12 GB). The last choice per card type is remembered (sticky
// defaults) and applied to new cards of that type. The seed is never sticky.
import { knobOptions, aspectCss, DEFAULT_KNOBS } from '/shared/formats.js';

const STICKY_KEY = 'bloop-studio:card-defaults';
const KNOBS = ['family', 'aspect', 'resolution', 'duration', 'quality'];

function readSticky() {
    try {
        return JSON.parse(localStorage.getItem(STICKY_KEY) ?? '{}');
    } catch {
        return {};
    }
}

function writeSticky(type, key, value) {
    try {
        const all = readSticky();
        all[type] = { ...all[type], [key]: value };
        localStorage.setItem(STICKY_KEY, JSON.stringify(all));
    } catch {
        /* storage unavailable: defaults simply are not remembered */
    }
}

export const knobMethods = {
    familyFor(node) {
        return this.families[node.type]?.find((f) => f.id === this.familyOf(node));
    },

    knobsFor(node) {
        const family = this.familyFor(node);
        // A bloop cloud model brings its own options (its params); a local family names a formats table.
        return family?.options ?? knobOptions(family?.knobs) ?? { aspects: [], resolutions: [], durations: [], qualities: [] };
    },

    knobValue(node, key) {
        const value = node.settings?.[key];
        const options = this.knobsFor(node);
        // A card made on another PC may hold a value this machine's table does not offer.
        const offered = { aspect: options.aspects, resolution: options.resolutions, duration: options.durations, quality: options.qualities }[key];
        const match = (v) => offered?.find((o) => String(o.value) === String(v))?.value;
        if (value !== undefined && value !== null && (!offered?.length || match(value) !== undefined)) return offered?.length ? match(value) : value;
        // A cloud model's own default (e.g. 5 s, not its longest and dearest).
        const own = this.familyFor(node)?.defaults?.[key];
        if (own !== undefined && match(own) !== undefined) return match(own);
        if (key === 'aspect' && offered?.length && match(DEFAULT_KNOBS.aspect) === undefined) return offered[0].value;
        if (key === 'resolution') return options.resolutions[0]?.value;
        if (key === 'quality') return options.qualities.at(-1)?.value;
        if (key === 'duration') return options.durations.at(-1)?.value;
        return DEFAULT_KNOBS[key];
    },

    setKnob(node, key, value) {
        const settings = { ...node.settings, [key]: value };
        // A new model family may not offer the old resolution/duration/quality: drop them.
        if (key === 'family') for (const k of ['resolution', 'duration', 'quality']) delete settings[k];
        this.updateCard(node, { settings });
        writeSticky(node.type, key, value);
    },

    /** Applies remembered knob choices to a freshly created card. */
    applyStickyDefaults(node) {
        const sticky = readSticky()[node.type];
        if (!sticky || !['image', 'video'].includes(node.type)) return;
        const settings = Object.fromEntries(KNOBS.filter((k) => sticky[k] !== undefined).map((k) => [k, sticky[k]]));
        if (Object.keys(settings).length) this.updateCard(node, { settings: { ...node.settings, ...settings } });
    },

    previewAspect(node) {
        return aspectCss(this.knobValue(node, 'aspect'));
    },
};

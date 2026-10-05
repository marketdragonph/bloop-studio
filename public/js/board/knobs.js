// Card knobs (aspect, resolution, duration, quality) as in MarketDragon Spaces. Options come from
// the shared formats table the server names for the card's family on this machine (e.g. "h3" on
// the 24 GB card, "h3-int8" on 12 GB). The last choice per card type is remembered (sticky
// defaults) and applied to new cards of that type. The seed is never sticky.
import { knobOptions, aspectCss, DEFAULT_KNOBS } from '/shared/formats.js';

const STICKY_KEY = 'bloop-studio:card-defaults';
const KNOBS = ['family', 'aspect', 'resolution', 'duration', 'quality', 'voice'];

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
        const none = { aspects: [], resolutions: [], durations: [], qualities: [], voices: [] };
        const options = { ...none, ...(family?.options ?? knobOptions(family?.knobs)) };
        // A long clip only at the resolutions tried that long (formats.js `longest`).
        const resolution = node.settings?.resolution ?? options.resolutions[0]?.value;
        const cap = options.longest?.[resolution];
        return cap ? { ...options, durations: options.durations.filter((d) => Number(d.value) <= cap) } : options;
    },

    knobValue(node, key) {
        const value = node.settings?.[key];
        const options = this.knobsFor(node);
        // A card made on another PC may hold a value this machine's table does not offer.
        const offered = { aspect: options.aspects, resolution: options.resolutions, duration: options.durations, quality: options.qualities, voice: options.voices }[key];
        const match = (v) => offered?.find((o) => String(o.value) === String(v))?.value;
        if (value !== undefined && value !== null && (!offered?.length || match(value) !== undefined)) return offered?.length ? match(value) : value;
        // A cloud model's own default (e.g. 5 s, not its longest and dearest); a song's 30 s.
        const own = this.familyFor(node)?.defaults?.[key] ?? options.defaults?.[key];
        if (own !== undefined && match(own) !== undefined) return match(own);
        if (key === 'aspect' && offered?.length && match(DEFAULT_KNOBS.aspect) === undefined) return offered[0].value;
        if (key === 'resolution') return options.resolutions[0]?.value;
        if (key === 'quality') return options.qualities.at(-1)?.value;
        // 5 s unless the model offers less: a 10 s clip takes minutes and is chosen, never a default.
        if (key === 'duration') return match(5) ?? (options.durations.filter((d) => Number(d.value) <= 5).at(-1) ?? options.durations[0])?.value;
        if (key === 'voice') return options.voices[0]?.value;
        return DEFAULT_KNOBS[key];
    },

    setKnob(node, key, value) {
        const settings = { ...node.settings, [key]: value };
        // A new model family may not offer the old resolution/duration/quality/voice: drop them.
        if (key === 'family') for (const k of ['resolution', 'duration', 'quality', 'voice']) delete settings[k];
        this.updateCard(node, { settings });
        writeSticky(node.type, key, value);
    },

    /** Applies remembered knob choices to a freshly created card. */
    applyStickyDefaults(node) {
        const sticky = readSticky()[node.type];
        if (!sticky || !['image', 'video', 'audio'].includes(node.type)) return;
        const settings = Object.fromEntries(KNOBS.filter((k) => sticky[k] !== undefined).map((k) => [k, sticky[k]]));
        if (Object.keys(settings).length) this.updateCard(node, { settings: { ...node.settings, ...settings } });
    },

    previewAspect(node) {
        if (node.type === 'audio') return 'auto'; // the player sets its own height, not a frame
        // A finished render's real frame wins over the setting: an older take, a cloud model or an upload
        // can be another shape, and the card takes that shape instead of letterboxing it (bloop's noteClipShape).
        return node._mediaShape ?? aspectCss(this.knobValue(node, 'aspect'));
    },

    /** Once a clip or picture loads: keep its real shape on the card (not saved) when it differs from the box. */
    noteMediaShape(node, el) {
        const w = el?.videoWidth || el?.naturalWidth;
        const h = el?.videoHeight || el?.naturalHeight;
        if (!w || !h) return;
        const [bw, bh] = String(this.previewAspect(node)).split('/').map(Number);
        if (bw > 0 && bh > 0 && Math.abs(w / h - bw / bh) <= 0.02) return;
        node._mediaShape = `${w} / ${h}`;
        this.tidyAfterRender(); // the card is a new height now: nothing may overlap the cards below it
    },
};

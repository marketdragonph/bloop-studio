// Card knobs (as in MarketDragon Spaces): aspect ratio, resolution, duration, quality.
// One table per model family, shared by the server (pixel sizes, frames, steps) and the card UI
// (which options to offer), so the two can never disagree. Values are what was tested on the
// RX 7900 XTX / 24 GB: H3 above ~0.6 MP or past 5 s pushes 32 GB of RAM into swap.

export const ASPECTS = [
    { id: '16:9', label: '16:9 Wide', w: 16, h: 9 },
    { id: '9:16', label: '9:16 Vertical', w: 9, h: 16 },
    { id: '1:1', label: '1:1 Square', w: 1, h: 1 },
    { id: '4:5', label: '4:5 Portrait', w: 4, h: 5 },
    { id: '21:9', label: '21:9 Cinema', w: 21, h: 9 },
];

export const FAMILIES = {
    zimage: {
        resolutions: [{ id: '1k', label: '1K (≈1 MP)', mp: 1.05 }, { id: '1.5k', label: '1.5K (≈1.6 MP)', mp: 1.6 }],
        qualities: [{ id: 'final', label: 'Final', steps: 8 }],
    },
    wan5b: {
        resolutions: [{ id: '480p', label: '480p', mp: 0.4 }, { id: '720p', label: '720p (slow)', mp: 0.9 }],
        durations: [2, 3, 4, 5],
        fps: 24,
        frames: (seconds) => Math.round((seconds * 24) / 4) * 4 + 1, // Wan wants 4n + 1 frames
        qualities: [{ id: 'draft', label: 'Draft', steps: 12 }, { id: 'final', label: 'Final', steps: 20 }],
    },
    h3: {
        resolutions: [{ id: '480p', label: '480p', mp: 0.41 }, { id: '576p', label: '576p (slower)', mp: 0.6 }],
        durations: [3, 4, 5],
        fps: 24,
        // The H3 template's own rule: max(5, round(s·24)) rounded up to 17k + 5 frames.
        frames: (seconds) => {
            const base = Math.max(5, Math.round(seconds * 24));
            return base + ((5 - (base % 17)) % 17 + 17) % 17;
        },
        qualities: [{ id: 'draft', label: 'Draft (6 steps)', steps: 6 }, { id: 'final', label: 'Final (8 steps)', steps: 8 }],
    },
};

export const DEFAULT_KNOBS = { aspect: '16:9', resolution: null, duration: 5, quality: 'final' };

/** Width × height for an aspect at a megapixel target, both multiples of 32 (every model here needs that). */
export function sizeFor(aspectId, megapixels) {
    const aspect = ASPECTS.find((a) => a.id === aspectId) ?? ASPECTS[0];
    const pixels = megapixels * 1_000_000;
    const unit = Math.sqrt(pixels / (aspect.w * aspect.h));
    const snap = (v) => Math.max(256, Math.round(v / 32) * 32);
    return { width: snap(aspect.w * unit), height: snap(aspect.h * unit) };
}

/** The options a card offers for its family (for the UI). */
export function knobOptions(family) {
    const f = FAMILIES[family];
    if (!f) return null;
    return {
        aspects: ASPECTS.map(({ id, label }) => ({ value: id, label })),
        resolutions: f.resolutions.map(({ id, label }) => ({ value: id, label })),
        durations: (f.durations ?? []).map((s) => ({ value: s, label: `${s} s` })),
        qualities: f.qualities.map(({ id, label }) => ({ value: id, label })),
    };
}

/** Turns a card's knob settings into preset inputs: width, height, length (frames), steps. */
export function knobInputs(family, settings = {}) {
    const f = FAMILIES[family];
    if (!f) return {};
    const resolution = f.resolutions.find((r) => r.id === settings.resolution) ?? f.resolutions[0];
    const quality = f.qualities.find((q) => q.id === settings.quality) ?? f.qualities.at(-1);
    const inputs = { ...sizeFor(settings.aspect ?? DEFAULT_KNOBS.aspect, resolution.mp), steps: quality.steps };
    if (f.frames) {
        const seconds = f.durations.includes(Number(settings.duration)) ? Number(settings.duration) : f.durations.at(-1);
        inputs.length = f.frames(seconds);
    }
    return inputs;
}

/** CSS aspect-ratio for a card's preview frame. */
export function aspectCss(aspectId) {
    const aspect = ASPECTS.find((a) => a.id === aspectId) ?? ASPECTS[0];
    return `${aspect.w} / ${aspect.h}`;
}

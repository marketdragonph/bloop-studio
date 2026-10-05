// Export presets (05-irresistible.md §5.1): the sheet, the route validator, the export and the Director's `outputs`
// op read this one list. P3 ships Master (the plan's shape) and YouTube (16:9); P6 adds TikTok, Reels and Shorts
// (9:16, 1080 × 1920, −14 LUFS) and the Shapes row (one file per shape from one press). Every output is 30 fps
// (cut-rules FRAME_RATES), H.264 through Windows' h264_mf and AAC through Windows' aac_mf (native aac only when
// aac_mf is missing; owner decision 1). Loudness is one linear gain, applied only when the mix was measured.
// Platform length limits are hints with the date we checked them, never refusals. Pure, no Node or DOM APIs.

export const VIDEO_BITRATE = 8_000_000; // -b:v 8M (h264_mf honours it; the P3 spike measured 7.45 Mbit/s)
export const AUDIO_BITRATE = 192_000;
export const TRUE_PEAK_CEILING = -1.5; // dBTP: the gain is capped so the peak stays under it
export const FPS = 30;
export const SHAPE_LIST = Object.freeze(['16:9', '9:16', '1:1']);
/** When the platform limits below were last checked (re-check before each release). */
export const LIMITS_CHECKED_ON = '2025-06-01';

const preset = (fields) => Object.freeze({ maxSeconds: null, platform: false, ...fields });
export const EXPORT_PRESETS = Object.freeze({
    master: preset({ id: 'master', label: 'Master', aspect: null, lufs: -16, phase: 'P3' }),
    youtube: preset({ id: 'youtube', label: 'YouTube', aspect: '16:9', lufs: -14, phase: 'P3', resolution: 1080 }),
    tiktok: preset({ id: 'tiktok', label: 'TikTok', aspect: '9:16', lufs: -14, phase: 'P6', resolution: 1080, maxSeconds: 600, platform: true }),
    reels: preset({ id: 'reels', label: 'Reels', aspect: '9:16', lufs: -14, phase: 'P6', resolution: 1080, maxSeconds: 180, platform: true }),
    shorts: preset({ id: 'shorts', label: 'Shorts', aspect: '9:16', lufs: -14, phase: 'P6', resolution: 1080, maxSeconds: 180, platform: true }),
});
export const PRESET_IDS = Object.freeze(Object.keys(EXPORT_PRESETS));
export const DEFAULT_PRESET = 'master';

const SIZES = Object.freeze({
    1080: { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] },
    720: { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720] },
});

/** @returns {string|null} a plain reason, or null when the preset exists */
export const checkPreset = (id) => (Object.hasOwn(EXPORT_PRESETS, id) ? null : 'Pick Master, YouTube, TikTok, Reels or Shorts.');

/**
 * What one preset makes for a cut: frame size, shape, fps and loudness target. `shape` (P6) asks for one shape of
 * the Shapes row; a preset with its own shape (YouTube 16:9, the vertical ones 9:16) keeps it.
 * @param {string} id @param {{ resolution?: number, aspect?: string }} [settings] the cut's settings @param {string} [shape]
 */
export function presetOutput(id, settings = {}, shape = null) {
    const p = EXPORT_PRESETS[id] ?? EXPORT_PRESETS[DEFAULT_PRESET];
    const own = SIZES[1080][settings.aspect] ? settings.aspect : '16:9';
    const aspect = p.aspect ?? (SIZES[1080][shape] ? shape : own);
    const resolution = p.resolution ?? (SIZES[settings.resolution] ? settings.resolution : 1080);
    const [width, height] = SIZES[resolution][aspect];
    return { preset: p.id, label: p.label, width, height, aspect, fps: FPS, lufs: p.lufs };
}

/**
 * The files one press makes: one per shape (05 §5.4). A shape the chosen preset is made for uses it; any other
 * shape is a Master of that shape (the cut's own resolution, −16 LUFS). No shapes: the preset's own shape, else
 * the cut's. Order: the preset's file first.
 * @returns {{ preset: string, variant: string }[]}
 */
export function outputsFor(id, shapes, planAspect) {
    const p = EXPORT_PRESETS[id] ?? EXPORT_PRESETS[DEFAULT_PRESET];
    const own = p.aspect ?? (SHAPE_LIST.includes(planAspect) ? planAspect : '16:9');
    const list = Array.isArray(shapes) && shapes.length ? [...new Set(shapes.filter((s) => SHAPE_LIST.includes(s)))] : [own];
    const sorted = list.includes(own) ? [own, ...list.filter((s) => s !== own)] : list;
    return sorted.map((variant) => ({ preset: p.aspect == null || p.aspect === variant ? p.id : DEFAULT_PRESET, variant }));
}

/** "tiktok", or "master-9x16" for a Master in a shape that is not the cut's own (file names, the card). */
export function outputName(presetId, variant, planAspect) {
    const p = EXPORT_PRESETS[presetId] ?? EXPORT_PRESETS[DEFAULT_PRESET];
    const own = p.aspect ?? planAspect ?? '16:9';
    return variant && variant !== own ? `${p.id}-${variant.replace(':', 'x')}` : p.id;
}

/** "Master 9:16" when the Master is not in the cut's own shape; else the preset's label. */
export function outputLabel(presetId, variant, planAspect) {
    const p = EXPORT_PRESETS[presetId] ?? EXPORT_PRESETS[DEFAULT_PRESET];
    const own = p.aspect ?? planAspect ?? '16:9';
    return variant && variant !== own ? `${p.label} ${variant}` : p.label;
}

/** About how big the file will be: video + audio bit rates over the length. */
export const estimateBytes = (totalMs) => Math.ceil(((VIDEO_BITRATE + AUDIO_BITRATE) / 8) * (Math.max(0, totalMs) / 1000));

/** "1920 × 1080 · 30 fps · about 38 MB · −14 LUFS" (the sheet's plain numbers). */
export function presetLine(output, totalMs, { measured = true } = {}) {
    const mb = Math.max(1, Math.round(estimateBytes(totalMs) / 1_000_000));
    const loud = measured ? `−${Math.abs(output.lufs)} LUFS` : 'loudness not set';
    return `${output.width} × ${output.height} · ${output.fps} fps · about ${mb} MB · ${loud}`;
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** A plain hint when the cut runs past a platform's limit; null when it fits. Never a refusal. */
export function lengthHint(presetId, totalMs) {
    const p = EXPORT_PRESETS[presetId];
    if (!p?.maxSeconds || totalMs / 1000 <= p.maxSeconds) return null;
    return `${p.label} takes up to ${clock(p.maxSeconds)}; this cut is ${clock(Math.round(totalMs / 1000))}. It still exports (limit checked ${LIMITS_CHECKED_ON}).`;
}

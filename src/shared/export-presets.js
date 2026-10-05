// Export presets (05-irresistible.md §5.1): the sheet, the route validator and the export read this one list.
// P3 ships Master (the plan's shape) and YouTube (16:9). Every output is 30 fps (cut-rules FRAME_RATES), H.264
// through Windows' h264_mf and AAC through Windows' aac_mf (native aac only when aac_mf is missing; owner
// decision 1). Loudness is one linear gain, applied only when the mix was measured. Pure, no Node or DOM APIs.

export const VIDEO_BITRATE = 8_000_000; // -b:v 8M (h264_mf honours it; the P3 spike measured 7.45 Mbit/s)
export const AUDIO_BITRATE = 192_000;
export const TRUE_PEAK_CEILING = -1.5; // dBTP: the gain is capped so the peak stays under it
export const FPS = 30;

export const EXPORT_PRESETS = Object.freeze({
    master: Object.freeze({ id: 'master', label: 'Master', aspect: null, lufs: -16, phase: 'P3' }),
    youtube: Object.freeze({ id: 'youtube', label: 'YouTube', aspect: '16:9', lufs: -14, phase: 'P3' }),
});
export const DEFAULT_PRESET = 'master';

const SIZES = Object.freeze({
    1080: { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] },
    720: { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720] },
});

/** @returns {string|null} a plain reason, or null when the preset exists */
export const checkPreset = (id) => (Object.hasOwn(EXPORT_PRESETS, id) ? null : 'Pick Master or YouTube.');

/**
 * What one preset makes for a cut: frame size, shape, fps and loudness target.
 * @param {string} id @param {{ resolution?: number, aspect?: string }} [settings] the cut's settings
 */
export function presetOutput(id, settings = {}) {
    const preset = EXPORT_PRESETS[id] ?? EXPORT_PRESETS[DEFAULT_PRESET];
    const aspect = preset.aspect ?? (SIZES[1080][settings.aspect] ? settings.aspect : '16:9');
    const resolution = preset.id === 'youtube' ? 1080 : (SIZES[settings.resolution] ? settings.resolution : 1080);
    const [width, height] = SIZES[resolution][aspect];
    return { preset: preset.id, label: preset.label, width, height, aspect, fps: FPS, lufs: preset.lufs };
}

/** About how big the file will be: video + audio bit rates over the length. */
export const estimateBytes = (totalMs) => Math.ceil(((VIDEO_BITRATE + AUDIO_BITRATE) / 8) * (Math.max(0, totalMs) / 1000));

/** "1920 × 1080 · 30 fps · about 38 MB · −14 LUFS" (the sheet's plain numbers). */
export function presetLine(output, totalMs, { measured = true } = {}) {
    const mb = Math.max(1, Math.round(estimateBytes(totalMs) / 1_000_000));
    const loud = measured ? `−${Math.abs(output.lufs)} LUFS` : 'loudness not set';
    return `${output.width} × ${output.height} · ${output.fps} fps · about ${mb} MB · ${loud}`;
}

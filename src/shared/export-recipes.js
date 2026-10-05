// Every ffmpeg filter and encoder the Mini Katana export uses (05-irresistible.md §5.8). All are LGPL core
// filters or Windows' own encoders; GPL-only ones (eq, boxblur, libx264…) and drawtext/subtitles never appear: captions
// are PNGs the page draws, overlaid. CheckCut compares these lists with the cached `-filters` and `-encoders` of the
// found ffmpeg; a test greps src/server/cut/export/ for any filter not listed here. The core list is required for
// any export; a missing P6 filter drops only the output it serves (OUTPUT_FILTERS), with a plain reason.

export const EXPORT_FILTERS = Object.freeze([
    'scale', 'pad', 'setsar', 'fps', 'format', // NormalizeClips (video)
    'aresample', 'aformat', 'apad', // NormalizeClips (sound, PCM parts)
    'xfade', 'afade', 'amix', // JoinClips (a dissolve junction)
    'atrim', 'asetpts', 'volume', 'adelay', // MixSound (bed, voice, duck envelope)
    'ebur128', // Loudness (measure)
]);

/** P6: what each optional output needs on top of the core list. */
export const OUTPUT_FILTERS = Object.freeze({
    shapes: Object.freeze(['crop']), // a crop box per clip
    soft_bars: Object.freeze(['split', 'gblur', 'colorchannelmixer', 'overlay', 'crop']), // the fit over a blurred, dimmed copy
    captions: Object.freeze(['overlay']), // the page's caption PNGs
    gif: Object.freeze(['split', 'palettegen', 'paletteuse']), // the preview GIF
});
/** Every filter any export step may name. */
export const ALL_EXPORT_FILTERS = Object.freeze([...new Set([...EXPORT_FILTERS, ...Object.values(OUTPUT_FILTERS).flat()])]);
/** GPL-only or text-drawing filters that must never appear in a recipe (06 §9). */
export const NEVER_FILTERS = Object.freeze(['boxblur', 'eq', 'drawtext', 'subtitles', 'ass', 'libx264', 'smartblur', 'unsharp_opencl']);

/** "This build of the video tools has no palettegen, so the GIF is skipped." */
export const OUTPUT_WORDS = Object.freeze({ shapes: 'the 9:16 and 1:1 shapes are', soft_bars: 'soft bars are', captions: 'captions are', gif: 'the GIF is' });
export const missingOutputReason = (output, filters) => `This build of the video tools has no ${filters.join(', ')}, so ${OUTPUT_WORDS[output]} skipped.`;

/** The video encoder is required; for audio the first one found wins (aac only when aac_mf is missing). */
export const VIDEO_ENCODER = 'h264_mf';
export const AUDIO_ENCODERS = Object.freeze(['aac_mf', 'aac']);
export const POSTER_ENCODER = 'mjpeg';
export const GIF_ENCODER = 'gif';
export const PART_AUDIO_CODEC = 'pcm_s16le'; // parts carry PCM; AAC is encoded once at the end (P3 spike fix 3)

/** Names in `ffmpeg -encoders` / `-filters` output: the second column of each listing row. */
export function parseCodecList(stdout) {
    const names = new Set();
    for (const line of String(stdout ?? '').split(/\r?\n/)) {
        const m = line.match(/^\s*[A-Z.|]{2,}[A-Z.]*\s+(\S+)\s/);
        if (m && !/^=+$/.test(m[1])) names.add(m[1]);
    }
    return names;
}

// Every ffmpeg filter and encoder the Mini Katana export uses (05-irresistible.md §5.8). All are LGPL core
// filters or Windows' own encoders; GPL-only ones (eq, boxblur, libx264…) and drawtext/subtitles never appear. CheckCut compares this list with the cached `-filters` and
// `-encoders` of the found ffmpeg; a test greps src/server/cut/export/ for any filter not listed here.

export const EXPORT_FILTERS = Object.freeze([
    'scale', 'pad', 'setsar', 'fps', 'format', // NormalizeClips (video)
    'aresample', 'aformat', 'apad', // NormalizeClips (sound, PCM parts)
    'xfade', 'afade', 'amix', // JoinClips (a dissolve junction)
    'atrim', 'asetpts', 'volume', 'adelay', // MixSound (bed, voice, duck envelope)
    'ebur128', // Loudness (measure)
]);

/** The video encoder is required; for audio the first one found wins (aac only when aac_mf is missing). */
export const VIDEO_ENCODER = 'h264_mf';
export const AUDIO_ENCODERS = Object.freeze(['aac_mf', 'aac']);
export const POSTER_ENCODER = 'mjpeg';
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

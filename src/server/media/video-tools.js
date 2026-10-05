// Settings › Video tools and the export preflight read this (01-core.md §9). One check finds ffmpeg and
// ffprobe, reads the version and licence line, and caches the encoder and filter lists (`-encoders`,
// `-filters`) so CheckCut never spawns to ask again. "Check again" and "Choose ffmpeg.exe…" refresh it.
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { AUDIO_ENCODERS, EXPORT_FILTERS, GIF_ENCODER, OUTPUT_FILTERS, POSTER_ENCODER, VIDEO_ENCODER, missingOutputReason, parseCodecList } from '../../shared/export-recipes.js';

export const TOOLS_MISSING = 'The video tools are missing. Reinstall Bloop Studio, or choose ffmpeg.exe in Settings › Video tools.';
export const ENCODER_MISSING = 'This PC has no H.264 encoder from Windows. Install the Media Feature Pack from Windows Settings.';
const EXE = process.platform === 'win32' ? '.exe' : '';

/** "LGPL-3.0-or-later" from the configure line in `ffmpeg -version`: never guessed from the file name. */
export function licenceOf(versionText) {
    const text = String(versionText ?? '');
    if (/--enable-nonfree/.test(text)) return 'nonfree';
    if (/--enable-gpl/.test(text)) return /--enable-version3/.test(text) ? 'GPL-3.0-or-later' : 'GPL-2.0-or-later';
    return /--enable-version3/.test(text) ? 'LGPL-3.0-or-later' : 'LGPL-2.1-or-later';
}

/**
 * P6 (05 §5.8): what this build can make beyond the core export, each with a plain reason when it cannot
 * ("Ready for: Export, Poster, Shapes, Captions, GIF" in Settings › Video tools).
 * @returns {Record<string, { ready: boolean, reason: string|null }>}
 */
export function outputsReady(filters, encoders) {
    const out = {};
    for (const [output, needs] of Object.entries(OUTPUT_FILTERS)) {
        const lacking = needs.filter((f) => !filters.has(f));
        if (output === 'gif' && !encoders.has(GIF_ENCODER)) lacking.push(`the ${GIF_ENCODER} encoder`);
        out[output] = { ready: !lacking.length, reason: lacking.length ? missingOutputReason(output, lacking) : null };
    }
    out.poster = { ready: encoders.has(POSTER_ENCODER), reason: encoders.has(POSTER_ENCODER) ? null : 'This build of the video tools has no mjpeg encoder, so the poster is skipped.' };
    return out;
}

export class VideoTools {
    /** @param {{ ffmpeg: import('./capped-ffmpeg.js').CappedFfmpeg, settings?: { get(k: string): any, update(v: object): void }, exists?: (p: string) => boolean }} deps */
    constructor({ ffmpeg, settings = null, exists = existsSync }) {
        Object.assign(this, { ffmpeg, settings, exists });
        this.cached = null;
        this.pending = null;
    }

    /** The last check (runs one the first time). */
    async state() {
        return this.cached ?? this.check();
    }

    /** Runs the info calls again (Check again). Concurrent callers share one check. */
    check() {
        this.pending ??= this.#check().finally(() => { this.pending = null; });
        return this.pending;
    }

    async #check() {
        const where = this.ffmpeg.locate();
        const base = { found: false, ffmpeg: where.ffmpeg, ffprobe: where.ffprobe, source: where.source, version: null, licence: null,
            encoders: { video: null, audio: null }, filters_missing: [], outputs: {}, ready: false, reason: TOOLS_MISSING, checked_at: new Date().toISOString() };
        try {
            const version = await this.ffmpeg.info(['-version']);
            await this.ffmpeg.info(['-version'], { tool: 'ffprobe' });
            const encoders = parseCodecList(await this.ffmpeg.info(['-encoders']));
            const filters = parseCodecList(await this.ffmpeg.info(['-filters']));
            const licence = licenceOf(version);
            const video = encoders.has(VIDEO_ENCODER) ? VIDEO_ENCODER : null;
            const audio = AUDIO_ENCODERS.find((e) => encoders.has(e)) ?? null;
            const missing = EXPORT_FILTERS.filter((f) => !filters.has(f));
            let reason = null;
            if (!licence.startsWith('LGPL')) reason = 'This ffmpeg is not an LGPL build. Choose the one that came with Bloop Studio.';
            else if (!video) reason = ENCODER_MISSING;
            else if (!audio) reason = 'This ffmpeg has no AAC encoder.';
            else if (missing.length) reason = `This ffmpeg has no ${missing.join(', ')} filter.`;
            this.cached = {
                ...base, found: true, version: version.split(/\r?\n/)[0].replace(/\s+Copyright.*$/, '').trim(), licence,
                encoders: { video, audio, all: [...encoders].filter((e) => [VIDEO_ENCODER, ...AUDIO_ENCODERS].includes(e)) },
                filters_missing: missing, outputs: outputsReady(filters, encoders), ready: !reason, reason,
            };
        } catch {
            this.cached = base; // never the stderr text on the page
        }
        return this.cached;
    }

    /**
     * Choose ffmpeg.exe…: the folder must hold both ffmpeg.exe and ffprobe.exe and `-version` must answer.
     * The path is saved only when the check passes. @returns {Promise<{ ok: boolean, error?: string, state?: object }>}
     */
    async choose(path) {
        const file = String(path ?? '').trim();
        if (!file || basename(file).toLowerCase() !== `ffmpeg${EXE}`) return { ok: false, error: `Choose the file named ffmpeg${EXE}.` };
        if (!this.exists(file) || !this.exists(join(dirname(file), `ffprobe${EXE}`))) {
            return { ok: false, error: `That folder needs both ffmpeg${EXE} and ffprobe${EXE}.` };
        }
        const previous = this.settings?.get('ffmpegPath') ?? '';
        this.settings?.update({ ffmpegPath: file });
        const state = await this.check();
        if (!state.found) {
            this.settings?.update({ ffmpegPath: previous });
            await this.check();
            return { ok: false, error: 'That ffmpeg did not start. Choose another one.' };
        }
        return { ok: true, state };
    }

    /** Back to the bundled copy (clears the chosen path). */
    async reset() {
        this.settings?.update({ ffmpegPath: '' });
        return this.check();
    }
}

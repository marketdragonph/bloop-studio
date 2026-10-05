// One read of everything measured about a cut, for GET /spaces/:id/cut and the Director (inspect_cut, the cut
// critic): BoardCut's slots and untimed findings, the analysis cache, the timed findings, and the measured sound
// placed on the cut (duck windows, beat ticks, spoken lines, the bed's waveform bars). Read only: no job, no write.
// The dock draws what this returns, so it shows the numbers the Director used and the export plays.
import { cutClock } from '../../shared/cut-clock.js';
import { beatsInCut, cutDucks, speechInCut } from '../../shared/cut-ducks.js';
import { mediaOfCut } from '../analysis/analyze-media.js';
import { mergeFindings, timedFindings } from './findings.js';

/**
 * @param {{ boardCut: object, plans: object, analysis?: { cached: Function, measuring?: Function, toolsMissing?: boolean } }} deps
 * @param {number} spaceId
 * @param {object} cut the stored cut
 */
export function checkCut({ boardCut, plans, analysis = null }, spaceId, cut) {
    const read = boardCut.read(spaceId, { cut });
    const plan = plans.latest(spaceId);
    const beats = plan ? plans.beats(plan.id) : [];
    const media = mediaOfCut(cut);
    const cache = analysis?.cached(media.map((m) => m.path)) ?? new Map();
    const analysisOf = (path) => cache.get(path) ?? null;
    const timed = timedFindings({ cut, slots: read.slots, plan, briefs: new Map(beats.map((b) => [b.tag, b.brief])), analysisOf });
    return {
        read, plan, beats, cache, analysisOf,
        findings: mergeFindings(read.findings, timed),
        unmeasured: media.filter((m) => !cache.has(m.path)).map((m) => ({ ...m, measuring: Boolean(analysis?.measuring?.(m.path)) })),
        toolsMissing: Boolean(analysis?.toolsMissing),
    };
}

/** Measured sound on the cut, in export time: what GET /spaces/:id/cut adds for the dock. */
export function soundOnCut(cut, analysisOf, beds = [], scripts = new Map()) {
    const total = cutClock(cut.items).total_ms;
    const music = cut.sound?.music ? analysisOf(cut.sound.music.media_path) : null;
    const voice = cut.sound?.voice ? analysisOf(cut.sound.voice.media_path) : null;
    const voiceMs = voice?.duration_ms ?? Math.round((beds.find((b) => b.kind === 'voice')?.seconds ?? 0) * 1000);
    const speechOf = (path) => analysisOf(path)?.speech ?? null;
    const { beats_ms, downbeats_ms } = beatsInCut(music, total);
    return {
        ducks: cutDucks(cut, speechOf, { voiceMs }),
        beats_ms,
        downbeats_ms,
        bpm: music?.bpm ?? null,
        speech: speechInCut(cut.items, speechOf).map((s) => {
            const tag = cut.items.find((i) => i.id === s.item_id)?.beat_tag ?? null;
            return { ...s, beat_tag: tag, text: scripts.get(tag) ?? null };
        }),
        music_peaks: music?.peaks ?? null,
        voice_peaks: voice?.peaks ?? null,
    };
}

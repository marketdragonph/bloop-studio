// Captions from the script (05-irresistible.md §5.5): the words of each beat's script card, timed by the measured
// spoken lines of its clip, split at 32 characters, two lines a caption, at most three captions a clip and 50 a
// cut. The dock draws each caption as a PNG (Inter 700 on a seam-grey plate), the export overlays the PNGs and
// writes the same captions as an .srt beside the file. Pure, no Node or DOM APIs.

export const CAPTIONS = Object.freeze({
    lineMax: 32, linesPerCue: 2, perClip: 3, maxCues: 50, textMax: 300,
    pngMaxBytes: 200 * 1024, pngMaxWidth: 2000, pngMaxHeight: 600,
    modes: Object.freeze(['off', 'burned']),
});
/** A PNG is drawn for a frame whose short side is 1080 px; the export scales it to the output. */
export const CAPTION_REF_PX = 1080;
/** The platform safe area: vertical apps cover the bottom fifth with their own buttons and text. */
export const CAPTION_SAFE = Object.freeze({ '9:16': 0.22, '1:1': 0.1, '16:9': 0.08 });

/** The spoken words of a script card: `[VO] …`, `[@who (how)] …`, `[on camera] …` lines without their tags. */
export function scriptLines(text) {
    return String(text ?? '').split(/\r?\n/).map((l) => l.replace(/^\s*\[[^\]]*\]\s*/, '').trim()).filter(Boolean);
}

/** Word-wraps at `max` characters; a word longer than a line is split. */
export function wrapLines(text, max = CAPTIONS.lineMax) {
    const lines = [];
    let line = '';
    const flush = (next = '') => {
        if (line) lines.push(line);
        line = next;
    };
    for (let word of String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)) {
        while (word.length > max) {
            flush(word.slice(0, max));
            flush();
            word = word.slice(max);
        }
        if (!word) continue;
        if (line && line.length + 1 + word.length <= max) line += ` ${word}`;
        else flush(word);
    }
    if (line) lines.push(line);
    return lines;
}

/** Text split into captions of at most two lines each. */
const chunksOf = (text) => {
    const lines = wrapLines(text);
    const out = [];
    for (let i = 0; i < lines.length; i += CAPTIONS.linesPerCue) out.push(lines.slice(i, i + CAPTIONS.linesPerCue));
    return out;
};

/** Shares [from, to] between chunks by their length in characters. */
function spread(chunks, from, to) {
    const sizes = chunks.map((c) => c.join(' ').length);
    const sum = sizes.reduce((a, b) => a + b, 0) || 1;
    let at = from;
    return chunks.map((lines, i) => {
        const end = i === chunks.length - 1 ? to : Math.round(at + ((to - from) * sizes[i]) / sum);
        const cue = { lines, from_ms: Math.round(at), to_ms: end };
        at = end;
        return cue;
    });
}

/** At most `perClip` captions: the clip's words over its whole spoken window, the last one marked if cut short. */
function capped(text, from, to) {
    const chunks = chunksOf(text);
    if (chunks.length <= CAPTIONS.perClip) return { cues: spread(chunks, from, to), trimmed: false };
    const kept = chunks.slice(0, CAPTIONS.perClip);
    const last = kept.at(-1);
    last[last.length - 1] = `${last.at(-1).slice(0, CAPTIONS.lineMax - 1)}…`;
    return { cues: spread(kept, from, to), trimmed: true };
}

/**
 * Captions for the cut, in export time.
 * @param {{ items: object[], speech: {item_id: string, from_ms: number, to_ms: number}[], textOf: (item: object) => string|null }} input
 *   `speech`: the measured spoken lines in export time (speechInCut); `textOf`: the beat's words (a fix, else its script)
 * @returns {{ cues: {id: string, item_id: string, beat_tag: string|null, from_ms: number, to_ms: number, lines: string[]}[], trimmed: string[], dropped: number }}
 */
export function captionCues({ items, speech, textOf }) {
    const all = [];
    const trimmed = [];
    for (const item of items) {
        const words = textOf(item);
        const spans = speech.filter((s) => s.item_id === item.id && s.to_ms > s.from_ms).sort((a, b) => a.from_ms - b.from_ms);
        if (!words || !String(words).trim() || !spans.length) continue;
        const lines = scriptLines(words);
        let cues;
        const perSpan = lines.length === spans.length && lines.every((l) => chunksOf(l).length === 1);
        if (perSpan) cues = spans.map((s, i) => ({ lines: chunksOf(lines[i])[0], from_ms: s.from_ms, to_ms: s.to_ms }));
        else {
            const result = capped(lines.join(' '), spans[0].from_ms, spans.at(-1).to_ms);
            cues = result.cues;
            if (result.trimmed) trimmed.push(item.beat_tag ?? item.id);
        }
        for (const cue of cues.slice(0, CAPTIONS.perClip)) all.push({ item_id: item.id, beat_tag: item.beat_tag ?? null, ...cue });
    }
    const kept = all.slice(0, CAPTIONS.maxCues).map((cue, i) => ({ id: `c${i + 1}`, ...cue }));
    return { cues: kept, trimmed, dropped: Math.max(0, all.length - CAPTIONS.maxCues) };
}

const two = (n) => String(n).padStart(2, '0');
const stamp = (ms) => {
    const t = Math.max(0, Math.round(ms));
    return `${two(Math.floor(t / 3_600_000))}:${two(Math.floor(t / 60_000) % 60)}:${two(Math.floor(t / 1000) % 60)},${String(t % 1000).padStart(3, '0')}`;
};

/** SubRip text (CRLF, numbered from 1). */
export function toSrt(cues) {
    return cues.map((c, i) => `${i + 1}\r\n${stamp(c.from_ms)} --> ${stamp(c.to_ms)}\r\n${c.lines.join('\r\n')}\r\n`).join('\r\n');
}

/**
 * Where a caption plate goes in an output frame: scaled from the 1080 px reference (never wider than 90 % of the
 * frame), centred, its bottom on the platform's safe line. Integer pixels.
 * @param {{ width: number, height: number, shape: string }} out @param {{ width: number, height: number }} plate
 */
export function placeCaption(out, plate) {
    const scale = Math.min(Math.min(out.width, out.height) / CAPTION_REF_PX, (out.width * 0.9) / plate.width);
    const w = Math.max(2, Math.round((plate.width * scale) / 2) * 2);
    const h = Math.max(2, Math.round((plate.height * scale) / 2) * 2);
    const bottom = Math.round(out.height * (CAPTION_SAFE[out.shape] ?? CAPTION_SAFE['16:9']));
    return { w, h, x: Math.round((out.width - w) / 2), y: Math.max(0, out.height - bottom - h) };
}

/** `settings.outputs.caption_text`: {beat_tag: words}. @returns {string|null} */
export function checkCaptionText(fixes) {
    if (fixes == null) return null;
    if (typeof fixes !== 'object' || Array.isArray(fixes)) return 'Caption fixes are not readable.';
    const entries = Object.entries(fixes);
    if (entries.length > 50) return 'At most 50 caption fixes.';
    for (const [tag, text] of entries) {
        if (!tag || tag.length > 80) return 'A caption fix names its beat.';
        if (typeof text !== 'string' || text.length > CAPTIONS.textMax) return `A caption is at most ${CAPTIONS.textMax} characters.`;
    }
    return null;
}

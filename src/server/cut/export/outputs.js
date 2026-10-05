// What one Export press makes (05-irresistible.md §5.1, §5.4, §5.5): one row per shape of the Shapes row, each
// with the choices as pressed (captions burned in or not, with the cues and the PNGs the page drew, soft bars,
// the preview GIF), and the sheet's readout before the press (a line and a length hint per file, the captions
// and why they are off, which clips a crop would blow up past 2×). Nothing here runs ffmpeg but a cached probe.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CAPTIONS } from '../../../shared/cut-captions.js';
import { FRAME, cropBox, sameShape } from '../../../shared/cut-frame.js';
import { DEFAULT_PRESET, lengthHint, outputLabel, outputsFor, presetLine, presetOutput } from '../../../shared/export-presets.js';
import { tmpRoot } from '../tools-jobs.js';
import { pngSize } from './extras.js';
import { pictureOf } from './check-probe.js';

/** A refusal at the press: no row, no process. */
export class PressRefused extends Error {
    constructor(message, code = 'captions') {
        super(message);
        this.code = code;
    }
}

/** The choices of a press: the request wins, then the cut's saved outputs, then the defaults. */
export function pressChoices(input, settings, plan) {
    const saved = settings?.outputs ?? {};
    const preset = input.preset ?? saved.preset ?? DEFAULT_PRESET;
    const shapes = Array.isArray(input.shapes) && input.shapes.length ? input.shapes : saved.shapes ?? null;
    const asked = input.captions?.mode ?? null;
    return {
        preset, shapes,
        captions: plan.cues.length ? (asked ?? plan.mode) : 'off',
        soft_bars: typeof input.soft_bars === 'boolean' ? input.soft_bars : saved.soft_bars === true,
        gif: typeof input.gif === 'boolean' ? input.gif : saved.gif !== false,
    };
}

/** Same choices, same file: the idempotent press compares this. */
export function signature(choices, cues) {
    const words = cues.map((c) => [c.from_ms, c.to_ms, c.lines]); // the .srt, and the burned captions when on
    return createHash('sha1').update(JSON.stringify({ c: choices.captions, words, s: choices.soft_bars, g: choices.gif })).digest('hex').slice(0, 16);
}

const decode = (value) => {
    const text = String(value ?? '');
    const b64 = text.startsWith('data:image/png;base64,') ? text.slice(22) : text;
    if (!/^[A-Za-z0-9+/=\s]*$/.test(b64)) return null;
    return Buffer.from(b64, 'base64');
};

/**
 * Checks the caption PNGs the page sent (one per cue id, PNG, ≤ 200 KB, ≤ 2000 × 600) and writes them to the
 * group's folder under the temp root (swept on start; removed when the group ends). @returns {Promise<string>} the folder
 */
export async function saveCaptionImages(media, groupId, cues, images) {
    const list = Array.isArray(images) ? images : [];
    if (list.length > CAPTIONS.maxCues) throw new PressRefused(`At most ${CAPTIONS.maxCues} captions in one export.`);
    const byId = new Map(list.map((i) => [String(i?.id ?? ''), i?.png]));
    const decoded = [];
    for (const cue of cues) {
        if (!byId.has(cue.id)) throw new PressRefused('The captions were not drawn. Open the export again and press Export.');
        const bytes = decode(byId.get(cue.id));
        const size = bytes && bytes.length <= CAPTIONS.pngMaxBytes ? pngSize(bytes) : null;
        if (!size || size.width > CAPTIONS.pngMaxWidth || size.height > CAPTIONS.pngMaxHeight) throw new PressRefused(`Caption ${cue.id} is not a picture the export can use.`);
        decoded.push([cue.id, bytes]);
    }
    const dir = join(tmpRoot(media), `captions-${groupId}`);
    await mkdir(dir, { recursive: true });
    for (const [id, bytes] of decoded) await writeFile(join(dir, `${id}.png`), bytes);
    return dir;
}

/** The rows a press makes: [{preset, variant, options}] with one group id. */
export function pressRows(choices, planShape, cues, captionsDir) {
    const groupId = randomUUID();
    const sig = signature(choices, cues);
    const rows = outputsFor(choices.preset, choices.shapes, planShape).map(({ preset, variant }) => ({
        preset, variant, groupId,
        options: {
            cues, signature: sig, soft_bars: choices.soft_bars, gif: choices.gif,
            captions: choices.captions === 'burned' ? { mode: 'burned', dir: captionsDir } : { mode: 'off' },
        },
    }));
    return { groupId, rows, signature: sig };
}

/** Clip display sizes, probed once per file (path + size + mtime), for the soft-bars offer. */
export class SourceSizes {
    constructor(ffmpeg) {
        this.ffmpeg = ffmpeg;
        this.cache = new Map();
    }

    async of(path) {
        if (!path) return null;
        if (this.cache.has(path)) return this.cache.get(path);
        try {
            const info = await this.ffmpeg.probe(path);
            const size = pictureOf((info?.streams ?? []).find((s) => s.codec_type === 'video')).display;
            if (this.cache.size > 500) this.cache.clear();
            this.cache.set(path, size);
            return size;
        } catch {
            return null;
        }
    }
}

/**
 * The sheet's readout for the Shapes row: one entry per file, and the clips whose centred crop would blow the
 * picture up more than 2× in a shape that is not the cut's own (the "Fit with soft bars" offer).
 */
export async function shapesReadout({ items, settings, planShape, totalMs, choices, sizes }) {
    const files = outputsFor(choices.preset, choices.shapes, planShape).map(({ preset, variant }) => {
        const output = presetOutput(preset, { ...settings, aspect: planShape }, variant);
        return { preset, variant, label: outputLabel(preset, variant, planShape), width: output.width, height: output.height,
            line: presetLine(output, totalMs), hint: lengthHint(preset, totalMs) };
    });
    const blowUp = [];
    for (const file of files.filter((f) => f.variant !== planShape)) {
        for (const item of items) {
            if (item.frame?.[file.variant]?.fit === 'bars') continue;
            const size = await sizes?.of(item.src);
            if (!size || sameShape(size, file.variant)) continue;
            const box = cropBox(size, file.variant, item.frame?.[file.variant], file);
            if (box.upscale > FRAME.softBarsOver) blowUp.push({ beat_tag: item.beat_tag ?? null, item_id: item.id, variant: file.variant, upscale: box.upscale });
        }
    }
    return { files, soft_bars: { offer: blowUp.length > 0, on: choices.soft_bars, clips: blowUp } };
}

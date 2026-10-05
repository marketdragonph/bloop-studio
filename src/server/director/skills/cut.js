// The Director's Cut tools (03-director.md §2, §3, §5, §7): stitch_cut, propose_cut_ops, inspect_cut, pack_assets.
// Owner rules in every one: nothing here renders (no GPU, no bloop cloud), nothing exports, nothing starts Render
// missing beats, and no tool result names a control — results say what happened, the person chooses what to press.
// The cut changes only through CutDraft and CutOps (both save through CutEdits), with the edit lock and one undo per
// turn. The Pack job starts only when the person asked for it in words this turn.
import { cutClock } from '../../../shared/cut-clock.js';
import { mediaOfCut } from '../../analysis/analyze-media.js';
import { checkCut } from '../../cut/cut-check.js';
import { CutOpsRejected, CUT_OPS, MAX_CUT_OPS, TRACKS, UNDO_KINDS } from '../cut/validate.js';
import { PRESET_IDS, SHAPE_LIST } from '../../../shared/export-presets.js';
import { cutCheckText } from '../cut/audit-cut.js';
import { inspectText } from '../cut/inspect-text.js';

const pad = (n) => String(n).padStart(2, '0');
export const clockText = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};
const NO_CUT = 'The Cut is not available on this board. Say so in one sentence.';
/** The person asked to pack in words this turn (03 §7: only then). */
export const PACK_WORDS = /\b(pack(ed|ing)?|zip(ped)?|bundle|collect|gather|download|archive|hand(ing)?[- ]?(it |them |everything |the (files|assets) )?(off|over))\b/i;

/** The critic, once per turn, on what this write changed. */
function critic(t, changed) {
    if (!t.ledger.claimCutAudit()) return '';
    const c = t.cut;
    const check = checkCut({ boardCut: c.boardCut, plans: c.plans, analysis: c.analysis }, t.spaceId, c.cuts.current(t.spaceId));
    const text = cutCheckText(check.findings, changed);
    return text ? `\n\n${text}` : '';
}

export const stitchCut = {
    name: 'stitch_cut',
    description: 'Put the board\'s rendered clips together into the Cut, in beat order. Use it for "stitch", "cut it together", "rough cut", "put the clips together", "make it one video" — and "make the video" when clips are missing (the gaps are named, never rendered). It renders nothing and exports nothing.',
    schema: {
        type: 'object',
        properties: {
            mode: { type: 'string', enum: ['fill', 'add_new'], description: 'fill: build the cut in beat order, ONLY into an empty cut. add_new: add rendered beats that are not in the cut yet; never moves, trims or removes the person\'s items.' },
        },
        required: ['mode'],
    },

    run({ mode }, t) {
        const c = t.cut;
        if (!c) return { ok: false, content: NO_CUT };
        if (!['fill', 'add_new'].includes(mode)) return { ok: false, content: '`mode` is "fill" (an empty cut) or "add_new" (rendered beats not in the cut yet).' };
        c.turns.begin(t.spaceId, t.ledger);
        const prior = new Set(c.cuts.current(t.spaceId).items.map((i) => i.id));
        const result = c.drafts.draft(t.spaceId, { mode, by: 'director', turn: t.ledger.cutTurnId });
        const gaps = result.missing.length ? `${result.missing.length} ${result.missing.length === 1 ? 'beat has' : 'beats have'} no video: ${result.missing.join(', ')}.` : 'Every beat is in.';
        if (!result.drafted) {
            c.turns.abandon(t.ledger);
            t.ledger.cutRefused();
            if (result.reason === 'not_empty') return { ok: true, content: 'The cut already has the person\'s work in it, so nothing was written. A fresh draft is offered to them as a replacement. Say that in one sentence; it is their choice. Do not name any buttons.' };
            if (result.reason === 'nothing_new') return { ok: true, content: `Every rendered beat is already in the cut, so nothing was added. ${gaps} NOTHING WAS RENDERED. Say that in one sentence; do not offer to render, and do not name any buttons.` };
            return { ok: true, content: `There are no rendered clips on this board yet, so the cut stays empty. ${gaps} NOTHING WAS RENDERED. Say that in one sentence; do not say anything is rendering, and do not name any buttons.` };
        }
        const changed = result.cut.items.map((i) => i.node_id);
        const placed = result.cut.items.filter((i) => !prior.has(i.id));
        const clips = `${mode === 'fill' ? 'Put' : 'Added'} ${result.added} ${result.added === 1 ? 'clip' : 'clips'} in beat order`;
        const music = result.music ? `"${result.music}" on the Music lane` : '';
        const text = result.added ? `${clips}${music ? `, ${music}` : ''}` : music;
        // A fill goes into an empty cut, whose dock lane showed these very clips as the draft: the turn starts from
        // that length, not from 0:00, so the strip reads the length the person saw (bug 2026-10-05).
        const shown = mode === 'fill' && !c.turns.repo.find(t.ledger.cutTurnId)?.before?.items?.length ? cutClock(result.cut.items).total_ms : null;
        // One write is one edit, the same count the strip, the reveal text and Undo turn read (applied-edits.js).
        c.turns.record(t.ledger.cutTurnId, result.cut, {
            rows: [{ kind: 'stitch', beat_tag: null, node_id: null, item_id: null, text, why: null }], changed, edits: 1, beforeTotalMs: shown,
        });
        t.ledger.recordCut({ edits: 1, changed, drafted: true, lines: [text] });
        const capped = result.capped ? ' The cut stopped at its limit (50 clips or 10 minutes).' : '';
        const list = `\nExactly what changed: ${placed.length ? `${placed.map((i) => i.beat_tag).join(', ')} placed whole, in beat order` : 'no clip was added'}${music ? `; ${music}` : ''}; nothing was trimmed, moved or taken out.`;
        return { ok: true, content: `${text}; the cut is ${clockText(cutClock(result.cut.items).total_ms)}, revision ${result.cut.revision}.${capped} ${gaps} NOTHING WAS RENDERED. Say which beats are missing in one sentence. Do not say they are rendering, and do not name any buttons.${list}${critic(t, changed)}` };
    },
};

export const proposeCutOps = {
    name: 'propose_cut_ops',
    description: 'Edit the Cut: place, trim, move or remove a beat\'s clip, set the join between two clips, the clip\'s own sound, J/L cuts, which sound card is the music (or none), music ducking, levels, a cut on the music\'s downbeat, the poster frame, how the export is set up (preset, shapes, captions, caption wording), or take back your last turn. Use it for "tighten it", "trim the dead bits", "cut on the beat", "duck the music", "make it punchier", "swap 3 and 4", "end on the train", "make it ready for TikTok", "add captions", "add the score", "no music", "undo that". Read the numbers with inspect_cut first; never guess a time. Everything in ONE call, all of it or none of it. Clips the person placed or changed are theirs unless they name them (or the whole cut) this turn. It changes the edit only — it renders nothing and exports nothing; the export is for the person to start.',
    schema: {
        type: 'object',
        properties: {
            ops: {
                type: 'array', maxItems: MAX_CUT_OPS, description: 'The edits, in the order they apply.',
                items: {
                    type: 'object', required: ['op'],
                    properties: {
                        op: { type: 'string', enum: CUT_OPS },
                        beat: { type: 'string', description: 'The beat tag (s3-door), or @<id> of a clip card on a board with no plan.' },
                        after: { type: 'string', description: 'place/move: the beat it follows, or "start".' },
                        take: { type: 'string', description: 'place: @<id> of an older take; default the newest.' },
                        in_s: { type: 'number', description: 'trim: where the clip starts, seconds into the clip, 0.1 steps.' },
                        out_s: { type: 'number', description: 'trim: where it ends. An out point within 80 ms of a downbeat lands on it.' },
                        type: { type: 'string', enum: ['cut', 'dissolve'], description: 'join: the join AFTER `beat`.' },
                        ms: { type: 'integer', description: 'join: dissolve length, 250-1000, at most half the shorter clip.' },
                        audio_ms: { type: 'integer', description: 'join: J cut < 0 (next sound starts early), L cut > 0 (this sound runs on). |audio_ms| <= 1500.' },
                        on: { type: 'boolean', description: 'sound: the clip\'s own sound on or off.' },
                        card: { type: 'string', description: 'music: @<id> of the sound card to put on the Music lane (inspect_cut lists them); it replaces the music there.' },
                        off: { type: 'boolean', description: 'music: true takes the music off the cut.' },
                        depth_db: { type: 'number', description: 'duck: how far music drops under spoken lines, -3 to -18.' },
                        track: { type: 'string', enum: TRACKS, description: 'level: which track.' },
                        gain_db: { type: 'number', description: 'level: -24 to +6.' },
                        target_lufs: { type: 'number', enum: [-23, -16, -14], description: 'level: loudness the export aims for.' },
                        at_s: { type: 'number', description: 'poster: the frame, seconds into the clip.' },
                        preset: { type: 'string', enum: PRESET_IDS, description: 'outputs: master, youtube (16:9), tiktok, reels or shorts (9:16, 1080x1920, -14 LUFS).' },
                        shapes: { type: 'array', items: { type: 'string', enum: SHAPE_LIST }, description: 'outputs: one file per shape. A shape the clips were not made in crops from the middle; the person moves the crop boxes, never you.' },
                        captions: { type: 'string', enum: ['off', 'burned'], description: 'outputs: burn in the script lines where they are spoken (an .srt is always written beside the file).' },
                        caption_text: { type: 'object', additionalProperties: { type: 'string' }, description: 'outputs: corrected caption words by beat tag, {"s2-cup": "..."}; an empty string takes a fix back.' },
                        kinds: { type: 'array', items: { type: 'string', enum: UNDO_KINDS }, description: 'undo_turn: take back only these kinds of edit from your last turn; leave out to take back the whole turn.' },
                        why: { type: 'string', description: 'trim/move/join: the reason, from the measured numbers, in editing words (at most 120 characters). It is kept and shown.' },
                    },
                },
            },
        },
        required: ['ops'],
    },

    run({ ops }, t) {
        const c = t.cut;
        if (!c) return { ok: false, content: NO_CUT };
        let done;
        try {
            done = c.ops.apply(t.spaceId, ops, { request: t.request ?? '', ledger: t.ledger });
        } catch (error) {
            if (!(error instanceof CutOpsRejected)) throw error;
            t.ledger.cutRefused();
            return { ok: false, content: error.forModel() };
        }
        if (done.undone === 'all') {
            return { ok: true, content: `Done — your last turn is taken back; the cut is ${clockText(done.after_ms)} again (was ${clockText(done.before_ms)}), revision ${done.saved.revision}. Say so in one sentence. Nothing was rendered or exported.` };
        }
        const notes = [...done.snapped, ...(done.hints ?? [])]; // P6: the outputs op's "the crop will be soft"
        const snaps = notes.length ? `\n${notes.join('\n')}` : '';
        return { ok: true, content: `${appliedText(done)}${snaps}${critic(t, done.changed)}` };
    },
};

/**
 * The exact account of a write (bug 2026-10-05: a reply claimed trims that never landed): the count and one line per
 * change, read from the cut before and after the save (applied-edits.js). The model describes these and no more.
 */
export function appliedText(done) {
    const head = `the cut is now ${clockText(done.after_ms)} (was ${clockText(done.before_ms)}), revision ${done.saved.revision}.`;
    if (!done.edits) return `Done, but nothing in the cut actually changed: ${head} Say that in one sentence; describe no edit. Nothing was rendered or exported.`;
    const n = done.edits === 1 ? '1 edit' : `${done.edits} edits`;
    return `Done — ${n}; ${head} Exactly what this call changed (nothing else changed):\n${done.lines.join('\n')}\n`
        + 'It is in the Cut already: say what you changed and why in two sentences, in editing words, naming ONLY the edits in this list. Nothing was rendered or exported.';
}

export const inspectCut = {
    name: 'inspect_cut',
    description: 'Measure the clips in the Cut and the music bed, and list the board\'s sound cards that are not in the cut: dead frames at the head and tail, silence, spoken lines, loudness, music beats, what each clip can lose. Use it before any trim, cut point, duck or level, when asked whether the cut is tight, and when asked why you cut somewhere (it shows your stored reasons for the beats you name). It reads only — it changes nothing.',
    schema: {
        type: 'object',
        properties: { beats: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Beat tags; leave out for the whole cut.' } },
    },

    async run({ beats } = {}, t) {
        const c = t.cut;
        if (!c) return { ok: false, content: NO_CUT };
        const cut = c.cuts.current(t.spaceId);
        if (!cut.items.length) return { ok: true, content: 'The cut is empty, so there is nothing to measure. Put the clips in with stitch_cut, or say there are none yet.' };
        const wanted = Array.isArray(beats) && beats.length ? new Set(beats.map((b) => String(b).toLowerCase())) : null;
        const inCut = new Set(cut.items.map((i) => i.beat_tag?.toLowerCase()));
        const absent = wanted ? [...wanted].filter((b) => !inCut.has(b)) : [];
        const list = mediaOfCut(cut).filter((m) => !wanted || m.role !== 'clip' || cut.items.some((i) => i.media_path === m.path && wanted.has(i.beat_tag?.toLowerCase())));
        if (!c.analysis.toolsMissing) await c.analysis.waitFor(list, t.inspectWaitMs ?? 3000);
        const check = checkCut({ boardCut: c.boardCut, plans: c.plans, analysis: c.analysis }, t.spaceId, cut);
        const scripts = new Map(t.spaces.board(t.spaceId).nodes.filter((n) => n.type === 'text' && /· script$/i.test(n.label ?? ''))
            .map((n) => [String(n.label).replace(/\s*·\s*script$/i, '').trim(), n.text_content]));
        const text = inspectText({
            cut, wanted, scripts, analysisOf: check.analysisOf, toolsMissing: c.analysis.toolsMissing,
            measuring: (path) => c.analysis.measuring(path), reasons: (tag) => c.turns.repo.reasonsFor(t.spaceId, tag),
            soundCards: wanted ? [] : c.boardCut.soundCards(t.spaceId),
        });
        return { ok: true, content: `${text}${absent.length ? `\nNot in the cut: ${absent.join(', ')}.` : ''}\n\nNothing has changed. Use these numbers in propose_cut_ops; a reason you give is kept with the edit.` };
    },
};

export const packAssets = {
    name: 'pack_assets',
    description: 'Pack everything this board made into one .zip in the media folder: clips, stills, sound, the words cards as text, the latest export, and a manifest with prompts, seeds and the cut. Only when the person asks to pack, collect, download or hand off the assets. It copies files; it renders and exports nothing.',
    schema: { type: 'object', properties: {} },

    async run(_input, t) {
        const c = t.cut;
        if (!c?.packer) return { ok: false, content: NO_CUT };
        if (!PACK_WORDS.test(t.request ?? '')) return { ok: false, content: 'The person did not ask to pack the assets in this message, so nothing was packed. Pack only when they ask for it in words.' };
        const running = c.exportsRepo?.active(t.spaceId, 'pack');
        if (running) return { ok: true, content: `A pack of this board is already running (${Math.round((running.progress ?? 0) * 100)} %). It will say when it is done. Nothing new was started. Do not name any buttons.` };
        const est = await c.packer.estimate(t.spaceId);
        if (!est.enough) return { ok: true, content: `Not packed: the pack needs about ${gb(est.bytes * 1.1)} free on the media folder's disk and there is ${gb(est.free)}. Say that in one sentence.` };
        const { created } = c.packer.start(t.spaceId, { includePrompts: true });
        return { ok: true, content: `Packing ${est.files} files (${gb(est.bytes)}) into "${est.name}-….zip" in the media folder${created ? '' : ' (it was already running)'}. It will say when it is done. Nothing was rendered or exported. Do not name any buttons.` };
    },
};

const gb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(0.1, Math.round(bytes / 1e5) / 10)} MB`);

/** "Remember that I never want dissolves" (05 §3.8): saved only when the person asks to remember, in words. */
export const REMEMBER_WORDS = /\b(remember|always|never|from now on|every time|my (editing )?style|keep (it|doing) that)\b/i;

export const rememberEditStyle = {
    name: 'remember_edit_style',
    description: 'Save how the person likes their cuts edited, so every later cut follows it: "I never want dissolves", "always mix to -14 LUFS", "let shots breathe". Only when they ask you to remember it, or agree when you offer. Send the WHOLE style as it should read from now on (it replaces what was saved), in their words, at most 600 characters. It changes no cut.',
    schema: { type: 'object', properties: { text: { type: 'string', description: 'The whole editing style, plain words.' } }, required: ['text'] },

    run({ text }, t) {
        if (!t.settings) return { ok: false, content: 'Editing style cannot be saved here. Say so in one sentence.' };
        if (!REMEMBER_WORDS.test(t.request ?? '') && !/\b(yes|yeah|sure|please do|ok(ay)?)\b/i.test(t.request ?? '')) {
            return { ok: false, content: 'The person did not ask you to remember a style in this message, so nothing was saved. Offer it in one sentence instead.' };
        }
        const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
        if (!clean) return { ok: false, content: '`text` is the whole editing style, in plain words.' };
        t.settings.update({ editStyle: clean });
        return { ok: true, content: `Saved. Their editing style is now: "${clean}". You will read it on every turn. Say so in one sentence; it changed no cut.` };
    },
};

export const CUT_SKILLS = [stitchCut, proposeCutOps, inspectCut, packAssets, rememberEditStyle];

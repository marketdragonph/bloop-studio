// The export sheet's P6 rows (05-irresistible.md §5.1, §5.3–§5.5). Spread into CutDock, beside cut-export.js.
// - Preset: Master, YouTube, TikTok, Reels, Shorts (export-presets.js, the one list). A platform preset shows its
//   length limit as a hint with the date it was checked, never a refusal.
// - Shapes: 16:9, 9:16, 1:1, one file per shape from one press (outputsFor: the preset's own shape uses the preset,
//   any other shape is a Master of that shape). Fit with soft bars is offered when a crop blows a clip up more than 2×.
// - Captions: Off / Burned in, with the honest note; an .srt goes beside every export. Preview GIF: 6 s from the poster.
// Every choice lives in `settings.outputs` (autosaved). Export sends the choices and, with captions on, each caption
// drawn as a PNG (public/js/cut/caption-render.js). The rows of one press share a `group_id`; the sheet shows them as
// one job ("File 2 of 3 · 9:16") and lists every file when they are done. Nothing here starts an export by itself.
import { copy } from '/shared/katana-controls.js';
import { isShipped } from '/shared/katana-phases.js';
import { FRAME, SHAPES, cropBox, frameOf, sameShape } from '/shared/cut-frame.js';
import { EXPORT_PRESETS, LIMITS_CHECKED_ON, lengthHint, outputLabel, outputsFor, presetOutput } from '/shared/export-presets.js';
import { renderCaptionPngs } from '../cut/caption-render.js';

const ENDED = new Set(['done', 'failed', 'cancelled']);
const csrfToken = () => globalThis.document?.querySelector?.('meta[name="csrf-token"]')?.content ?? '';
const noteKey = (id) => `preset${id[0].toUpperCase()}${id.slice(1)}`;
const megabytes = (bytes) => Math.max(1, Math.round(bytes / 1_000_000));

/** The presets shipped so far, in the registry's words. */
export const shippedPresets = () => Object.values(EXPORT_PRESETS).filter((p) => isShipped(p.phase))
    .map((p) => Object.freeze({ id: p.id, label: p.label, note: copy(noteKey(p.id)), platform: p.platform }));

export const cutOutputMethods = {
    cutClipSizes: {}, // media path → {width, height}, learnt as the preview loads each clip
    cutGroup: null, // { id, rows: {[exportId]: row} } for the press on screen

    /** The last preset of this space comes back with the cut (settings.outputs.preset). */
    cutAdoptOutputs() {
        const preset = this.cutOutputs().preset;
        if (preset && this.cutPresets.some((p) => p.id === preset)) this.cutPreset = preset;
    },

    // ── Shapes row ──────────────────────────────────────────────────────

    /** The shapes ticked: the saved row, else the preset's own shape (or the cut's). */
    cutShapesChosen() {
        const saved = this.cutOutputs().shapes;
        if (Array.isArray(saved) && saved.length) return SHAPES.filter((s) => saved.includes(s));
        return [EXPORT_PRESETS[this.cutPreset]?.aspect ?? this.cutPlanShape()];
    },

    cutShapeTicked(shape) {
        return this.cutShapesChosen().includes(shape);
    },

    /** Ticks or unticks a shape; the last one stays (there is always one file). */
    cutToggleExportShape(shape) {
        const now = this.cutShapesChosen();
        const next = now.includes(shape) ? now.filter((s) => s !== shape) : [...now, shape];
        if (!next.length) { this.cutAnnounce = copy('shapesOne'); return; }
        this.cutSetOutput('shapes', SHAPES.filter((s) => next.includes(s)));
        if (this.cutSheet === 'export') this.cutCheckServer(); // the server measures every clip for the soft-bars offer
    },

    /** The files one press makes, as the sheet lists them: "TikTok · 1080 × 1920", "Master 16:9 · 1920 × 1080". */
    cutExportFiles() {
        const plan = this.cutPlanShape();
        return outputsFor(this.cutPreset, this.cutShapesChosen(), plan).map(({ preset, variant }) => {
            const out = presetOutput(preset, { ...this.cutSettings, aspect: plan }, variant);
            return { key: `${preset}-${variant}`, variant, text: copy('exportFile', { label: outputLabel(preset, variant, plan), w: out.width, h: out.height }) };
        });
    },

    /** A platform's length limit, as a hint (never a refusal). */
    cutLengthHint() {
        return lengthHint(this.cutPreset, this.cutLay().export_ms) ?? '';
    },

    cutLimitsDate() {
        return LIMITS_CHECKED_ON;
    },

    // ── Soft bars ───────────────────────────────────────────────────────

    /** The preview learnt a clip's size (cut-shape.js); the sheet's soft-crop check reads it. */
    cutLearnSize(path, width, height) {
        if (!path || !(width > 0 && height > 0)) return;
        const known = this.cutClipSizes[path];
        if (known?.width === width && known?.height === height) return;
        this.cutClipSizes = { ...this.cutClipSizes, [path]: { width, height } };
    },

    /** The most any chosen shape blows a clip up (crop boxes as set): the server's probe of every clip, and the sizes
     *  the preview learnt; null when neither knows yet. */
    cutWorstUpscale() {
        const plan = this.cutPlanShape();
        const server = this.cutServerCheck?.soft_bars?.clips ?? [];
        let worst = server.length ? Math.max(...server.map((c) => Number(c.upscale) || 0)) : null;
        for (const { preset, variant } of outputsFor(this.cutPreset, this.cutShapesChosen(), plan)) {
            const out = presetOutput(preset, { ...this.cutSettings, aspect: plan }, variant);
            for (const item of this.cutModel) {
                const source = this.cutClipSizes[item.media_path];
                if (!source || sameShape(source, variant) || (variant === plan && !item.frame?.[variant])) continue;
                const { upscale } = cropBox(source, variant, frameOf(item, variant), out);
                worst = Math.max(worst ?? 0, upscale);
            }
        }
        return worst;
    },

    /** Fit with soft bars shows once a shape crops a clip (and says how soft when it knows). */
    cutSoftBarsOffered() {
        return this.cutShapesChosen().some((s) => s !== this.cutPlanShape()) || this.cutOutputs().soft_bars === true || this.cutServerCheck?.soft_bars?.offer === true;
    },

    cutSoftBarsNote() {
        const worst = this.cutWorstUpscale();
        if (worst != null && worst > FRAME.softBarsOver) return copy('softBarsSoft', { x: worst.toFixed(1) });
        return copy('softBarsNote');
    },

    cutToggleSoftBars() {
        this.cutSetOutput('soft_bars', this.cutOutputs().soft_bars !== true);
    },

    // ── Captions and GIF ────────────────────────────────────────────────

    cutSetCaptions(mode) {
        if (mode === 'burned' ? this.cutCaptionsOn() : !this.cutCaptionsOn()) return;
        this.cutCaptionsToggle();
    },

    /** On unless the person turned it off (the export makes it by default). */
    cutGifOn() {
        return this.cutOutputs().gif !== false;
    },

    cutToggleGif() {
        this.cutSetOutput('gif', !this.cutGifOn());
    },

    /** What the POST adds for P6: the choices, and each caption as a PNG when they are burned in. */
    async cutOutputsBody() {
        const outputs = this.cutOutputs();
        const on = this.cutCaptionsOn();
        const cues = on ? this.cutCues() : [];
        return {
            shapes: this.cutShapesChosen(),
            // The server makes the same cues (cut-captions.js) and takes one PNG per cue id.
            captions: on ? { mode: 'burned', images: cues.length ? await renderCaptionPngs(cues) : [] } : { mode: 'off' },
            gif: this.cutGifOn(),
            soft_bars: outputs.soft_bars === true,
        };
    },

    // ── The rows of one press ───────────────────────────────────────────

    /** The press just started: its rows (one per shape), from the POST answer. */
    cutGroupStart(data, row) {
        const rows = Array.isArray(data?.exports) ? data.exports : [];
        const groupId = row?.group_id ?? rows[0]?.group_id ?? data?.group_id ?? null;
        if (!groupId && rows.length < 2) { this.cutGroup = null; return; }
        const map = {};
        for (const r of rows) if (r?.id) map[r.id] = { id: r.id, status: r.status ?? 'queued', progress: 0, variant: r.variant ?? null, ...r };
        if (row?.id && !map[row.id]) map[row.id] = row;
        this.cutGroup = { id: groupId, rows: map };
    },

    /** A `cut_export` event for a row of the press on screen: kept, and its file fetched once it is done. */
    cutGroupNote(detail, row) {
        const group = this.cutGroup;
        const groupId = detail?.group_id ?? row?.group_id ?? null;
        if (!group || !row?.id || (group.id ? groupId !== group.id && !group.rows[row.id] : !group.rows[row.id])) return;
        const before = group.rows[row.id];
        this.cutGroup = { ...group, rows: { ...group.rows, [row.id]: { ...(before ?? {}), ...row } } };
        if (ENDED.has(row.status) && before?.status !== row.status) this.cutGroupFetch(row.id);
    },

    async cutGroupFetch(id) {
        try {
            const res = await fetch(`/spaces/${this.spaceId}/cut/exports/${id}`, { headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken() } });
            const data = res.ok ? await res.json() : null;
            const raw = data?.export ?? data;
            if (raw?.id !== id || !this.cutGroup?.rows[id]) return;
            this.cutGroup = { ...this.cutGroup, rows: { ...this.cutGroup.rows, [id]: { ...this.cutGroup.rows[id], ...raw } } };
        } catch { /* the event already said how it ended */ }
    },

    cutGroupRows() {
        return Object.values(this.cutGroup?.rows ?? {}).sort((a, b) => a.id - b.id);
    },

    /** More than one file, and one of them still to run: the sheet stays on the job. */
    cutGroupPending() {
        const rows = this.cutGroupRows();
        return rows.length > 1 && rows.some((r) => !ENDED.has(r.status)) && !rows.some((r) => ['failed', 'cancelled'].includes(r.status));
    },

    /** "File 2 of 3 · 9:16" while a press of several files runs; '' for one file. */
    cutGroupStep() {
        const rows = this.cutGroupRows();
        if (rows.length < 2) return '';
        const at = rows.findIndex((r) => !ENDED.has(r.status));
        const i = at < 0 ? rows.length - 1 : at;
        return copy('exportFileOf', { i: i + 1, n: rows.length, shape: rows[i].variant ?? '' });
    },

    /** The press's progress, every file weighted the same. */
    cutGroupPercent() {
        const rows = this.cutGroupRows();
        if (rows.length < 2) return null;
        const sum = rows.reduce((acc, r) => acc + (r.status === 'done' ? 1 : Math.max(0, Math.min(1, Number(r.progress) > 1 ? r.progress / 100 : Number(r.progress) || 0))), 0);
        return Math.round((sum / rows.length) * 100);
    },

    /** The finished files of the press, each with its shape and size, for the done sheet. */
    cutGroupFiles() {
        return this.cutGroupRows().filter((r) => r.status === 'done' && r.media_path)
            .map((r) => ({ id: r.id, variant: r.variant, media_path: r.media_path, full_path: r.full_path ?? r.media_path, size: r.bytes ? `${megabytes(r.bytes)} MB` : '' }));
    },

    async cutShowFile(file) {
        const res = await fetch('/media/reveal', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify({ path: file.media_path }),
        }).catch(() => null);
        if (!res || (res.status !== 204 && res.status !== 200)) this.cutAnnounce = copy('revealFailed');
    },

    async cutCopyFile(file) {
        try {
            await navigator.clipboard.writeText(file.full_path);
            this.cutAnnounce = copy('copied');
        } catch {
            this.cutAnnounce = file.full_path;
        }
    },
};

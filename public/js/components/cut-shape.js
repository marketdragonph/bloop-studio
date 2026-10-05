// Shapes in the dock's preview (Mini Katana P6, 05-irresistible.md §5.4–§5.5). Spread into CutDock.
// - Shape (under the preview): which of 16:9, 9:16 and 1:1 the preview shows, remembered per viewer and space. The
//   preview shows that shape exactly as the export makes it: each video is placed by cut-frame-edit.js previewFrame,
//   on cut-frame.js fitFor and cropBox, the maths NormalizeClips uses, so the pixels on screen are the file's.
// - Crop: the whole selected clip with its orange crop box (cut-reframe.js); what is cut away is greyed.
// - Soft bars: the sharp picture over a blurred, dimmed copy. The copy is the playing video drawn small on a canvas
//   and scaled up (the export blurs the same way, with LGPL filters).
// - Captions: the script's lines at the measured times (cut-captions.js captionCues, the cues the export burns and
//   writes as .srt), in the look the PNGs are drawn in (public/js/cut/caption-render.js).
// Choices that go into the file (captions, shapes, soft bars, GIF) live in `settings.outputs` and autosave;
// crop boxes live on the items (one undo step per drag or key press). Nothing here starts an export.
import { controlLabel, copy } from '/shared/katana-controls.js';
import { FRAME, SHAPES, cropBox, frameOf, sameShape } from '/shared/cut-frame.js';
import { frameText, previewFrame, withFrame } from '/shared/cut-frame-edit.js';
import { captionCues } from '/shared/cut-captions.js';
import { outputsFor, presetOutput } from '/shared/export-presets.js';
import { captionVars } from '../cut/caption-render.js';

const shapeKey = (spaceId) => `bloop-studio:cut-shape:${spaceId}`;
const BARS_MS = 66; // the blurred copy is redrawn ~15 times a second: it is a blur, not a picture
const CROP_VARS = ['--cut-crop-w', '--cut-crop-h', '--cut-crop-x', '--cut-crop-y'];
/** The cue on screen at export time `ms`, or null (cues are in time order). */
export const cueAt = (cues, ms) => cues.find((c) => ms >= c.from_ms && ms < c.to_ms) ?? null;
const ratioOf = (shape) => ({ '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 })[shape] ?? 16 / 9;

function recall(key) {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}

function remember(key, value) {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* private window: the switch still works */ }
}

export const cutShapeMethods = {
    cutShapeList: SHAPES,
    cutShapePick: null, // the viewer's pick; null = the cut's own shape
    cutCropOn: false, // the crop box editor is open
    cutCropSource: null, // {width, height} of the clip under the crop box (cut-reframe.js)
    cutCaptionLines: [], // the caption on screen now
    _cutCues: null, // memo: { sig, cues }
    _cutBarsAt: 0,
    _cutCropFocus: false,

    cutInitShape() {
        const pick = recall(shapeKey(this.spaceId));
        if (SHAPES.includes(pick)) this.cutShapePick = pick;
    },

    /** The cut's own shape (the plan's aspect), what Master makes and what the preview shows by default. */
    cutPlanShape() {
        return SHAPES.includes(this.cutSettings?.aspect) ? this.cutSettings.aspect : '16:9';
    },

    cutShapeNow() {
        return this.cutShapePick ?? this.cutPlanShape();
    },

    cutOutputs() {
        const outputs = this.cutSettings?.outputs;
        return outputs && typeof outputs === 'object' ? outputs : {};
    },

    /** One export choice into `settings.outputs` (autosaved; not an undo step, like the poster). */
    cutSetOutput(key, value) {
        const outputs = { ...this.cutOutputs() };
        if (value == null) delete outputs[key];
        else outputs[key] = value;
        this.cutSettings = { ...this.cutSettings, outputs };
        this.cutChanged();
        this.cutReframe();
    },

    cutSetShape(shape) {
        if (!SHAPES.includes(shape)) return;
        this.cutShapePick = shape === this.cutPlanShape() ? null : shape;
        remember(shapeKey(this.spaceId), shape);
        if (!this.cutCropAllowed()) this.cutCropOn = false;
        this.cutReframe();
        this.cutAnnounce = copy('shapeNow', { shape });
    },

    // ── The screen ──────────────────────────────────────────────────────

    /** The screen's CSS: its shape (the clip's own while the crop box is open) and the caption look for that shape. */
    cutScreenVars() {
        const shape = this.cutShapeNow();
        const src = this.cutCropping() ? this.cutCropSource : null;
        const ratio = src?.width > 0 && src?.height > 0 ? src.width / src.height : ratioOf(shape);
        return { '--cut-screen-ratio': String(Math.round(ratio * 10000) / 10000), ...captionVars(shape) };
    },

    /** The output frame the preview stands for (for how much a crop blows the picture up). */
    cutOutFrame(shape = this.cutShapeNow()) {
        const [{ preset }] = outputsFor(this.cutOutputs().preset ?? this.cutPreset, [shape], this.cutPlanShape());
        const out = presetOutput(preset, this.cutSettings ?? {}, shape);
        return { width: out.width, height: out.height };
    },

    /**
     * Places one preview video for the clip it holds: fit (whole clip), crop (the file's crop, to the pixel) or bars.
     * Called when a video is loaded with a clip (cut-player.js cpPrime) and after any shape or crop change.
     */
    cutFrameVideo(video, entry) {
        if (!video) return;
        if (!entry || entry.kind !== 'clip') { video.dataset.fit = 'fit'; return; }
        if (!(video.videoWidth > 0)) {
            const index = video.dataset.index;
            video.addEventListener('loadedmetadata', () => { if (video.dataset.index === index) this.cutFrameVideo(video, entry); }, { once: true });
            video.dataset.fit = 'fit';
            return;
        }
        this.cutLearnSize(entry.item?.media_path, video.videoWidth, video.videoHeight); // the sheet's soft-crop check
        const target = this.cutCropping() ? this.cutCropItem() : null;
        if (target && entry.clip === target.clip) {
            this.cutCropSource = { width: video.videoWidth, height: video.videoHeight };
            this.cutPlaceVideo(video, 'whole', {});
            return;
        }
        const shape = this.cutShapeNow();
        const { mode, vars } = previewFrame({
            item: entry.item, shape, planShape: this.cutPlanShape(), source: { width: video.videoWidth, height: video.videoHeight },
            out: this.cutOutFrame(shape), softBars: this.cutOutputs().soft_bars === true,
        });
        this.cutPlaceVideo(video, mode, vars);
    },

    cutPlaceVideo(video, mode, vars) {
        video.dataset.fit = mode;
        for (const name of CROP_VARS) {
            if (vars[name]) video.style.setProperty(name, vars[name]);
            else video.style.removeProperty(name);
        }
    },

    /** Re-places both preview videos (a shape, a crop box, soft bars or the cut changed). */
    cutReframe() {
        const lay = this.cutLay?.();
        if (!lay) return;
        for (const video of globalThis.document?.querySelectorAll?.('.cut-dock .cut-screen__video') ?? []) {
            const index = Number(video.dataset.index);
            this.cutFrameVideo(video, Number.isInteger(index) ? lay.entries[index] : null);
        }
    },

    /** Every frame while playing (cut-player.js cpUi): the caption on screen and the soft-bars backdrop. */
    cutPreviewTick(exportMs) {
        this.cutCaptionAt(exportMs);
        const now = performance.now();
        if (now - this._cutBarsAt < BARS_MS) return;
        this._cutBarsAt = now;
        this.cutDrawBars();
    },

    cutDrawBars() {
        const front = globalThis.document?.querySelector?.('.cut-dock .cut-screen__video.is-front');
        const canvas = globalThis.document?.querySelector?.('.cut-dock [data-cut-part="bars"]');
        if (!canvas) return;
        const on = front?.dataset.fit === 'bars' && front.readyState >= 2;
        canvas.classList.toggle('is-on', on);
        if (!on) return;
        try { canvas.getContext('2d')?.drawImage(front, 0, 0, canvas.width, canvas.height); } catch { /* not decodable yet */ }
    },

    // ── Crop box ────────────────────────────────────────────────────────

    /** The crop box makes sense in a shape that is not the selected clip's own (known once the clip loads). */
    cutCropAllowed() {
        return Boolean(this.cutEditable());
    },

    cutCropping() {
        return this.cutCropOn && this.cutCropAllowed();
    },

    /** The clip under the crop box: the selected one, with its index in the cut. */
    cutCropItem() {
        const item = this.cutEditable();
        return item ? { ...item, model: this.cutModel[item.clip] } : null;
    },

    cutCropFrame() {
        return frameOf(this.cutCropItem()?.model, this.cutShapeNow());
    },

    /** Crop: opens the box on the selected clip (pauses and shows that clip), or closes it. */
    cutCropToggle() {
        if (this.cutCropOn) return this.cutCropClose();
        if (!this.cutEditable()) { this.cutAnnounce = copy('posterNone'); return; }
        this.cutCropOn = true;
        this._cutCropFocus = true; // the box takes focus once the clip under it has loaded (cut-reframe.js)
        this.cutCropFollow();
        this.cutAnnounce = copy('cropOpen', { shape: this.cutShapeNow(), where: frameText(this.cutCropFrame()) });
    },

    /** Shows the selected clip under the box (paused, the playhead inside it); a new selection moves the box there. */
    cutCropFollow() {
        const item = this.cutEditable();
        if (!item) { this.cutCropOn = false; this.cutReframe(); return; }
        const player = this._cutPlayer;
        if (player?.playing()) player.toggle();
        const at = player?.exportTime?.();
        this.cutCropSource = null;
        if (!(Number.isFinite(at) && at >= item.export_ms && at < item.export_ms + item.ms)) player?.seekExport(item.export_ms + item.ms / 2);
        this.$nextTick(() => this.cutReframe());
    },

    cutCropClose() {
        this.cutCropOn = false;
        this.$nextTick(() => {
            this.cutReframe();
            document.querySelector('.cut-dock [data-control="cut.crop"]')?.focus();
        });
    },

    /** One crop edit for the clip under the box: one undo step, autosaved. `null` removes the box (centred). */
    cutSetFrame(frame, { label = controlLabel('cut.crop') } = {}) {
        const target = this.cutCropItem();
        if (!target) return false;
        const changed = this.cutCommit(label, { items: withFrame(this.cutModel, target.clip, this.cutShapeNow(), frame) });
        if (changed) this.cutAnnounce = copy('cropMoved', { where: frameText(this.cutCropFrame()) });
        this.cutReframe();
        return changed;
    },

    /** Under the preview while the box is open: how to move it, or that the clip is that shape, or that it is soft. */
    cutCropHint() {
        const source = this.cutCropSource;
        const shape = this.cutShapeNow();
        if (!(source?.width > 0)) return copy('cropHint');
        if (sameShape(source, shape)) return copy('cropSame', { shape });
        const { upscale } = cropBox(source, shape, this.cutCropFrame(), this.cutOutFrame(shape));
        return upscale > FRAME.softBarsOver ? copy('cropSoft', { x: upscale.toFixed(1) }) : copy('cropHint');
    },

    // ── Captions ────────────────────────────────────────────────────────

    /** Under the preview while Captions is on: how many, and the honest note when a clip makes its own sound
     *  (the server's check: its script card and a voice card are not both wired into it). */
    cutCaptionHint() {
        const speech = this.cutSpeechMs ?? [];
        if (!speech.length) return copy('captionsNoLines');
        const n = this.cutCues().length;
        if (!n) return copy('captionsNoScript');
        const count = copy(n === 1 ? 'captionsCountOne' : 'captionsCount', { n });
        return this.cutCaptionWhyOff() ? `${count} ${copy('captionsOwnSound')}` : count;
    },

    /** The person's choice, else the server's default: on only when every captioned clip speaks its own script. */
    cutCaptionsOn() {
        const chosen = this.cutOutputs().captions;
        if (chosen === 'burned' || chosen === 'off') return chosen === 'burned';
        return (this.cutServerCheck?.captions ?? this.cutCaptionPlan)?.default_on === true;
    },

    /** Why Captions starts off (the server's plain reason), shown in the sheet while it is off. */
    cutCaptionWhyOff() {
        return (this.cutServerCheck?.captions ?? this.cutCaptionPlan)?.why_off ?? '';
    },

    cutCaptionsToggle() {
        const on = !this.cutCaptionsOn();
        this.cutSetOutput('captions', on ? 'burned' : 'off');
        this._cutCues = null;
        this.cutCaptionAt(this._cutPlayer?.exportTime?.() ?? 0);
        this.cutAnnounce = on ? copy('captionsOn') : copy('captionsOff');
    },

    /** THE cues (cut-captions.js), rebuilt only when the cut, the measured lines or a caption fix changed. */
    cutCues() {
        const items = this.cutModel;
        const speech = this.cutSpeechMs ?? [];
        const fixes = this.cutOutputs().caption_text ?? {};
        const sig = JSON.stringify([items.map((i) => [i.id, i.beat_tag, i.in_ms, i.out_ms]), speech, fixes]);
        if (this._cutCues?.sig === sig) return this._cutCues.cues;
        const scripts = new Map(speech.filter((s) => s.text).map((s) => [s.item_id, s.text]));
        const { cues } = captionCues({
            items,
            speech: speech.filter((s) => s.item_id),
            textOf: (item) => fixes[item.beat_tag] ?? scripts.get(item.id) ?? null,
        });
        this._cutCues = { sig, cues };
        return cues;
    },

    /** The caption at export time `ms` (only while Captions is on). Assigns only when it changes. */
    cutCaptionAt(ms) {
        const cue = this.cutCaptionsOn() && Number.isFinite(ms) ? cueAt(this.cutCues(), ms) : null;
        const lines = cue?.lines ?? [];
        if (lines.join('\n') !== this.cutCaptionLines.join('\n')) this.cutCaptionLines = lines;
    },
};

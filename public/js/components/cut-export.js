// Export and Pack in the Cut dock (Mini Katana P3; 02-dock.md §5, 01-core.md §3 §6 §8, 05 §2.6 §3.6 §5).
// Spread into CutDock. The sheet is a preflight readout (length, picture, size, beats skipped by name, Check your
// cut) with the Preset choice and one Export key. Export flushes the dock's pending save first and never exports
// an older revision without saying so. The job runs on the tools queue on the server; its progress arrives ONLY
// over the board's event stream (`cut_export`, re-dispatched by generation.js as `board:cut-export`). No polling:
// one GET when the sheet opens after a reload, one when a job ends (for the file's path and card).
// Nothing here starts a render, and nothing starts an export or a pack until the person presses.
import { copy } from '/shared/katana-controls.js';
import { fmtClock } from '/shared/cut-lanes.js';
import { CUT_LIMITS } from '/shared/cut-rules.js';
import { DEFAULT_PRESET, EXPORT_PRESETS, estimateBytes, presetLine, presetOutput } from '/shared/export-presets.js';

const SAVE_WAIT_MS = 10_000;
const ACTIVE = new Set(['queued', 'running']);
const ENDED = new Set(['done', 'failed', 'cancelled']);
const csrfToken = () => globalThis.document?.querySelector?.('meta[name="csrf-token"]')?.content ?? '';
const jobKey = (spaceId, kind) => `bloop-studio:cut-${kind}:${spaceId}`;
const presetKey = (spaceId) => `bloop-studio:cut-preset:${spaceId}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function remember(key, value) {
    try { value == null ? globalThis.localStorage?.removeItem(key) : globalThis.localStorage?.setItem(key, String(value)); } catch { /* private window */ }
}

function recall(key) {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}

/** One JSON call with the CSRF header. Never throws: `status` 0 means the local server did not answer. */
async function call(method, url, body) {
    try {
        const res = await fetch(url, {
            method,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, data: await res.json().catch(() => null) };
    } catch {
        return { status: 0, data: null };
    }
}

/** A `cut_exports` row or a `cut_export` event, camel or snake case, as one shape. Progress is 0..1. */
export function jobRow(raw, base = null) {
    if (!raw || typeof raw !== 'object') return base;
    const pick = (...keys) => { for (const k of keys) if (raw[k] !== undefined) return raw[k]; return undefined; };
    const row = { ...(base ?? {}) };
    const set = (name, ...keys) => { const v = pick(...keys); if (v !== undefined) row[name] = v; };
    set('id', 'export_id', 'exportId', 'id');
    set('kind', 'kind');
    set('status', 'status');
    set('step', 'step');
    set('error', 'error');
    set('error_beat', 'error_beat', 'errorBeat');
    set('node_id', 'node_id', 'nodeId');
    set('bytes', 'bytes');
    set('media_path', 'media_path', 'mediaPath');
    set('full_path', 'full_path', 'fullPath');
    set('cut_revision', 'cut_revision', 'cutRevision', 'revision');
    set('duration_ms', 'duration_ms', 'durationMs');
    set('preset', 'preset');
    set('files', 'files');
    set('code', 'code', 'error_code');
    const report = raw.report && typeof raw.report === 'object' ? raw.report : null;
    if (report?.total_ms != null && row.duration_ms == null) row.duration_ms = report.total_ms;
    if (Array.isArray(report?.files)) row.files = report.files.length;
    else if (Number.isFinite(report?.files)) row.files = report.files;
    const progress = Number(pick('progress'));
    if (Number.isFinite(progress)) row.progress = Math.max(0, Math.min(1, progress > 1 ? progress / 100 : progress));
    row.progress ??= 0;
    return row;
}

const megabytes = (bytes) => Math.max(1, Math.round(bytes / 1_000_000));
/** The presets this phase offers, in the registry's words (export-presets.js is the one list). */
const PRESETS = Object.freeze(Object.values(EXPORT_PRESETS).filter((p) => p.phase === 'P3')
    .map((p) => Object.freeze({ id: p.id, label: p.label, note: copy(`preset${p.id[0].toUpperCase()}${p.id.slice(1)}`) })));

export const cutExportMethods = {
    cutSheet: null, // 'export' | 'pack' while its sheet is open
    cutPreset: DEFAULT_PRESET,
    cutPresets: PRESETS,
    cutLoudnessMeasured: true, // GET /cut says otherwise when the mix was not measured
    cutExport: null, // the latest export row of this space (jobRow)
    cutExportLocal: null, // 'saving' | 'unsaved' | 'starting' | 'refused' before a row exists
    cutExportRefusal: '',
    cutExportTools: false, // the refusal was "the video tools are missing"
    cutPack: null,
    cutPackLocal: null, // 'starting' | 'refused'
    cutPackRefusal: '',
    cutPackPrompts: true,
    cutFindings: [],
    cutServerCheck: null, // GET /cut/preflight when the sheet opens: the tools, the disk, a missing file

    /** Last preset and the last jobs of this space (a reload while an export runs finds it again). */
    cutInitExport() {
        const preset = recall(presetKey(this.spaceId));
        if (PRESETS.some((p) => p.id === preset)) this.cutPreset = preset;
        for (const kind of ['export', 'pack']) {
            const id = Number(recall(jobKey(this.spaceId, kind)));
            if (id > 0) this.cutFetchJob(kind, id);
        }
    },

    async cutFetchJob(kind, id) {
        const { status, data } = await call('GET', `/spaces/${this.spaceId}/cut/exports/${id}`);
        if (status === 404) { remember(jobKey(this.spaceId, kind), null); return; }
        if (status !== 200 || !data) return;
        const row = jobRow(data.export ?? data.pack ?? data);
        if (row?.id !== id) return;
        if (kind === 'pack') this.cutPack = jobRow(row, this.cutPack?.id === id ? this.cutPack : null);
        else this.cutExport = jobRow(row, this.cutExport?.id === id ? this.cutExport : null);
    },

    // ── The sheet ───────────────────────────────────────────────────────

    cutOpenSheet(kind) {
        if (this.cutSheet === kind) { this.cutCloseSheet(); return; }
        if (this.cutSheet) this.cutCloseSheet();
        this.cutSheet = kind;
        // A stop the person already saw starts over; a finished export stays (done, or stale after edits).
        if (kind === 'export' && this.cutSeen(this.cutExport) && this.cutExport.status !== 'done') this.cutExport = null;
        if (kind === 'pack' && this.cutSeen(this.cutPack)) this.cutPack = null;
        if (kind === 'export') this.cutCheckServer();
        this.$nextTick(() => document.querySelector?.(`.cut-sheet [data-sheet-focus="${kind}"]`)?.focus());
    },

    cutCloseSheet() {
        const kind = this.cutSheet;
        if (kind === 'export' && ENDED.has(this.cutExport?.status)) this.cutExport = { ...this.cutExport, seen: true };
        if (kind === 'pack' && ENDED.has(this.cutPack?.status)) this.cutPack = { ...this.cutPack, seen: true };
        if (kind === 'export' && ['refused', 'unsaved'].includes(this.cutExportLocal)) this.cutExportLocal = null;
        if (kind === 'pack' && this.cutPackLocal === 'refused') this.cutPackLocal = null;
        this.cutSheet = null;
        this.$nextTick(() => document.querySelector?.(`.cut-rail [data-control="cut.${kind}"]`)?.focus());
    },

    cutSeen(row) {
        return Boolean(row?.seen) && ENDED.has(row.status);
    },

    /** A pack that finished while its sheet was closed keeps "Packed … · Show in folder" on the rail until seen. */
    cutPackOnRail() {
        return this.cutSheet !== 'pack' && this.cutPack?.status === 'done' && !this.cutPack.seen;
    },

    cutPickPreset(id) {
        if (!PRESETS.some((p) => p.id === id)) return;
        this.cutPreset = id;
        remember(presetKey(this.spaceId), id);
        this.cutCheckServer();
    },

    /** One GET per sheet open or preset change (never a poll): what only the server knows before the press. */
    async cutCheckServer() {
        const { status, data } = await call('GET', `/spaces/${this.spaceId}/cut/preflight?preset=${encodeURIComponent(this.cutPreset)}`);
        this.cutServerCheck = status === 200 && data && typeof data === 'object' ? data : null;
    },

    /** The video tools are missing or not ready: the sheet links to Settings › Video tools. */
    cutToolsMissing() {
        return this.cutExportTools || this.cutServerCheck?.code === 'tools';
    },

    /** The preflight numbers (export time: gaps are skipped). */
    cutPreflight() {
        const lay = this.cutLay();
        const clips = lay.entries.filter((e) => e.kind === 'clip');
        const skipped = this.cutItems.filter((i) => !i.ready).map((i) => i.title);
        const output = presetOutput(this.cutPreset, this.cutSettings ?? {});
        return {
            length: fmtClock(lay.export_ms),
            clips: clips.length,
            beats: lay.entries.length,
            skipped,
            skippedText: skipped.length ? copy('exportSkipped', { names: skipped.join(', ') }) : copy('exportNoSkips'),
            size: copy('exportSize', { mb: megabytes(estimateBytes(lay.export_ms)) }),
            picture: `${output.width} × ${output.height} · ${output.fps} fps`,
        };
    },

    /** "1920 × 1080 · 30 fps · about 38 MB · −14 LUFS" for one preset (export-presets.js presetLine). */
    cutPresetLine(id) {
        return presetLine(presetOutput(id, this.cutSettings ?? {}), this.cutLay().export_ms, { measured: this.cutLoudnessMeasured });
    },

    /** Why Start is off, in plain words; '' when the cut can go. The server checks the same caps again. */
    cutExportBlock() {
        if (this.cutStatus !== 'ready') return copy('loading');
        if (this.cutDraft) return copy('exportDraft');
        if (this.cutSaveHeld()) return copy('exportHeld');
        const lay = this.cutLay();
        const clips = lay.entries.filter((e) => e.kind === 'clip').length;
        if (!clips) return copy('exportNoClips');
        if (this.cutModel.length > CUT_LIMITS.maxItems) return copy('exportTooMany', { n: this.cutModel.length });
        if (lay.export_ms > CUT_LIMITS.maxTotalMs) return copy('exportTooLong', { length: fmtClock(lay.export_ms) });
        // The server's own check: only reasons an edit here cannot change (the video tools, free disk).
        const server = this.cutServerCheck;
        if (server?.ok === false && ['tools', 'disk'].includes(server.code) && server.reason) return server.reason;
        return '';
    },

    // ── Export ──────────────────────────────────────────────────────────

    /** What the export sheet shows now. */
    cutExportState() {
        if (this.cutExportLocal) return this.cutExportLocal;
        const row = this.cutExport;
        if (!row) return 'preflight';
        if (row.status === 'done') return row.cut_revision != null && row.cut_revision < this.cutRevision ? 'stale' : 'done';
        return row.status ?? 'queued';
    },

    cutExportBusy() {
        return ['saving', 'starting'].includes(this.cutExportLocal) || ACTIVE.has(this.cutExport?.status);
    },

    /** Saves what is pending and waits for it. false = not saved (failed, refused, or a conflict to resolve). */
    async cutSaveForExport() {
        const until = Date.now() + SAVE_WAIT_MS;
        while (Date.now() < until) {
            if (this.cutSaveHeld() || this.cutSaveState === 'failed') return false;
            if (this.cutSaveState === 'saved') return true;
            if (this.cutSaveState === 'saving') await sleep(50);
            else await this.cutSaveNow();
        }
        return this.cutSaveState === 'saved';
    },

    async cutExportStart() {
        if (this.cutExportBusy() || this.cutExportBlock()) return;
        this.cutExportRefusal = '';
        this.cutExportTools = false;
        this.cutExportLocal = 'saving';
        if (!(await this.cutSaveForExport())) {
            this.cutExportLocal = 'unsaved';
            this.cutAnnounce = copy('exportUnsaved');
            return;
        }
        this.cutExportLocal = 'starting';
        const lengthMs = this.cutLay().export_ms;
        const body = { preset: this.cutPreset, revision: this.cutRevision };
        if (Number.isFinite(this.cutSettings?.poster_ms)) body.poster_ms = this.cutSettings.poster_ms;
        const { status, data } = await call('POST', `/spaces/${this.spaceId}/cut/exports`, body);
        const row = jobRow(data?.export ?? (data?.id ? data : null));
        if (status >= 200 && status < 300 && row?.id) {
            this.cutExport = jobRow({ status: 'queued', cut_revision: this.cutRevision, duration_ms: lengthMs, ...row });
            this.cutExportLocal = null;
            remember(jobKey(this.spaceId, 'export'), row.id);
            this.cutAnnounce = copy('exportStarting');
            return;
        }
        this.cutExportLocal = 'refused';
        this.cutExportRefusal = data?.error || data?.reason || copy('exportRefused');
        this.cutExportTools = ['tools', 'video_tools_missing'].includes(data?.code ?? data?.error_code) || /video tools/i.test(this.cutExportRefusal);
        this.cutAnnounce = this.cutExportRefusal;
    },

    /** Retry on "The latest changes are not saved yet": save again now, then start. */
    cutExportRetrySave() {
        this._cutRetries = 0;
        if (this.cutSaveState === 'failed') this.cutSaveState = 'unsaved';
        this.cutExportLocal = null;
        return this.cutExportStart();
    },

    async cutExportCancel() {
        const row = this.cutExport;
        if (!row?.id || !ACTIVE.has(row.status)) return;
        const { status, data } = await call('DELETE', `/spaces/${this.spaceId}/cut/exports/${row.id}`);
        const back = jobRow(data?.export ?? data);
        if (back?.id === row.id) this.cutExport = jobRow(back, this.cutExport);
        else if (status >= 200 && status < 300 && this.cutExport?.id === row.id && ACTIVE.has(this.cutExport.status)) {
            this.cutExport = { ...this.cutExport, status: 'cancelled' }; // the event confirms it; nothing was saved either way
        }
    },

    /** Try again / Export again: a fresh preflight with the same preset, then Start. */
    cutExportAgain() {
        this.cutExport = null;
        this.cutExportLocal = null;
        return this.cutExportStart();
    },

    /** "Remove it and export again": the clip the export could not read leaves the cut (one undo step), then Start. */
    async cutRemoveAndExport() {
        const tag = this.cutExport?.error_beat;
        if (!tag) return;
        const items = this.cutModel.filter((i) => i.beat_tag !== tag);
        if (items.length !== this.cutModel.length) this.cutCommit('Remove', { items });
        this.cutExport = null;
        await this.cutExportStart();
    },

    /** The beat a failed export stopped at, as the lane names it ("04 · Flashback"). */
    cutExportBeat() {
        const tag = this.cutExport?.error_beat;
        if (!tag) return '';
        const item = this.cutItems.find((i) => this.cutModel[i.clip]?.beat_tag === tag || i.title.endsWith(tag));
        return item?.title ?? tag;
    },

    cutExportBeatItem() {
        const title = this.cutExportBeat();
        return this.cutItems.find((i) => i.title === title) ?? null;
    },

    cutExportText() {
        const row = this.cutExport ?? {};
        switch (this.cutExportState()) {
            case 'saving': return copy('exportSaving');
            case 'unsaved': return copy('exportUnsaved');
            case 'starting': return copy('exportStarting');
            case 'refused': return this.cutExportRefusal;
            case 'queued': return copy('exportQueued');
            case 'running': return row.step || copy('exportRunning');
            case 'done': return copy('exportDone', { length: fmtClock(row.duration_ms ?? this.cutLay().export_ms), size: row.bytes ? `${megabytes(row.bytes)} MB` : this.cutPreflight().size });
            case 'stale': return copy('exportStale');
            case 'cancelled': return row.error || copy('exportCancelled');
            case 'failed': return row.error_beat ? copy('exportFailedAt', { beat: this.cutExportBeat() }) : (row.error || copy('exportFailed'));
            default: return '';
        }
    },

    cutExportPercent() {
        return Math.round((this.cutExport?.progress ?? 0) * 100);
    },

    /** The rail's short line while a job runs and its sheet is closed. */
    cutJobLine(kind) {
        const row = kind === 'pack' ? this.cutPack : this.cutExport;
        if (!row || !ACTIVE.has(row.status)) return '';
        const word = kind === 'pack' ? copy('packRunning') : copy('exportRunning');
        return row.status === 'queued' ? `${word}: ${copy('exportQueued').toLowerCase()}` : `${word} ${Math.round(row.progress * 100)}%`;
    },

    // ── Pack ────────────────────────────────────────────────────────────

    cutPackState() {
        if (this.cutPackLocal) return this.cutPackLocal;
        return this.cutPack?.status ?? 'ready';
    },

    async cutPackStart() {
        if (this.cutPackLocal === 'starting' || ACTIVE.has(this.cutPack?.status)) return;
        this.cutPackLocal = 'starting';
        this.cutPackRefusal = '';
        const { status, data } = await call('POST', `/spaces/${this.spaceId}/cut/pack`, { include_prompts: this.cutPackPrompts });
        const row = jobRow(data?.pack ?? data?.export ?? (data?.id ? data : null));
        if (status >= 200 && status < 300 && row?.id) {
            this.cutPack = jobRow({ status: 'queued', kind: 'pack', ...row });
            this.cutPackLocal = null;
            remember(jobKey(this.spaceId, 'pack'), row.id);
            return;
        }
        this.cutPackLocal = 'refused';
        this.cutPackRefusal = data?.error || data?.reason || copy('packFailed');
        this.cutAnnounce = this.cutPackRefusal;
    },

    cutPackAgain() {
        this.cutPack = null;
        this.cutPackLocal = null;
        return this.cutPackStart();
    },

    cutPackText() {
        const row = this.cutPack ?? {};
        switch (this.cutPackState()) {
            case 'starting': return copy('packStarting');
            case 'refused': return this.cutPackRefusal;
            case 'queued': return copy('exportQueued');
            case 'running': return row.step || copy('packRunning');
            case 'done': return copy('packDone', { files: row.files != null ? `${row.files} files` : (row.bytes ? `${megabytes(row.bytes)} MB` : 'the board') });
            case 'failed': return row.error || copy('packFailed');
            case 'cancelled': return copy('packFailed');
            default: return copy('packNote');
        }
    },

    // ── Events: `cut_export` from the board's one stream ────────────────

    onCutExport(detail) {
        const space = detail?.space_id ?? detail?.spaceId;
        if (space != null && Number(space) !== Number(this.spaceId)) return;
        const id = Number(detail?.export_id ?? detail?.exportId ?? detail?.id);
        if (!id) return;
        const isPack = detail.kind === 'pack' || this.cutPack?.id === id;
        const current = isPack ? this.cutPack : this.cutExport;
        // A job this page did not start (another window, or the Director's pack_assets) is shown once it is newer.
        if (current?.id !== id && current && ACTIVE.has(current.status)) return;
        const row = jobRow(detail, current?.id === id ? current : { kind: isPack ? 'pack' : 'export' });
        if (isPack) this.cutPack = row;
        else this.cutExport = row;
        remember(jobKey(this.spaceId, isPack ? 'pack' : 'export'), id);
        if (!ENDED.has(row.status) || current?.status === row.status) return;
        // The job ended: one GET for its file and card (the event carries only the live fields).
        this.cutFetchJob(isPack ? 'pack' : 'export', id);
        if (row.status === 'done' && !isPack) {
            this.refreshSoon?.(); // the new video card joins the board
            this.cutAnnounce = copy('exportAnnounceDone');
        } else if (row.status === 'failed') {
            this.cutAnnounce = isPack ? this.cutPackText() : this.cutExportText();
        }
    },

    // ── The finished file ───────────────────────────────────────────────

    async cutShowFolder(kind = 'export') {
        const row = kind === 'pack' ? this.cutPack : this.cutExport;
        if (!row?.media_path) return;
        const { status } = await call('POST', '/media/reveal', { path: row.media_path });
        if (status !== 204 && status !== 200) this.cutAnnounce = copy('revealFailed');
    },

    async cutCopyPath() {
        const path = this.cutExport?.full_path ?? this.cutExport?.media_path;
        if (!path) return;
        try {
            await navigator.clipboard.writeText(path);
            this.cutAnnounce = copy('copied');
        } catch {
            this.cutAnnounce = path;
        }
    },

    cutDownloadUrl() {
        const path = this.cutExport?.media_path;
        if (!path) return null;
        const name = path.split('/').pop().replace(/\.[^.]+$/, ''); // /media adds the extension back
        return `/media/${path.split('/').map(encodeURIComponent).join('/')}?download=${encodeURIComponent(name)}`;
    },

    /** Show on board: the new card may not be on the page yet; the board refreshes once, then pans to it. */
    async cutShowOnBoard() {
        const nodeId = this.cutExport?.node_id;
        if (nodeId == null) return;
        if (!this.nodeById?.(nodeId)) await this.refreshBoard?.({ tidy: false })?.catch?.(() => {});
        this.cutSheet = null;
        this.cutGoToCard({ node_id: nodeId, title: 'the export', state: 'ready' });
    },

    // ── Poster (05 §5.3): the playhead's time, in export time ───────────

    cutSetPoster() {
        const item = this.cutEditable();
        if (!item) { this.cutAnnounce = copy('posterNone'); return; }
        const at = this._cutPlayer?.exportTime?.();
        const ms = Math.round(Number.isFinite(at) ? at : (item.export_ms ?? 0) + (item.ms / 2));
        this.cutSettings = { ...this.cutSettings, poster_ms: ms };
        this.cutChanged();
        this.cutAnnounce = copy('posterSet', { time: fmtClock(ms) });
    },

    cutPosterAt(item) {
        const ms = this.cutSettings?.poster_ms;
        return Number.isFinite(ms) && item?.ready && item.export_ms != null && ms >= item.export_ms && ms < item.export_ms + item.ms;
    },
};

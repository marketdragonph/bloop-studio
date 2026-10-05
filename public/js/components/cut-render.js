// Render missing beats in the Cut dock (05-irresistible.md §2.2, owner decision 7). Spread into CutDock.
// The rail key (and the board's render readout, via the `cut:missing` / `cut:render-open` window events) opens a
// small sheet: GET /spaces/:id/render-plan says how many cards, on which models, the time on this PC (only when
// past renders measured it) or, on bloop, the credits and the balance FIRST. Only the person's press on
// "Render N cards" posts; a shortfall is refused plainly with nothing queued. Gap slots then turn into blue lights
// from the board's own `node` events. Cancel all stops the renders this press queued (the board's `queue` stream marks
// them `origin: 'render-plan'`); a card the person started with Generate keeps going. The Director never calls any of it.
import { copy } from '/shared/katana-controls.js';

const OWED = new Set(['never_rendered', 'failed']);
const csrfToken = () => globalThis.document?.querySelector?.('meta[name="csrf-token"]')?.content ?? '';

async function call(method, url) {
    try {
        const res = await fetch(url, { method, headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken() } });
        return { status: res.status, data: await res.json().catch(() => null) };
    } catch {
        return { status: 0, data: null };
    }
}

/** "about 14 min" from seconds (estimated). */
export function renderTime(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return minutes < 60 ? `about ${minutes} min, estimated` : `about ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min, estimated`;
}

/** The sheet's lines for a GET /render-plan summary: one for this PC, one for bloop. */
export function renderLines(summary) {
    if (!summary) return [];
    const lines = [];
    const { local, cloud } = summary;
    if (local?.cards) {
        lines.push(local.seconds ? copy('renderLocal', { n: local.cards, time: renderTime(local.seconds) }) : copy('renderLocalUntimed', { n: local.cards }));
    }
    if (cloud?.cards) {
        lines.push(cloud.credits != null && cloud.balance != null
            ? copy('renderCloud', { n: cloud.cards, credits: cloud.credits, balance: cloud.balance })
            : copy('renderCloudUnknown', { n: cloud.cards }));
    }
    return lines;
}

export const cutRenderMethods = {
    cutRender: null, // the sheet's summary
    cutRenderState: 'idle', // idle | loading | ready | queuing | refused | failed
    cutRenderError: '',
    _cutMissingSent: -1,

    /** Beats with no video that one press could render (never rendered, or failed). */
    cutMissingCount() {
        return (this._cutSlots ?? []).filter((s) => OWED.has(s.reason)).length;
    },

    /** Tells the board's render readout how many beats are missing (one event per change). */
    cutTellMissing() {
        const n = this.cutMissingCount(); // slots arrive with the cut, before cutStatus turns ready
        if (n === this._cutMissingSent) return;
        this._cutMissingSent = n;
        globalThis.window?.dispatchEvent?.(new CustomEvent('cut:missing', { detail: { n } }));
    },

    cutRenderKey() {
        return copy('renderKey', { n: this.cutMissingCount() });
    },

    async cutRenderOpen() {
        if (this.cutSheet !== 'render') this.cutOpenSheet('render');
        this.cutRenderState = 'loading';
        this.cutRenderError = '';
        const { status, data } = await call('GET', `/spaces/${this.spaceId}/render-plan`);
        if (status !== 200 || !data) {
            this.cutRenderState = 'failed';
            this.cutRenderError = data?.error ?? copy('renderFailed');
            return;
        }
        this.cutRender = data;
        this.cutRenderState = 'ready';
    },

    cutRenderLines() {
        return renderLines(this.cutRender);
    },

    /** Why the press is off, in plain words; '' when it can go. The server checks the same again. */
    cutRenderBlock() {
        const r = this.cutRender;
        if (!r) return '';
        if (!r.cards) return copy('renderNothing');
        if (r.blocked) return r.blocked;
        if (r.cloud?.short) return copy('renderShort', { credits: r.cloud.credits, balance: r.cloud.balance });
        if (r.cloud?.cards && (r.cloud.credits == null || r.cloud.balance == null)) return copy('renderCloudUnknown', { n: r.cloud.cards });
        return '';
    },

    /** Nothing can render on this PC or on bloop: the sheet shows Open Settings and Sign in to bloop. */
    cutRenderNoEngine() {
        return Boolean(this.cutRender?.blocked);
    },

    cutRenderConfirmText() {
        return copy('renderCards', { n: this.cutRender?.cards ?? 0 });
    },

    /** The person's press. */
    async cutRenderGo() {
        if (this.cutRenderState === 'queuing' || this.cutRenderBlock()) return;
        this.cutRenderState = 'queuing';
        const { status, data } = await call('POST', `/spaces/${this.spaceId}/render-plan`);
        if (status === 202) {
            this.cutRenderState = 'idle';
            this.cutRender = null;
            if (this.cutSheet === 'render') this.cutCloseSheet();
            this.cutAnnounce = copy('renderQueued', { n: data?.queued ?? 0 });
            this.toast?.(this.cutAnnounce, 'info');
            return;
        }
        this.cutRenderState = status === 422 ? 'refused' : 'failed';
        this.cutRenderError = data?.error ?? copy('renderFailed');
        this.cutAnnounce = this.cutRenderError;
    },

    cutRenderNotNow() {
        this.cutRenderState = 'idle';
        this.cutRender = null;
        if (this.cutSheet === 'render') this.cutCloseSheet();
    },

    /** Something of this board is rendering (a slot's blue light). */
    cutRendering() {
        return this.cutItems.some((i) => i.live);
    },

    /** Renders Render missing beats queued on this board that are still queued or running (the board's `queue` stream). */
    cutPlanRenders() {
        return (this.renderQueue ?? []).filter((job) => job.spaceId === this.spaceId && job.origin === 'render-plan').length;
    },

    /** Cancel all: the renders this press queued stop; a card's own Generate keeps going. */
    async cutCancelAll() {
        const { status, data } = await call('DELETE', `/spaces/${this.spaceId}/render-plan`);
        this.cutAnnounce = status === 200 ? copy('renderCancelled', { n: data?.cancelled ?? 0 }) : (data?.error ?? copy('renderFailed'));
    },
};

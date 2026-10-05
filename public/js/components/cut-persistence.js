// The Cut's autosave (02-dock.md §8, ported from bloop: "800 ms autosave + local draft + adopt the server
// revision on 409"). Spread into CutDock.
// - PUT /spaces/:id/cut {revision, items, sound, settings} 800 ms after the last change, CSRF header on.
// - Every change is also kept in localStorage (`bloop-studio:cut:{spaceId}`), so a crash loses nothing;
//   on load a different draft offers Restore / Discard.
// - On 409 the dock takes the server's revision IN THE SAME STEP, so "Keep mine" saves on top at once.
// - A change made while a save is in flight is saved again after it (as the board's persistence.js does).
// - pagehide flushes with fetch keepalive; a hidden window saves at once.
// - A 200 hands back the server's copy (it sets media paths and who placed each clip): with nothing typed since,
//   the dock takes it, so the next save and the restore check start from what is stored.
import { sameCut } from '/shared/cut-edit.js';

const SAVE_DELAY = 800;
const RETRIES = [2000, 5000, 15000];
const BLOCKING = new Set(['conflict', 'director']);

const draftKey = (spaceId) => `bloop-studio:cut:${spaceId}`;
const csrfToken = () => globalThis.document?.querySelector?.('meta[name="csrf-token"]')?.content ?? '';

export function readCutDraft(spaceId) {
    try {
        const draft = JSON.parse(globalThis.localStorage?.getItem(draftKey(spaceId)) || 'null');
        return draft && Array.isArray(draft.items) ? draft : null;
    } catch {
        return null;
    }
}

function writeCutDraft(spaceId, draft) {
    try { globalThis.localStorage?.setItem(draftKey(spaceId), JSON.stringify(draft)); } catch { /* private window: the save still runs */ }
}

export function clearCutDraft(spaceId) {
    try { globalThis.localStorage?.removeItem(draftKey(spaceId)); } catch { /* see writeCutDraft */ }
}

/** One PUT. Never throws: `status` 0 means the local server did not answer. */
export async function putCut(spaceId, body, { keepalive = false } = {}) {
    try {
        const res = await fetch(`/spaces/${spaceId}/cut`, {
            method: 'PUT',
            keepalive,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
            body: JSON.stringify(body),
        });
        return { status: res.status, data: await res.json().catch(() => null) };
    } catch {
        return { status: 0, data: null };
    }
}

const same = sameCut;

export const cutPersistenceMethods = {
    cutInitPersistence() {
        this._cutChanges = 0;
        this._cutRetries = 0;
        this._cutOnPageHide = () => this.cutFlush();
        this._cutOnHidden = () => { if (document.visibilityState === 'hidden') this.cutSaveNow(); };
        window.addEventListener('pagehide', this._cutOnPageHide);
        document.addEventListener('visibilitychange', this._cutOnHidden);
    },

    cutDestroyPersistence() {
        clearTimeout(this._cutSaveTimer);
        window.removeEventListener('pagehide', this._cutOnPageHide);
        document.removeEventListener('visibilitychange', this._cutOnHidden);
    },

    cutBody() {
        return { revision: this.cutRevision, items: this.cutModel, sound: this.cutSound, settings: this.cutSettings };
    },

    /** Every person's change: keep it on this device, then save 800 ms after the last one. */
    cutChanged() {
        this._cutChanges++;
        this.cutTurnEdited?.(); // the Director's strip folds into the undo history (cut-turn.js)
        writeCutDraft(this.spaceId, { revision: this.cutRevision, items: this.cutModel, sound: this.cutSound, at: Date.now() });
        if (this.cutSaveState !== 'saving') this.cutSaveState = 'unsaved';
        this.cutScheduleSave(SAVE_DELAY);
    },

    cutScheduleSave(delay) {
        clearTimeout(this._cutSaveTimer);
        this._cutSaveTimer = setTimeout(() => this.cutSaveNow(), delay);
    },

    /** A conflict banner holds the save until the person chooses; nothing is overwritten behind their back. */
    cutSaveHeld() {
        return BLOCKING.has(this.cutBanner);
    },

    cutIsClean() {
        return this.cutSaveState === 'saved' && !this.cutSaveHeld();
    },

    async cutSaveNow() {
        clearTimeout(this._cutSaveTimer);
        if (this.cutSaveState === 'saving' || this.cutSaveState === 'saved' || this.cutSaveHeld()) return;
        const sentAt = this._cutChanges;
        this.cutSaveState = 'saving';
        this.cutSaveError = '';
        const { status, data } = await putCut(this.spaceId, this.cutBody());

        if (status === 200 && data?.cut) {
            this.cutRevision = data.cut.revision ?? this.cutRevision + 1;
            this._cutRetries = 0;
            if (this._cutChanges === sentAt) {
                this.cutTakeSaved(data.cut);
                this.cutSaveState = 'saved';
                clearCutDraft(this.spaceId);
                this.cutAnnounce = this.cutCopy('saved');
            } else {
                this.cutSaveState = 'unsaved';
                this.cutScheduleSave(SAVE_DELAY);
            }
            this.cutAfterSave(data.cut); // cut-auto.js: the base for a rebase, and "the live cut is off" once
            if (this._cutEventWaiting) {
                this._cutEventWaiting = false;
                this.cutRefetchSoon();
            }
            return;
        }
        if (status === 409 && data?.cut) {
            this.cutSaveState = 'unsaved';
            // Only clips the live cut placed differ: keep the edit, add them, save again. No banner (cut-auto.js).
            if (this.cutTryRebase(data.cut)) return;
            this.cutHoldServer(data.cut, 'conflict');
            return;
        }
        this.cutSaveState = 'failed';
        // A refusal (400/422) would fail again the same way: say why and wait for the person.
        if (status >= 400 && status < 500) {
            this.cutSaveError = data?.error ?? '';
            this.cutAnnounce = this.cutSaveError || this.cutCopy('notSaved');
            return;
        }
        const delay = RETRIES[Math.min(this._cutRetries, RETRIES.length - 1)];
        this._cutRetries++;
        clearTimeout(this._cutSaveTimer);
        this._cutSaveTimer = setTimeout(() => {
            if (this.cutSaveState !== 'failed') return;
            this.cutSaveState = 'unsaved';
            this.cutSaveNow();
        }, delay);
    },

    /** The saved copy replaces ours in place (no undo step, no save); the lanes redraw only if the person would see a change. */
    cutTakeSaved(cut) {
        // A trim drag or a level slider moves the model before its one commit: leave it be; the next save adopts.
        if (this.cutDrag || this._cutLevelBefore || this._cutDuckBefore || this._cutTrimBefore) return;
        const copy = { items: cut.items ?? [], sound: cut.sound ?? null };
        const visible = !same(this.cutSnapshot(), copy);
        this.cutModel = copy.items;
        this.cutSound = copy.sound;
        if (visible) this.cutLayout();
    },

    cutRetrySave() {
        if (this.cutSaveState !== 'failed') return;
        this._cutRetries = 0;
        this.cutSaveState = 'unsaved';
        this.cutSaveNow();
    },

    /** The page is going away: one keepalive PUT, fire and forget (the local draft is the safety net). */
    cutFlush() {
        if (this.cutSaveState === 'saved' || this.cutSaveHeld()) return;
        putCut(this.spaceId, this.cutBody(), { keepalive: true });
    },

    /**
     * The server copy arrived (GET or a 409). The first load adopts it and looks for a local draft. Later:
     * an older or equal revision is ours; a clean dock takes a newer one; a dirty dock keeps the person's
     * edits on screen, takes the revision at once and asks.
     */
    cutReceive(server, { by = 'person' } = {}) {
        const revision = server.revision ?? 0;
        const copy = { items: server.items ?? [], sound: server.sound ?? null };
        if (!this._cutBooted) {
            this._cutBooted = true;
            this.cutAuto = server.auto !== false;
            this.cutAdopt(copy, revision);
            const draft = readCutDraft(this.spaceId);
            if (draft && !same({ items: draft.items, sound: draft.sound ?? copy.sound }, copy)) {
                this._cutLocal = draft;
                this.cutBanner = 'restore';
            } else if (draft) {
                clearCutDraft(this.spaceId);
            }
            return;
        }
        if (revision <= this.cutRevision) return;
        if (server.auto === false) this.cutAuto = false;
        if (this.cutIsClean()) {
            const label = { director: 'The Director changed the cut', auto: this.cutCopy('autoPlaced') }[by] ?? 'Changed in another window';
            this.cutAdopt(copy, revision, label);
            return;
        }
        // Our own save is in flight: its answer (200, or a 409 with this same copy) decides; then reload.
        if (this.cutSaveState === 'saving') { this._cutEventWaiting = true; return; }
        // The live cut placed clips while the person's edit was unsaved: keep the edit, add them (cut-auto.js).
        if (!this.cutSaveHeld() && this.cutTryRebase(server)) return;
        this.cutHoldServer(server, by === 'director' ? 'director' : 'conflict');
    },

    /** Takes the server's revision now, keeps its copy for "Use the newer version", and shows the banner. */
    cutHoldServer(server, kind) {
        this._cutServer = { items: server.items ?? [], sound: server.sound ?? null };
        this.cutSetBase(server);
        this.cutRevision = server.revision ?? this.cutRevision;
        this.cutBanner = kind;
        this.cutAnnounce = this.cutCopy(kind);
    },

    /** Shows the server copy as the cut; a later change from elsewhere is one undo step. */
    cutAdopt(copy, revision, label = null) {
        const before = this.cutSnapshot();
        const wasEmpty = !before.items.length;
        this.cutRevision = revision;
        this.cutSetBase(copy);
        if (same(before, copy)) return;
        if (label) this.cutCommit(label, copy, { before, save: false });
        else this.cutRestore(copy, { save: false });
        if (label && this._cutRingIds) this.cutRing(this.cutKeysFor(this._cutRingIds)); // node ids from CutEdits
        this._cutRingIds = null;
        if (wasEmpty && copy.items.length) this.cutFirstDraftLanded();
    },

    cutUseNewer() {
        const server = this._cutServer;
        this.cutBanner = null;
        this._cutServer = null;
        clearTimeout(this._cutSaveTimer);
        this._cutChanges++;
        this.cutSaveState = 'saved';
        clearCutDraft(this.spaceId);
        if (server) this.cutCommit('Took the newer version', server, { save: false });
    },

    cutKeepMine() {
        this.cutBanner = null;
        this._cutServer = null;
        this.cutSaveState = 'unsaved';
        this.cutSaveNow();
    },

    cutRestoreDraft() {
        const draft = this._cutLocal;
        this.cutBanner = null;
        this._cutLocal = null;
        if (draft) this.cutCommit('Restored unsaved changes', { items: draft.items, sound: draft.sound ?? this.cutSound });
    },

    cutDiscardDraft() {
        this.cutBanner = null;
        this._cutLocal = null;
        clearCutDraft(this.spaceId);
    },

    /** The rail's save chip: hidden while nothing was ever saved and nothing changed. */
    cutSaveText() {
        if (this.cutSaveHeld() || this.cutSaveState === 'failed') return this.cutCopy('notSaved');
        return this.cutSaveState === 'saved' ? this.cutCopy('saved') : this.cutCopy('saving');
    },
};

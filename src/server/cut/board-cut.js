// THE ONE READER of what the cut can hold (a port of bloop's BoardCut). Read-only: no probe, no job, no write.
// The dock, CutDraft, the export preflight and the Director all call it; the client never guesses.
//
// 1. Plan: the latest director_plans row, its beats ordered by lane, then id.
// 2. Clip per beat: the newest video card labelled with the beat tag, preferring the beat's node_ids (a renamed
//    label still matches); a card with a voice wired in (lip sync) wins.
// 3. Take: the card's newest take. 4. Length: takes.duration_ms (measured), else the asked length, UNMEASURED.
// 5. No plan: board order (top to bottom, then left to right), ORDER_GUESSED.
//    Never a cut of the cut: a card whose newest take is our own export (preset 'cut' / 'katana') is never a clip.
// 6. Beds: the audio card labelled `music bed` or `song`, and a voice bed (`voice`, `voice over`, `narration`).
// 7. Findings, never refusals: GAP, STALE, TAKES, UNMEASURED, ORDER_GUESSED, MIXED_ASPECT, RUNTIME_OFF, MISSING_FILE.
import { DirectorPlans } from '../repositories/director-plans.js';
import { cutClock } from '../../shared/cut-clock.js';

export const EXPORT_PRESETS = new Set(['cut', 'katana']);
const MUSIC_BED = /^(music bed|song)$/i;
const VOICE_BED = /^(voice|voice ?over|voice-over|narration|narrator)$/i;
const RUNTIME_SLACK = 0.15;
const RENDERING = new Set(['queued', 'generating']);

const json = (text, fallback) => {
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
};
const positive = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const pad = (n) => String(n).padStart(2, '0');
const clockText = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

/** `/media/<path>` with each segment encoded; null for no file. */
export const mediaUrl = (path) => (path ? `/media/${String(path).split('/').map(encodeURIComponent).join('/')}` : null);

/** "s4-flashback" → "Flashback"; a hand-made label stays as it is. */
export const beatTitle = (tag) => {
    const words = String(tag ?? '').replace(/^s\d+[-_ ]/i, '').replace(/[-_]+/g, ' ').trim();
    return words ? words[0].toUpperCase() + words.slice(1) : 'Untitled';
};

const isClipCard = (n) => n.type === 'video' || (n.type === 'upload' && String(n.media_mime ?? '').startsWith('video/'));
const isSoundCard = (n) => n.type === 'audio' || (n.type === 'upload' && String(n.media_mime ?? '').startsWith('audio/'));

export class BoardCut {
    /** @param {{ db: import('node:sqlite').DatabaseSync, exists?: (mediaPath: string) => boolean }} deps */
    constructor({ db, exists = () => true }) {
        this.db = db;
        this.plans = new DirectorPlans(db);
        this.exists = exists;
    }

    /**
     * @param {number} spaceId
     * @param {{ cut?: { items: object[] } }} [options] the stored cut, for STALE and its clock
     * @returns {{ plan_id: number|null, guessed: boolean, slots: object[], beds: object[], findings: object[], clock: { total_ms: number, gaps_ms: number } }}
     */
    read(spaceId, { cut = null } = {}) {
        const board = this.#board(spaceId);
        const plan = this.plans.latest(spaceId);
        const beats = plan ? this.plans.beats(plan.id) : [];
        const guessed = beats.length === 0;
        const slots = guessed ? this.#guessed(board) : this.#planned(board, beats, plan);
        const beds = this.#beds(board);
        const clock = this.#clock(slots, cut?.items ?? []);
        const findings = this.#findings({ board, slots, plan, guessed, clock, items: cut?.items ?? [] });
        return { plan_id: plan?.id ?? null, guessed, slots, beds, findings, clock };
    }

    #board(spaceId) {
        const nodes = this.db.prepare(`
            SELECT id, type, label, position_x, position_y, status, error, media_path, media_mime, settings
            FROM space_nodes WHERE space_id = ? ORDER BY id
        `).all(spaceId).map((n) => ({ ...n, settings: json(n.settings, {}) }));
        const takes = this.db.prepare(`
            SELECT t.id, t.node_id, t.media_path, t.media_mime, t.preset, t.duration_ms FROM takes t
            JOIN space_nodes n ON n.id = t.node_id WHERE n.space_id = ? ORDER BY t.id DESC
        `).all(spaceId);
        const wires = this.db.prepare('SELECT from_node_id, to_node_id, to_socket FROM space_connections WHERE space_id = ?').all(spaceId);
        const newest = new Map();
        const counts = new Map();
        for (const t of takes) {
            if (!newest.has(t.node_id)) newest.set(t.node_id, t);
            counts.set(t.node_id, (counts.get(t.node_id) ?? 0) + 1);
        }
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const lipSynced = new Set(wires.filter((w) => w.to_socket === 'audio').map((w) => w.to_node_id));
        const firstFrame = new Map(wires.filter((w) => w.to_socket === 'first_frame').map((w) => [w.to_node_id, w.from_node_id]));
        const ownExport = (n) => EXPORT_PRESETS.has(newest.get(n.id)?.preset);
        return { nodes, byId, newest, counts, lipSynced, firstFrame, ownExport };
    }

    /** What a card can play: its newest take, else an uploaded file. */
    #source(board, node) {
        const take = board.newest.get(node.id);
        if (take) return { take_id: take.id, media_path: take.media_path, duration_ms: take.duration_ms };
        return node.media_path ? { take_id: null, media_path: node.media_path, duration_ms: null } : null;
    }

    #planned(board, beats, plan) {
        const clips = board.nodes.filter((n) => isClipCard(n) && !board.ownExport(n));
        return beats.map((beat, i) => {
            const ids = new Set(beat.node_ids ?? []);
            const rank = (n) => [board.lipSynced.has(n.id) ? 1 : 0, ids.has(n.id) ? 1 : 0, n.id];
            const node = clips
                .filter((n) => ids.has(n.id) || same(n.label, beat.tag))
                .sort((a, b) => { const [x, y] = [rank(a), rank(b)]; return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; })[0];
            const base = { index: i + 1, beat_tag: beat.tag, lane: beat.lane, label: `${pad(i + 1)} · ${beatTitle(beat.tag)}`, plan_aspect: plan.aspect ?? null };
            if (node) return this.#slot(board, node, base);
            // The lane was laid (node_ids) and one of its cards is gone: its clip card was deleted. A lane whose
            // cards are all still on the board never had a video card, so that beat is simply not rendered.
            const deleted = [...ids].some((id) => !board.byId.has(id));
            return { ...base, ...EMPTY_SLOT, state: deleted ? 'deleted' : 'missing', reason: deleted ? 'card_deleted' : 'never_rendered' };
        });
    }

    #guessed(board) {
        return board.nodes
            .filter((n) => isClipCard(n) && !board.ownExport(n))
            .sort((a, b) => a.position_y - b.position_y || a.position_x - b.position_x || a.id - b.id)
            .map((node, i) => this.#slot(board, node, {
                index: i + 1, beat_tag: node.label?.trim() || `card-${node.id}`, lane: null,
                label: `${pad(i + 1)} · ${node.label?.trim() || `Video ${node.id}`}`, plan_aspect: null,
            }));
    }

    #slot(board, node, base) {
        const src = this.#source(board, node);
        let state = 'ready';
        let reason = null;
        if (RENDERING.has(node.status)) [state, reason] = ['rendering', 'rendering'];
        else if (src && !this.exists(src.media_path)) [state, reason] = ['missing', 'file_missing'];
        else if (!src && node.status === 'failed') [state, reason] = ['failed', 'failed'];
        else if (!src) [state, reason] = ['missing', 'never_rendered'];
        const measured = src?.duration_ms != null;
        const poster = board.byId.get(board.firstFrame.get(node.id));
        return {
            ...base,
            node_id: node.id,
            take_id: src?.take_id ?? null,
            state,
            reason,
            seconds: measured ? src.duration_ms / 1000 : null,
            planned_seconds: positive(node.settings?.duration),
            measured,
            media_url: state === 'ready' || state === 'rendering' ? mediaUrl(src?.media_path) : null,
            media_path: state === 'ready' ? src.media_path : null, // the snapshot a draft pins
            poster_url: poster?.media_path ? mediaUrl(poster.media_path) : null,
            aspect: node.settings?.aspect ?? base.plan_aspect,
            takes: board.counts.get(node.id) ?? 0,
            error: state === 'failed' ? node.error ?? null : null,
        };
    }

    #beds(board) {
        const beds = [];
        for (const [kind, pattern] of [['music', MUSIC_BED], ['voice', VOICE_BED]]) {
            const node = board.nodes
                .filter((n) => isSoundCard(n) && pattern.test(n.label?.trim() ?? '') && !board.ownExport(n))
                .map((n) => ({ n, src: this.#source(board, n) }))
                .filter(({ src }) => src && this.exists(src.media_path))
                .sort((a, b) => b.n.id - a.n.id)[0];
            if (!node) continue;
            const measured = node.src.duration_ms != null;
            beds.push({
                node_id: node.n.id, take_id: node.src.take_id, label: node.n.label.trim(), kind,
                media_url: mediaUrl(node.src.media_path), media_path: node.src.media_path, seconds: measured ? node.src.duration_ms / 1000 : null, measured,
            });
        }
        return beds;
    }

    /** Export time: the stored items when there are any, else the ready slots back to back. Gaps: the rest. */
    #clock(slots, items) {
        const lengthMs = (s) => Math.round(((s.seconds ?? s.planned_seconds) || 0) * 1000);
        const gaps = slots.filter((s) => s.state !== 'ready').reduce((sum, s) => sum + lengthMs(s), 0);
        if (items.length) return { total_ms: cutClock(items).total_ms, gaps_ms: gaps };
        return { total_ms: slots.filter((s) => s.state === 'ready').reduce((sum, s) => sum + lengthMs(s), 0), gaps_ms: gaps };
    }

    #findings({ board, slots, plan, guessed, clock, items }) {
        const out = [];
        const add = (code, text, slot = null) => out.push({ code, text, beat_tag: slot?.beat_tag ?? null, node_id: slot?.node_id ?? null });
        if (guessed && slots.length) add('ORDER_GUESSED', 'No plan on this board: clips are in board order, top to bottom.');
        for (const s of slots) {
            if (s.reason === 'file_missing') add('MISSING_FILE', `${s.label}: its file is missing from the media folder.`, s);
            else if (s.state !== 'ready') add('GAP', `${s.label} has no video yet.`, s);
            if (s.state === 'ready' && !s.measured) add('UNMEASURED', `${s.label} was not measured; its length is the asked length.`, s);
            if (s.takes > 1) add('TAKES', `${s.label} has ${s.takes} takes.`, s);
        }
        for (const item of items) {
            const newest = board.newest.get(item.node_id);
            const slot = slots.find((s) => s.node_id === item.node_id);
            if (item.take_id && newest && newest.id > item.take_id) add('STALE', `${slot?.label ?? item.beat_tag}: a newer take is ready.`, slot ?? item);
        }
        const aspects = [...new Set(slots.filter((s) => s.state === 'ready' && s.aspect).map((s) => s.aspect))];
        if (aspects.length > 1) add('MIXED_ASPECT', `Clips have different shapes: ${aspects.join(', ')}.`);
        const runtimeMs = (plan?.runtime_seconds ?? 0) * 1000;
        if (runtimeMs && clock.total_ms && Math.abs(clock.total_ms - runtimeMs) > runtimeMs * RUNTIME_SLACK) {
            add('RUNTIME_OFF', `The cut is ${clockText(clock.total_ms)}; the plan asked for ${clockText(runtimeMs)}.`);
        }
        return out;
    }
}

const EMPTY_SLOT = Object.freeze({
    node_id: null, take_id: null, seconds: null, planned_seconds: null, measured: false,
    media_url: null, media_path: null, poster_url: null, aspect: null, takes: 0, error: null,
});

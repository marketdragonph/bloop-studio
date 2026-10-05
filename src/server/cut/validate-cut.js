// Checks and cleans a cut before CutEdits saves it (01-core.md §2). The shared rules (src/shared/cut-rules.js) say
// what a cut may hold; this file adds what only the server knows: the card is on THIS board and can play, the
// take came from that card, and the clip's real (measured) length. The server is the source of media paths:
// a path from the page is never stored, it comes from the take, the card, or the stored snapshot.
//
// A card deleted from the board stays in the cut as its snapshot (media_path + seconds_ms) until the person
// removes it, so a save that still carries it is not refused. A card that was never in the cut must be on the board.
import { randomUUID } from 'node:crypto';
import { CUT_LIMITS, DISSOLVE, FADE_OUT, MUSIC_LEVEL, VOICE_LEVEL, DUCK, checkItems, checkSettings, checkSound } from '../../shared/cut-rules.js';

const UNMEASURED_MS = 5000; // the length the dock shows for a clip nobody measured or asked a length for

/** A save the rules refuse; `message` is the plain reason (422). */
export class CutInvalidError extends Error {}

const json = (text) => {
    try {
        return JSON.parse(text ?? '{}') ?? {};
    } catch {
        return {};
    }
};
const int = (value) => (value == null || value === '' ? null : Number.isFinite(Number(value)) ? Math.round(Number(value)) : Number.NaN);
const positiveMs = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : null);
const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

const isClip = (n) => n.type === 'video' || (n.type === 'upload' && String(n.media_mime ?? '').startsWith('video/'));
const isSound = (n) => n.type === 'audio' || (n.type === 'upload' && String(n.media_mime ?? '').startsWith('audio/'));

export class CutValidator {
    /** @param {{ db: import('node:sqlite').DatabaseSync }} deps */
    constructor({ db }) {
        this.db = db;
    }

    /**
     * @param {number} spaceId
     * @param {{ items: object[], sound?: object|null, settings?: object }} input  what the page (or a draft) sends
     * @param {{ items: object[], previous_items?: object[]|null, sound: object|null, settings: object }} stored  the saved cut
     * @returns {{ items: object[], sound: object|null|undefined, settings: object }} clean values; sound undefined = keep
     * @throws {CutInvalidError}
     */
    validate(spaceId, input, stored) {
        if (!Array.isArray(input?.items)) throw new CutInvalidError('The cut must be a list of clips.');
        if (input.items.length > CUT_LIMITS.maxItems) {
            throw new CutInvalidError(`A cut holds at most ${CUT_LIMITS.maxItems} clips; this one has ${input.items.length}.`);
        }
        const snapshots = new Map([...(stored.previous_items ?? []), ...stored.items].map((i) => [i.id, i]));
        const items = input.items.map((raw, index) => this.#item(spaceId, raw, index, snapshots));
        this.#refuse(checkItems(items));

        const sound = input.sound === undefined ? undefined : this.#sound(spaceId, input.sound, stored.sound);
        if (sound !== undefined) this.#refuse(checkSound(sound));

        const settings = { ...stored.settings, ...(input.settings ?? {}) };
        this.#refuse(checkSettings(settings));
        return { items, sound, settings: { resolution: settings.resolution, fps: settings.fps, ...(settings.aspect ? { aspect: settings.aspect } : {}) } };
    }

    #refuse(reason) {
        if (reason) throw new CutInvalidError(reason);
    }

    #node(id) {
        return this.db.prepare('SELECT id, space_id, type, label, media_path, media_mime, settings FROM space_nodes WHERE id = ?').get(id) ?? null;
    }

    #take(id) {
        return this.db.prepare('SELECT id, node_id, media_path, duration_ms FROM takes WHERE id = ?').get(id) ?? null;
    }

    /** Where a card's media comes from: the pinned take (it must be this card's), else the card's own file. */
    #source(node, takeId, what) {
        if (takeId == null) {
            if (!node.media_path) throw new CutInvalidError(`${what} has no file yet.`);
            return { take_id: null, media_path: node.media_path, measured_ms: null };
        }
        const take = Number.isInteger(takeId) ? this.#take(takeId) : null;
        if (!take || take.node_id !== node.id) throw new CutInvalidError(`${what}: that take is not from its card.`);
        return { take_id: take.id, media_path: take.media_path, measured_ms: positiveMs(take.duration_ms) };
    }

    #item(spaceId, raw, index, snapshots) {
        const what = `Clip ${index + 1}`;
        if (!raw || typeof raw !== 'object') throw new CutInvalidError(`${what} is not a clip.`);
        const id = raw.id == null ? randomUUID() : raw.id;
        const nodeId = int(raw.node_id);
        const takeId = int(raw.take_id);
        const node = Number.isInteger(nodeId) ? this.#node(nodeId) : null;
        const snapshot = snapshots.get(id);
        let pinned;
        if (node) {
            if (node.space_id !== spaceId) throw new CutInvalidError(`${what} is a card on another board.`);
            if (!isClip(node)) throw new CutInvalidError(`${what} is not a video card.`);
            const source = this.#source(node, takeId, what);
            const asked = positiveMs(json(node.settings).duration * 1000);
            pinned = {
                take_id: source.take_id,
                media_path: source.media_path,
                seconds_ms: source.measured_ms ?? positiveMs(raw.seconds_ms) ?? asked ?? UNMEASURED_MS,
                beat_tag: text(raw.beat_tag, CUT_LIMITS.tagMax) ?? text(node.label, CUT_LIMITS.tagMax) ?? `card-${node.id}`,
            };
        } else if (snapshot && snapshot.node_id === nodeId) {
            // The card left the board; the cut keeps its snapshot until the person removes the clip.
            pinned = { take_id: snapshot.take_id ?? null, media_path: snapshot.media_path, seconds_ms: snapshot.seconds_ms, beat_tag: snapshot.beat_tag };
        } else {
            throw new CutInvalidError(`${what}: its card is not on this board.`);
        }
        const join = this.#join(raw.join);
        return {
            id: typeof id === 'string' ? id : String(id),
            node_id: nodeId,
            ...pinned,
            in_ms: int(raw.in_ms) ?? 0,
            out_ms: int(raw.out_ms) ?? pinned.seconds_ms,
            sound: raw.sound === undefined ? true : raw.sound,
            join,
            ...(raw.note != null ? { note: raw.note } : {}),
        };
    }

    #join(raw) {
        if (raw == null) return { type: 'cut' };
        if (typeof raw !== 'object') return { type: raw };
        const join = { type: raw.type ?? 'cut' };
        if (join.type === 'dissolve') join.ms = raw.ms == null ? DISSOLVE.default : int(raw.ms);
        const audio = int(raw.audio_ms);
        if (audio) join.audio_ms = audio;
        return join;
    }

    /** A bed: the card must be a sound card on this board (or the stored snapshot of one that left). */
    #bed(spaceId, raw, kind, storedBed) {
        if (raw == null) return null;
        const what = kind === 'music' ? 'The music' : 'The voice';
        if (typeof raw !== 'object') throw new CutInvalidError(`${what} is not readable.`);
        const nodeId = int(raw.node_id);
        const node = Number.isInteger(nodeId) ? this.#node(nodeId) : null;
        let pinned;
        if (node) {
            if (node.space_id !== spaceId) throw new CutInvalidError(`${what} is a card on another board.`);
            if (!isSound(node)) throw new CutInvalidError(`${what} is not a sound card.`);
            const source = this.#source(node, int(raw.take_id), what);
            pinned = { take_id: source.take_id, media_path: source.media_path };
        } else if (storedBed && storedBed.node_id === nodeId) {
            pinned = { take_id: storedBed.take_id ?? null, media_path: storedBed.media_path };
        } else {
            throw new CutInvalidError(`${what}: its card is not on this board.`);
        }
        const level = kind === 'music' ? MUSIC_LEVEL : VOICE_LEVEL;
        const bed = { node_id: nodeId, ...pinned, gain_db: int(raw.gain_db) ?? level.default };
        if (kind === 'music') {
            bed.fade_out_ms = int(raw.fade_out_ms) ?? FADE_OUT.default;
            if (raw.duck != null) bed.duck = { depth_db: int(raw.duck?.depth_db) ?? DUCK.default, attack_ms: DUCK.attack_ms, release_ms: DUCK.release_ms };
        } else {
            bed.start_ms = int(raw.start_ms) ?? 0;
        }
        return bed;
    }

    #sound(spaceId, raw, stored) {
        if (raw == null) return null;
        if (typeof raw !== 'object' || Array.isArray(raw)) throw new CutInvalidError('The cut\'s sound is not readable.');
        for (const kind of Object.keys(raw)) if (kind !== 'music' && kind !== 'voice') throw new CutInvalidError(`The cut has no ${kind} track.`);
        const music = this.#bed(spaceId, raw.music, 'music', stored?.music);
        const voice = this.#bed(spaceId, raw.voice, 'voice', stored?.voice);
        if (!music && !voice) return null;
        return { ...(music ? { music } : {}), ...(voice ? { voice } : {}) };
    }
}

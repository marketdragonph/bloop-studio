// Starter boards (05-irresistible.md §2.4): a full plan with no key and no internet. One press lays out wired text,
// picture, clip and music-bed cards with beat tags and editable words, plus a `director_plans` row and its beats,
// so BoardCut, Render missing beats, the live cut and the Director all see a normal, finished plan. Briefs only: no
// media ships with a starter. Cards go through BoardOps (one transaction, all or nothing). Card models follow the
// one rule in src/shared/card-source.js: with no engine and a bloop sign-in, they start on bloop's models.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { now } from '../db/database.js';
import { ValidationError } from '../repositories/spaces.js';
import { musicFamily } from '../../shared/card-source.js';

const STARTERS_DIR = fileURLToPath(new URL('../../shared/starters/', import.meta.url));
const SONG_SECONDS = [15, 30, 60, 90, 120, 180];

/** Every starter, in a fixed order (file name). */
export function loadStarters(dir = STARTERS_DIR) {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
        .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

/** The op list that lays a starter out: one lane per beat (words → still → clip), then music, then voice. */
export function starterOps(starter, families = {}) {
    const ops = []; // never a title op: a space the person named keeps its name
    const knobs = (type) => (families[type] ? { settings: { family: families[type] } } : {});
    starter.beats.forEach((beat, i) => {
        const lane = i + 1;
        const ref = `b${lane}`;
        ops.push(
            { op: 'note', ref: `${ref}-words`, lane, stage: 1, title: `${beat.tag} words`, body: beat.shot },
            { op: 'node', ref: `${ref}-still`, lane, stage: 2, type: 'image', title: `${beat.tag} still`, aspect_ratio: starter.aspect, ...knobs('image') },
            { op: 'node', ref: `${ref}-clip`, lane, stage: 3, type: 'video', title: beat.tag, aspect_ratio: starter.aspect, duration: starter.clip_seconds, ...knobs('video') },
            { op: 'wire', from: `${ref}-words`, to: `${ref}-still`, socket: 'prompt' },
            { op: 'wire', from: `${ref}-words`, to: `${ref}-clip`, socket: 'prompt' },
            { op: 'wire', from: `${ref}-still`, to: `${ref}-clip`, socket: 'first_frame' },
        );
    });
    let lane = starter.beats.length + 1;
    if (starter.music) {
        const song = SONG_SECONDS.find((s) => s >= starter.runtime_seconds) ?? SONG_SECONDS.at(-1);
        ops.push(
            { op: 'note', ref: 'music-words', lane, stage: 1, title: 'music style', body: starter.music.style },
            { op: 'node', ref: 'music-bed', lane, stage: 2, type: 'audio', title: 'music bed', duration: song, ...(families.music ? { settings: { family: families.music } } : {}) },
            { op: 'wire', from: 'music-words', to: 'music-bed', socket: 'prompt' },
        );
        lane += 1;
    }
    if (starter.voice) {
        // The voice renders only on a bloop voice model the person picks on its card (Render missing beats says so).
        ops.push(
            { op: 'note', ref: 'voice-words', lane, stage: 1, title: 'voice line', body: starter.voice.line },
            { op: 'node', ref: 'voice-bed', lane, stage: 2, type: 'audio', title: 'voice' },
            { op: 'wire', from: 'voice-words', to: 'voice-bed', socket: 'prompt' },
        );
    }
    return ops;
}

export class StarterBoards {
    /**
     * @param {{ db, spaces: import('../repositories/spaces.js').SpacesRepository, plans: import('../repositories/director-plans.js').DirectorPlans,
     *   ops: import('../director/ops/board-ops.js').BoardOps, sources?: (type: string) => Promise<{ kind: string, family: string|null, families: object[] }>, starters?: object[] }} deps
     */
    constructor({ db, spaces, plans, ops, sources = null, starters = loadStarters() }) {
        Object.assign(this, { db, spaces, plans, ops, sources, starters });
    }

    /** What the modal lists. */
    list() {
        return this.starters.map(({ id, title, line, approach }) => ({ id, title, line, approach }));
    }

    find(id) {
        return this.starters.find((s) => s.id === id) ?? null;
    }

    /** Cloud-only (no engine, signed in): the cards start on bloop's models; else the cards keep no pick. */
    async #families() {
        if (!this.sources) return {};
        const [image, video, audio] = await Promise.all(['image', 'video', 'audio'].map((t) => this.sources(t)));
        const cloud = (s) => (s.kind === 'cloud' ? s.family : null);
        return { image: cloud(image), video: cloud(video), music: audio.kind === 'cloud' ? musicFamily(audio.families)?.id ?? null : null };
    }

    /**
     * Lays a starter out on an EMPTY board. @returns {{ plan: object, nodes: object[] }}
     * @throws {ValidationError} unknown starter, or a board that already has cards
     */
    async apply(spaceId, starterId) {
        const starter = this.find(starterId);
        if (!starter) throw new ValidationError('That starter does not exist.');
        const board = this.spaces.board(spaceId);
        if (!board) throw new ValidationError('That space no longer exists.');
        if (board.nodes.length || this.plans.latest(spaceId)) throw new ValidationError('Starters go on an empty board. Make a new space for this one.');
        const families = await this.#families();
        // BoardOps and saveBeats each run in their own transaction (SQLite has no nested BEGIN): if the plan cannot
        // be written, the cards just laid are taken off again, so a half starter never stays on the board.
        const applied = this.ops.apply(spaceId, starterOps(starter, families), { origin: { x: 0, y: 0 }, aspect: starter.aspect });
        try {
            return this.#plan(spaceId, starter, applied);
        } catch (error) {
            for (const node of applied.nodes) this.spaces.deleteNode(spaceId, node.id);
            this.db.prepare('DELETE FROM director_plans WHERE space_id = ?').run(spaceId);
            throw error;
        }
    }

    #plan(spaceId, starter, applied) {
        const stamp = now();
        const plan = this.plans.create(spaceId, { approach: starter.approach, aspect: starter.aspect, runtimeSeconds: starter.runtime_seconds });
        // A finished plan, as a Director build leaves it: the rail stages applied, every beat written.
        this.plans.update(plan.id, { origin_x: 0, origin_y: 0, dispatched_at: stamp, built_at: stamp });
        for (const stage of ['cast', 'world']) this.plans.apply(plan.id, stage, { plates: [] });
        this.plans.apply(plan.id, 'beats', { starter: starter.id, count: starter.beats.length, runtime_seconds: starter.runtime_seconds });
        const beats = this.plans.saveBeats(plan.id, starter.beats.map((b, i) => ({ tag: b.tag, lane: i + 1, brief: b.brief, staging: { role: b.role } })));
        for (const [i, beat] of beats.entries()) {
            const lane = `b${i + 1}`;
            const ids = ['words', 'still', 'clip'].map((part) => applied.refs[`${lane}-${part}`]).filter(Boolean);
            this.plans.setBeat(beat.id, { node_ids: ids, state: 'written', finished_at: stamp });
        }
        return { plan: this.plans.find(plan.id), nodes: applied.nodes };
    }
}

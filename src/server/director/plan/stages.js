// The build in stages (bloop's BuildStages): the rail goes down cast first, then the places and props, then the
// beats. A stage is applied once; a stage the board refused stays owed. The plan pins one origin, so the rail,
// the bed, the look and every beat line up as one block.
import { BoardOpsRejected } from '../ops/board-ops.js';
import { cleanPlates, railMap, railOps } from './plates.js';

export const RAIL_STAGES = ['cast', 'world'];

export class BuildStages {
    constructor({ plans, ops, spaces }) {
        this.plans = plans;
        this.ops = ops;
        this.spaces = spaces;
    }

    owed(plan) {
        return RAIL_STAGES.filter((s) => this.plans.stage(plan.id, s)?.state !== 'applied');
    }

    /** plan_board's proposal: the cleaned plates split into the cast stage and the world stage. */
    propose(plan, plates) {
        const clean = cleanPlates(plates);
        const cast = clean.filter((p) => p.kind === 'cast');
        const world = clean.filter((p) => p.kind !== 'cast');
        if (cast.length || !this.plans.stage(plan.id, 'cast')) this.plans.propose(plan.id, 'cast', { plates: cast });
        if (world.length || !this.plans.stage(plan.id, 'world')) this.plans.propose(plan.id, 'world', { plates: world });
        return { cast: cast.length, world: world.length };
    }

    /** Pins the plan's origin the first time anything of it lands. */
    origin(plan) {
        const fresh = this.plans.find(plan.id); // a plan object in hand may predate the pin
        if (fresh.origin_x !== null && fresh.origin_x !== undefined) return { x: fresh.origin_x, y: fresh.origin_y };
        const nodes = this.spaces.board(plan.space_id).nodes;
        const right = nodes.length ? Math.max(...nodes.map((n) => n.position_x + (n.width || 280))) + 160 : 0;
        const top = nodes.length ? Math.min(...nodes.map((n) => n.position_y)) : 0;
        const o = { x: Math.round(right / 20) * 20, y: Math.round(top / 20) * 20 };
        this.plans.update(plan.id, { origin_x: o.x, origin_y: o.y });
        return o;
    }

    /**
     * Lays every owed stage up to `through` ('cast' | 'world'). Plates sent now replace that stage's proposal.
     * Returns { made, applied: [stages], refused, actions }.
     */
    advance(plan, through, sentPlates = [], { withVoice = false } = {}) {
        const upTo = RAIL_STAGES.indexOf(through === 'all' ? 'world' : through);
        const sent = cleanPlates(sentPlates);
        let made = 0;
        const applied = [];
        const actions = [];
        for (const stage of RAIL_STAGES.slice(0, Math.max(0, upTo) + 1)) {
            if (!this.owed(plan).includes(stage)) continue;
            const ofStage = sent.filter((p) => (stage === 'cast' ? p.kind === 'cast' : p.kind !== 'cast'));
            if (ofStage.length) this.plans.propose(plan.id, stage, { plates: ofStage });
            const plates = (this.plans.stage(plan.id, stage)?.payload.plates ?? []).filter((p) => !plan.plates[p.tag]);
            if (plates.length) {
                const firstLane = Object.keys(plan.plates).length + 1;
                try {
                    const result = this.ops.apply(plan.space_id, railOps(plates, firstLane, { withVoice }), { origin: this.origin(plan), aspect: '16:9' });
                    plan = this.plans.update(plan.id, { plates: { ...plan.plates, ...railMap(plates, result.refs) } });
                    made += result.nodes.length;
                    actions.push(...result.actions);
                } catch (error) {
                    if (error instanceof BoardOpsRejected) return { made, applied, refused: true, reasons: error.reasons, actions, plan };
                    throw error;
                }
            }
            this.plans.apply(plan.id, stage);
            applied.push(stage);
        }
        return { made, applied, refused: false, actions, plan };
    }

    /** The music bed: one audio card under the whole cut, a style note on Words and, for a song, lyrics on Lyrics. */
    bed(plan, { music, lyrics, seconds }) {
        if (!music) return { made: 0, actions: [] };
        const board = this.spaces.board(plan.space_id);
        if (board.nodes.some((n) => n.type === 'audio' && /^(music bed|song)$/i.test(n.label ?? ''))) return { made: 0, actions: [] };
        const lane = Object.keys(plan.plates).length + 1;
        const song = Boolean(String(lyrics ?? '').trim());
        const ops = [
            { op: 'note', ref: 'bed-style', title: song ? 'song style' : 'music bed', body: String(music).trim(), lane, stage: 1 },
            ...(song ? [{ op: 'note', ref: 'bed-lyrics', title: 'song lyrics', body: String(lyrics).trim().slice(0, 3000), lane, stage: 2 }] : []),
            { op: 'node', ref: 'bed', type: 'audio', label: song ? 'song' : 'music bed', lane, stage: 3, duration: Math.min(180, Math.max(15, seconds || 60)) },
            { op: 'wire', from: 'bed-style', to: 'bed', socket: 'prompt' },
            ...(song ? [{ op: 'wire', from: 'bed-lyrics', to: 'bed', socket: 'lyrics' }] : []),
        ];
        const result = this.ops.apply(plan.space_id, ops, { origin: this.origin(plan), aspect: '16:9' });
        return { made: result.nodes.length, actions: result.actions };
    }

    /** The look: one card for the whole piece, palette and grade together, wired into every still. */
    look(plan, look) {
        if (!String(look ?? '').trim()) return { id: null, made: 0, actions: [] };
        const board = this.spaces.board(plan.space_id);
        const existing = board.nodes.find((n) => n.type === 'text' && /^the look$/i.test(n.label ?? ''));
        if (existing) return { id: existing.id, made: 0, actions: [] };
        const body = `${String(look).trim().slice(0, 2000)} Exposed for legibility: faces, hands and the action stay clearly visible. Darkness comes from contrast and falloff, never from crushing the frame.`;
        const lane = Object.keys(plan.plates).length + 2;
        const result = this.ops.apply(plan.space_id, [{ op: 'note', ref: 'look', title: 'the look', body, lane, stage: 1 }], { origin: this.origin(plan), aspect: '16:9' });
        return { id: result.refs.look, made: 1, actions: result.actions };
    }

    /** What the beats were asked for (build_board), read by every later turn and every beat writer. */
    intent(plan) {
        const payload = plan ? this.plans.stage(plan.id, 'beats')?.payload ?? {} : {};
        const castVoices = plan ? (this.plans.stage(plan.id, 'cast')?.payload.plates ?? []).some((p) => p.voice) : false;
        return {
            narration: Boolean(payload.narration),
            // Dialogue is ON unless the person turned it off; a cast with voices outranks a stored false (VoiceIntent).
            voice_over: payload.voice_over !== false || castVoices,
            music: payload.music ?? null,
            look: payload.look ?? null,
            look_node_id: payload.look_node_id ?? null,
            register: payload.register ?? null,
            poster: payload.poster ?? null,
            hook: payload.hook ?? null,
            resolution: payload.resolution ?? null,
            language: payload.language ?? null,
            // What this PC renders the lanes on, recorded at build time for the beat writers (engine-info.js).
            clip_family: payload.clip_family ?? null,
            edit_family: payload.edit_family ?? null,
            lengths: Array.isArray(payload.lengths) && payload.lengths.length ? payload.lengths : null,
            with_sound: payload.with_sound ?? true,
        };
    }
}

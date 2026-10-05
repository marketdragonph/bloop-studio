// The build fan-out (bloop's PlanBoardBeatsJob → WriteBoardBeatJob → FinishBoardBuildJob), in-process: once
// build_board has laid the rail it returns, and the beats are written here in the background, three at a time,
// each by its own writer call. Each lane lands on the board as it is written; a failed lane keeps its reason and
// never stops the others. A build the app was closed in the middle of resumes at startup.
import { BoardOpsRejected } from '../ops/board-ops.js';
import { parseBeat, placeOf, writerSystem } from './beat-writer.js';
import { laneOps } from './lane.js';

const AT_ONCE = 3;

export class BuildRunner {
    /** write({ system, user }) → the writer's answer text (one model call, no tools). */
    constructor({ plans, stages, ops, events, write }) {
        this.plans = plans;
        this.stages = stages;
        this.ops = ops;
        this.events = events;
        this.write = write;
        this.running = new Set(); // plan ids
    }

    isRunning(planId) {
        return this.running.has(planId);
    }

    /** At startup: lanes cut off mid-write go back to the queue, and their builds carry on. */
    resume() {
        this.plans.requeueInterrupted();
        for (const { id } of this.plans.unfinishedPlans()) this.start(id);
    }

    /** The build's state for the panel: { building, total, written, failed, lanes: [{ tag, state, error, brief }] }. */
    state(plan) {
        if (!plan?.dispatched_at) return null;
        const beats = this.plans.beats(plan.id);
        return {
            planId: plan.id,
            building: this.running.has(plan.id),
            total: beats.length,
            written: beats.filter((b) => b.state === 'written').length,
            failed: beats.filter((b) => b.state === 'failed').length,
            lanes: beats.map((b) => ({ tag: b.tag, state: b.state, error: b.error, brief: b.state === 'written' ? null : b.brief.slice(0, 140) })),
        };
    }

    start(planId) {
        if (this.running.has(planId)) return;
        this.running.add(planId);
        this.#run(planId)
            .catch((error) => console.error(`build ${planId} failed:`, error))
            .finally(() => {
                this.running.delete(planId);
                const plan = this.plans.find(planId);
                if (plan && !this.plans.beats(planId).some((b) => b.state === 'queued')) this.plans.update(planId, { built_at: new Date().toISOString() });
                this.#announce(planId);
            });
    }

    async #run(planId) {
        const queue = () => this.plans.beats(planId).filter((b) => b.state === 'queued');
        const workers = Array.from({ length: AT_ONCE }, async () => {
            for (;;) {
                const next = queue()[0];
                if (!next) return;
                this.plans.setBeat(next.id, { state: 'writing', started_at: new Date().toISOString(), error: null });
                this.#announce(planId);
                await this.#writeOne(planId, next.id);
                this.#announce(planId);
            }
        });
        await Promise.all(workers);
    }

    async #writeOne(planId, beatId) {
        const plan = this.plans.find(planId);
        const beat = this.plans.beat(beatId);
        const all = this.plans.beats(planId);
        const intent = this.stages.intent(plan);
        const index = all.findIndex((b) => b.id === beat.id);
        const lengths = intent.lengths ?? [3, 5, 8, 10];
        const withSound = intent.with_sound !== false;
        const lane = {
            place: placeOf(all, index),
            poster: intent.poster === beat.tag,
            hook: (intent.hook ?? all[0]?.tag) === beat.tag,
            resolution: (intent.resolution ?? all.at(-1)?.tag) === beat.tag,
        };
        const facts = beat.refs.map((ref) => {
            const look = plan.plates[ref]?.look ? this.stages.spaces.findNode(plan.space_id, plan.plates[ref].look) : null;
            return look ? `- @${ref}: ${String(look.text_content ?? '').replace(/\s+/g, ' ').slice(0, 220)}` : null;
        }).filter(Boolean);
        try {
            const answer = await this.write({
                system: writerSystem({ intent, aspect: plan.aspect, withSound, lengths, plan, beatCount: all.length, lane }),
                user: `The beat:\n\n${beat.brief}${facts.length ? `\n\nWho and what is in it (their look cards are wired into this lane, so do not describe them again — name them by @tag):\n${facts.join('\n')}` : ''}${beat.staging?.landmark ? `\n\nWHERE: ${[beat.staging.landmark, beat.staging.camera_side, beat.staging.distance].filter(Boolean).join(', ')}.` : ''}`,
            });
            const written = parseBeat(answer, beat.brief);
            const { ops } = laneOps(beat, written, {
                lane: beat.lane, aspect: plan.aspect, plates: plan.plates, lookId: intent.look_node_id,
                clipFamily: intent.clip_family ?? null, lengths, withSound,
            });
            const applied = this.ops.apply(plan.space_id, ops, { origin: this.stages.origin(plan), aspect: plan.aspect });
            this.plans.setBeat(beat.id, { state: 'written', node_ids: applied.nodes.map((n) => n.id), finished_at: new Date().toISOString() });
            this.events.director({ spaceId: plan.space_id, runId: null, event: 'actions', data: { actions: applied.actions, build: true } });
        } catch (error) {
            const reason = error instanceof BoardOpsRejected ? `the board refused it: ${error.reasons[0]}` : error.message;
            if (!(error instanceof BoardOpsRejected)) console.error(`beat ${beat.tag} failed:`, error.message);
            this.plans.setBeat(beat.id, { state: 'failed', error: String(reason).slice(0, 300), started_at: null });
        }
    }

    #announce(planId) {
        const plan = this.plans.find(planId);
        if (!plan) return;
        this.events.director({ spaceId: plan.space_id, runId: null, event: 'build', data: this.state(plan) });
    }
}

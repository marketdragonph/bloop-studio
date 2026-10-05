// The Director's plan storage (bloop's SpaceAgentPlan + SpaceBuildStage + SpaceAgentPlanBeat).
// "Latest by id" is the board's plan, and a plan existing at all is the never-re-ask rule.
import { now, transaction } from '../db/database.js';

const json = (text, fallback) => {
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
};

const hydratePlan = (row) => row && {
    ...row,
    questions: json(row.questions, []),
    assumptions: json(row.assumptions, []),
    plates: json(row.plates, {}),
};

const hydrateBeat = (row) => row && { ...row, refs: json(row.refs, []), staging: json(row.staging, {}), node_ids: json(row.node_ids, []) };

export class DirectorPlans {
    constructor(db) {
        this.db = db;
    }

    latest(spaceId) {
        return hydratePlan(this.db.prepare('SELECT * FROM director_plans WHERE space_id = ? ORDER BY id DESC LIMIT 1').get(spaceId));
    }

    find(planId) {
        return hydratePlan(this.db.prepare('SELECT * FROM director_plans WHERE id = ?').get(planId));
    }

    create(spaceId, { approach = null, questions = [], assumptions = [], aspect = null, runtimeSeconds = null } = {}) {
        const { lastInsertRowid } = this.db.prepare(`
            INSERT INTO director_plans (space_id, approach, questions, assumptions, aspect, runtime_seconds) VALUES (?, ?, ?, ?, ?, ?)
        `).run(spaceId, approach, JSON.stringify(questions), JSON.stringify(assumptions), aspect, runtimeSeconds);
        return this.find(Number(lastInsertRowid));
    }

    /** Writes the given columns (plates as an object, the rest as they are). */
    update(planId, changes) {
        const fields = Object.keys(changes);
        if (!fields.length) return this.find(planId);
        const values = fields.map((f) => (['plates', 'questions', 'assumptions'].includes(f) ? JSON.stringify(changes[f]) : changes[f]));
        this.db.prepare(`UPDATE director_plans SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...values, planId);
        return this.find(planId);
    }

    // ── Stages: cast and world hold proposed plates; beats holds the build intent ──

    stage(planId, stage) {
        const row = this.db.prepare('SELECT * FROM director_build_stages WHERE plan_id = ? AND stage = ?').get(planId, stage);
        return row && { ...row, payload: json(row.payload, {}) };
    }

    /** Proposes (or re-proposes) a stage's payload; an applied stage is never rewritten here. */
    propose(planId, stage, payload) {
        const existing = this.stage(planId, stage);
        if (existing?.state === 'applied') return existing;
        this.db.prepare(`
            INSERT INTO director_build_stages (plan_id, stage, payload) VALUES (?, ?, ?)
            ON CONFLICT(plan_id, stage) DO UPDATE SET payload = excluded.payload
        `).run(planId, stage, JSON.stringify(payload));
        return this.stage(planId, stage);
    }

    apply(planId, stage, payload = undefined) {
        const existing = this.stage(planId, stage);
        const body = JSON.stringify(payload ?? existing?.payload ?? {});
        this.db.prepare(`
            INSERT INTO director_build_stages (plan_id, stage, state, payload, applied_at) VALUES (?, ?, 'applied', ?, ?)
            ON CONFLICT(plan_id, stage) DO UPDATE SET state = 'applied', payload = excluded.payload, applied_at = excluded.applied_at
        `).run(planId, stage, body, now());
        return this.stage(planId, stage);
    }

    // ── Beats ──

    beats(planId) {
        return this.db.prepare('SELECT * FROM director_plan_beats WHERE plan_id = ? ORDER BY lane, id').all(planId).map(hydrateBeat);
    }

    beat(beatId) {
        return hydrateBeat(this.db.prepare('SELECT * FROM director_plan_beats WHERE id = ?').get(beatId));
    }

    /** Upserts beats by tag, keeping a built beat's lane; returns them in lane order. */
    saveBeats(planId, beats) {
        return transaction(this.db, () => {
            const upsert = this.db.prepare(`
                INSERT INTO director_plan_beats (plan_id, tag, lane, brief, refs, staging) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(plan_id, tag) DO UPDATE SET brief = excluded.brief, refs = excluded.refs, staging = excluded.staging
            `);
            for (const b of beats) upsert.run(planId, b.tag, b.lane, b.brief, JSON.stringify(b.refs ?? []), JSON.stringify(b.staging ?? {}));
            return this.beats(planId);
        });
    }

    setBeat(beatId, changes) {
        const fields = Object.keys(changes);
        const values = fields.map((f) => (f === 'node_ids' ? JSON.stringify(changes[f]) : changes[f]));
        this.db.prepare(`UPDATE director_plan_beats SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...values, beatId);
        return this.beat(beatId);
    }

    /** Beats the app was closed in the middle of writing go back to the queue. */
    requeueInterrupted() {
        return this.db.prepare("UPDATE director_plan_beats SET state = 'queued', started_at = NULL WHERE state = 'writing'").run().changes;
    }

    /** Plans with beats still to write: what the build runner resumes at startup. */
    unfinishedPlans() {
        return this.db.prepare(`
            SELECT DISTINCT p.id, p.space_id FROM director_plans p JOIN director_plan_beats b ON b.plan_id = p.id
            WHERE b.state = 'queued' AND p.dispatched_at IS NOT NULL
        `).all();
    }
}

// The Director's tools (bloop's `spaces_director` skill registry, in its order). Routing is the model reading the
// descriptions; there is no keyword router. A tool that throws is reported to the model, never to the person.
import { advanceBuild, planBoard } from './plan.js';
import { buildBoard } from './build.js';
import { auditBoardSkill, inspectBoard, proposeBoardOps } from './board.js';

export const SKILLS = [planBoard, advanceBuild, buildBoard, proposeBoardOps, inspectBoard, auditBoardSkill];

/** The tool definitions for a turn (some schemas carry this board's clip lengths). */
export const definitions = (t) => SKILLS.map((s) => ({ name: s.name, description: s.description, schema: s.schemaFor ? s.schemaFor(t) : s.schema }));

export const ACTIVITY = {
    plan_board: 'Planning',
    advance_build: 'Laying the cast and places',
    build_board: 'Starting the build',
    propose_board_ops: 'Changing the board',
    inspect_board: 'Reading cards',
    audit_board: 'Checking the board',
};

export function runSkill(name, input, t) {
    const skill = SKILLS.find((s) => s.name === name);
    if (!skill) return { ok: false, content: `There is no tool called "${name}".` };
    try {
        return skill.run(input ?? {}, t);
    } catch (error) {
        console.error(`director tool ${name} failed:`, error);
        return { ok: false, content: `That tool failed (${error.message}). Nothing from it reached the board. Say so plainly.` };
    }
}

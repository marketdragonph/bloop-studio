// The Director's tools (bloop's `spaces_director` skill registry, in its order). Routing is the model reading the
// descriptions; there is no keyword router. A tool that throws is reported to the model, never to the person.
// The Cut's four tools (P4, 03-director.md §9) come after audit_board and are always listed: with no cut and no
// clips they refuse plainly. A tool may answer later (inspect_cut waits up to 3 s for measures): runSkill then
// returns a promise, and the providers await every result.
import { advanceBuild, planBoard } from './plan.js';
import { buildBoard } from './build.js';
import { auditBoardSkill, inspectBoard, proposeBoardOps } from './board.js';
import { CUT_SKILLS } from './cut.js';

export const SKILLS = [planBoard, advanceBuild, buildBoard, proposeBoardOps, inspectBoard, auditBoardSkill, ...CUT_SKILLS];

/** The tool definitions for a turn (some schemas carry this board's clip lengths). */
export const definitions = (t) => SKILLS.map((s) => ({ name: s.name, description: s.description, schema: s.schemaFor ? s.schemaFor(t) : s.schema }));

export const ACTIVITY = {
    plan_board: 'Planning',
    advance_build: 'Laying the cast and places',
    build_board: 'Starting the build',
    propose_board_ops: 'Changing the board',
    inspect_board: 'Reading cards',
    audit_board: 'Checking the board',
    stitch_cut: 'Putting the cut together',
    propose_cut_ops: 'Editing the cut',
    inspect_cut: 'Measuring the clips',
    pack_assets: 'Packing the assets',
    remember_edit_style: 'Remembering your editing style',
};

const failed = (name, error) => {
    console.error(`director tool ${name} failed:`, error);
    return { ok: false, content: `That tool failed (${error.message}). Nothing from it reached the board or the cut. Say so plainly.` };
};

/** Runs a tool. Returns its result, or a promise of it for a tool that waits; never throws or rejects. */
export function runSkill(name, input, t) {
    const skill = SKILLS.find((s) => s.name === name);
    if (!skill) return { ok: false, content: `There is no tool called "${name}".` };
    try {
        const result = skill.run(input ?? {}, t);
        return typeof result?.then === 'function' ? result.catch((error) => failed(name, error)) : result;
    } catch (error) {
        return failed(name, error);
    }
}

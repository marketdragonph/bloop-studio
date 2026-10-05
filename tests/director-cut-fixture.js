// The Director's Cut tools on a planned board (tests/cut-fixture.js), with the real CutEdits / CutDraft / CutTurns /
// CutOps and a real AnalyzeMedia whose measures are seeded straight into media_analysis (no ffmpeg, no queue job:
// the fake queue fails the test if anything is queued). A fake Pack service records starts. No ComfyUI, no GPU.
import { cutFixture } from './cut-fixture.js';
import { CutEdits } from '../src/server/cut/cut-edits.js';
import { CutDraft } from '../src/server/cut/cut-draft.js';
import { CutTurns } from '../src/server/cut/cut-turns.js';
import { CutTurnsRepository } from '../src/server/repositories/cut-turns.js';
import { MediaAnalysisRepository } from '../src/server/repositories/media-analysis.js';
import { AnalyzeMedia } from '../src/server/analysis/analyze-media.js';
import { ANALYZER_VERSION } from '../src/server/analysis/stages.js';
import { CutOps } from '../src/server/director/cut/cut-ops.js';
import { TurnLedger } from '../src/server/director/turn/ledger.js';
import { runSkill } from '../src/server/director/skills/index.js';

export async function directorCutFixture(prefix = 'dir-cut-') {
    const f = await cutFixture(prefix);
    const { db, cuts, events, boardCut, plans, spaces } = f;
    const edits = new CutEdits({ db, cuts, events });
    const drafts = new CutDraft({ boardCut, cuts, edits });
    const turns = new CutTurns({ cuts, repo: new CutTurnsRepository(db), edits });
    const repo = new MediaAnalysisRepository(db);
    const queued = [];
    const queue = { add: (job) => { queued.push(job.key); return Promise.resolve(null); } }; // recorded, never run
    const analysis = new AnalyzeMedia({ ffmpeg: null, media: { resolve: (p) => p }, repo, queue, stat: async () => ({ size: 1, mtimeMs: 1 }) });
    const ops = new CutOps({ cuts, boardCut, edits, turns, analysis, plans, db });
    const packs = [];
    const state = { freeBytes: 1e12 };
    const packer = {
        estimate: async () => ({ files: 12, bytes: 1.2e9, free: state.freeBytes, enough: state.freeBytes > 1.32e9, name: 'night-drive' }),
        start: (spaceId, options) => { packs.push({ spaceId, options }); return { export: { id: packs.length }, created: true }; },
    };
    const runner = { starts: 0, isRunning: () => false, start() { this.starts += 1; } };
    const cut = { cuts, boardCut, edits, drafts, turns, ops, analysis, packer, exportsRepo: { active: () => null }, plans, db };

    /** Seeds a file's measures (ms) as a fresh, done analysis. */
    const measure = (path, data) => repo.save(path, { size: 1, mtimeMs: 1, version: ANALYZER_VERSION, status: 'done', data: { speech: [], silence: [], still: [], scenes: [], has_audio: true, has_video: true, ...data } });

    /** A turn context: the person's words this turn, one ledger. */
    const turn = (spaceId, request = '') => ({
        spaceId, spaces, plans, runner, ledger: new TurnLedger(), request, cut, inspectWaitMs: 50,
        emit: () => {}, lengths: [3, 5, 8, 10], withSound: true,
    });
    const run = (name, input, t) => runSkill(name, input, t);

    /** A planned board whose cut was stitched by the Director (every item placed_by 'director'). */
    const stitched = async (name, tags, rendered = tags, options = {}) => {
        const b = f.board(name, tags, rendered, options);
        const t = turn(b.space.id, 'cut it together');
        const result = run('stitch_cut', { mode: 'fill' }, t);
        return { ...b, t, result, cut: cuts.current(b.space.id) };
    };

    return { ...f, state, edits, drafts, turns, repo, analysis, ops, packer, packs, runner, queued, cutDeps: cut, measure, turn, run, stitched };
}

/** Button words and control names a tool result or critic line must never carry (03 §6), outside "Do not name any buttons". */
export const BUTTON_WORDS = [/\bpress(es|ed)?\b/i, /\bclick(s|ed)?\b/i, /\btap(s|ped)?\b/i, /\bbuttons?\b/i, /\bExport\b/, /\bGenerate\b/, /\bRender\b/, /\bFill the cut\b/, /\bPack assets\b/];

/** The text with the allowed instruction taken out. */
export const withoutInstruction = (text) => String(text).replace(/do not offer to render it, and do not name any buttons/gi, '').replace(/do not offer to render/gi, '').replace(/do not name any buttons/gi, '');

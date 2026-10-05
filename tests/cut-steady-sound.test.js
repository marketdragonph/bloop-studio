// Steady sound (owner decision 2026-10-05, katana.md §8 item 8): a "speech" span over ≥ 85 % of a clip whose beat has
// no · script card is background sound, not a line — it does not block trims, does not trigger LINE_CUT_OFF and does
// not duck the music. With a script card the clip keeps today's behaviour. Fake ffmpeg output, seeded analysis rows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { directorCutFixture } from './director-cut-fixture.js';
import { STEADY_SHARE, splitSteady, heardCache } from '../src/shared/steady-sound.js';
import { ANALYZER_VERSION, speech } from '../src/server/analysis/stages.js';
import { checkCut, soundOnCut } from '../src/server/cut/cut-check.js';

let f;
before(async () => { f = await directorCutFixture('steady-'); });
after(() => f.close());

test('the speech stage keeps a span over 85 % of the clip apart as steady sound; the analyzer version moved on', async () => {
    assert.equal(STEADY_SHARE, 0.85);
    assert.ok(ANALYZER_VERSION >= 3, 'cached results from before are measured again');
    assert.deepEqual(splitSteady([[200, 5000]], 5000), { speech: [], steady: [[200, 5000]] });
    assert.deepEqual(splitSteady([[1200, 3400]], 5000), { speech: [[1200, 3400]], steady: [] }, 'a real line stays a line');
    const ctx = {
        role: 'clip', lengthMs: 5000, full: 'x.mp4', data: { has_audio: true, errors: [], speech: [] },
        deps: { ffmpeg: { run: async () => ({ stderr: '[silencedetect @ 1] silence_start: 0\n[silencedetect @ 1] silence_end: 0.2\n' }) } },
    };
    await speech(ctx, async () => {});
    assert.deepEqual([ctx.data.speech, ctx.data.steady], [[], [[200, 5000]]]);
    // A row from the older analyzer is not used while it waits to be measured again.
    f.repo.save('old.mp4', { size: 1, mtimeMs: 1, version: ANALYZER_VERSION - 1, status: 'done', data: { speech: [[0, 5000]] } });
    assert.equal(f.analysis.cached(['old.mp4']).has('old.mp4'), false);
});

/** A two-clip board whose first clip carries steady sound (0.1–2.9 s of a 3.0 s clip) and a still tail; the music ducks. */
function steadyBoard(name, { script = false } = {}) {
    const b = f.board(name, ['s1-open', 's2-cup']);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    if (script) f.spaces.createNode(b.space.id, { type: 'text', label: 's1-open · script', text_content: 'Rain on the roof.' });
    const path = b.clips['s1-open'].take.media_path;
    f.measure(path, { duration_ms: 3000, speech: [], steady: [[100, 2900]], still_tail: [2500, 3000] });
    f.measure(b.clips['s2-cup'].take.media_path, { duration_ms: 4000 });
    let cut = f.cuts.current(b.space.id);
    f.cuts.save(b.space.id, { items: cut.items, sound: { music: { ...cut.sound.music, duck: { depth_db: -10, attack_ms: 120, release_ms: 400 } } }, revision: cut.revision });
    cut = f.cuts.current(b.space.id);
    return { b, path, cut };
}

test('no script card: a trim may cut the steady sound, no LINE_CUT_OFF, no duck under the whole clip', async () => {
    const { b } = steadyBoard('steady');
    const t = f.turn(b.space.id, 'tighter');
    const r = f.run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's1-open', out_s: 2.5, why: 'Frozen from 2.5.' }] }, t);
    assert.equal(r.ok, true, r.content);
    assert.doesNotMatch(r.content, /spoken line/, 'the critic sees no line cut off');
    const cut = f.cuts.current(b.space.id);
    assert.equal(cut.items[0].out_ms, 2500, 'the trim landed inside the steady sound');
    const check = checkCut(f.cutDeps, b.space.id, cut);
    assert.equal(check.findings.some((x) => x.code === 'LINE_CUT_OFF'), false);
    assert.deepEqual(soundOnCut(cut, check.analysisOf).ducks, [], 'the music does not duck under rain');
    const inspect = await f.run('inspect_cut', { beats: ['s1-open'] }, f.turn(b.space.id, 'is it tight?'));
    assert.match(inspect.content, /steady sound 0\.1–2\.9 \(background, not a line: a trim may cut it\)/);
    assert.doesNotMatch(inspect.content, /\| speech /);
});

test('with a script card: the same sound is a line, as before (LINE_CUT_OFF, ducked, trims keep it)', () => {
    const { b, path, cut } = steadyBoard('scripted', { script: true });
    const check = checkCut(f.cutDeps, b.space.id, cut);
    assert.deepEqual(check.analysisOf(path).speech, [[100, 2900]]);
    assert.deepEqual(soundOnCut(cut, check.analysisOf).ducks.length, 1, 'the music ducks under the line');
    const r = f.run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's1-open', out_s: 2.5, why: 'Shorter.' }] }, f.turn(b.space.id, 'tighter'));
    assert.match(r.content, /s1-open: a spoken line \(0\.1–2\.9 s\) is cut off at its end/);
    // heardCache on its own: only the scripted clip's path hears its steady sound as a line.
    const cache = new Map([['a.mp4', { speech: [], steady: [[0, 900]] }], ['b.mp4', { speech: [], steady: [[0, 900]] }]]);
    const heard = heardCache(cache, [{ media_path: 'a.mp4', beat_tag: 'S1-Open' }, { media_path: 'b.mp4', beat_tag: 's2' }], new Set(['s1-open']));
    assert.deepEqual([heard.get('a.mp4').speech, heard.get('b.mp4').speech], [[[0, 900]], []]);
});

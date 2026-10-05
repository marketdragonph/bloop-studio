// The Director's Cut tools (03-director.md §2–§5, §7, §9): stitch_cut, propose_cut_ops (all or nothing, every
// refusal text, the edit lock, beat snaps, one undo per turn, "undo that"), inspect_cut, pack_assets — and the owner
// rules: nothing renders, nothing exports, nothing queues, and no tool result names a control.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directorCutFixture, BUTTON_WORDS, withoutInstruction } from './director-cut-fixture.js';
import { closeTurn } from '../src/server/director/turn/closing.js';
import { cutSnapshot, systemPrompt } from '../src/server/director/prompts/compose.js';
import { cutState } from '../src/server/director/cut/cut-state.js';
import { EDIT_CRAFT } from '../src/server/director/prompts/doctrine-edit.js';
import { LATER_EDITS } from '../src/server/cut/cut-turns.js';

let f;
const said = []; // every tool result, for the button-word check at the end
const run = (name, input, t) => {
    const r = f.run(name, input, t);
    const keep = (x) => (said.push(x.content), x);
    return typeof r?.then === 'function' ? r.then(keep) : keep(r);
};
before(async () => { f = await directorCutFixture(); });
after(() => f.close());

const TAGS = ['s1-open', 's2-cup', 's3-run'];
const pathOf = (b, tag) => b.clips[tag].take.media_path;
const count = (sql, ...a) => f.db.prepare(sql).get(...a).n;

test('stitch_cut fill: beat order, gaps named, nothing rendered, one cut event for the turn', async () => {
    const b = f.board('stitch', ['s1-open', 's2-cup', 's3-run', 's4-end'], ['s1-open', 's2-cup', 's4-end']);
    const t = f.turn(b.space.id, 'cut it together');
    let result;
    const sent = await f.listen(async () => { result = run('stitch_cut', { mode: 'fill' }, t); });
    assert.match(result.content, /^Added 3 clips in beat order; the cut is 0:12, revision 1\. 1 beat has no video: s3-run\. NOTHING WAS RENDERED\./);
    const cut = f.cuts.current(b.space.id);
    assert.deepEqual(cut.items.map((i) => [i.beat_tag, i.placed_by]), [['s1-open', 'director'], ['s2-cup', 'director'], ['s4-end', 'director']]);
    assert.deepEqual(sent.map((e) => [e.by, e.turn, e.missing]), [['director', t.ledger.cutTurnId, ['s3-run']]]);
    assert.equal(f.turns.repo.find(t.ledger.cutTurnId).after_rev, 1);
    assert.equal(t.ledger.drafted, true);
    // Never a render, never an export, never a job: no ComfyUI client exists here, and nothing was queued.
    assert.equal(count('SELECT COUNT(*) n FROM jobs'), 0);
    assert.equal(count("SELECT COUNT(*) n FROM cut_exports WHERE kind = 'export'"), 0);
    assert.equal(f.runner.starts, 0);

    const again = run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch it'));
    assert.match(again.content, /^The cut already has the person's work in it, so nothing was written\. A fresh draft is offered/);
    assert.equal(f.cuts.current(b.space.id).revision, 1, 'fill never writes into a cut with clips');

    const empty = f.board('no clips', ['a1', 'a2'], []);
    const t2 = f.turn(empty.space.id, 'make the video');
    const none = await f.listen(async () => { run('stitch_cut', { mode: 'fill' }, t2); });
    assert.deepEqual(none, [], 'zero clips: no write, no event');
    assert.equal(count('SELECT COUNT(*) n FROM cut_turns WHERE space_id = ?', empty.space.id), 0, 'a draft that wrote nothing leaves no turn');
    const closed = closeTurn({ streamed: 'I stitched the video together.', ledger: t2.ledger, recover: () => null });
    assert.match(closed.text, /Nothing in the cut changed this turn\.$/);
});

test('propose_cut_ops trims with the measured numbers: a note, a stored reason, one critic per turn', () => {
    const b = f.board('trim', TAGS);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    f.measure(pathOf(b, 's2-cup'), { duration_ms: 4000, still_head: [0, 600], still_tail: [3400, 4000], speech: [[1200, 3000]], loudness: { i: -19.8, tp: -3.1 } });
    const t = f.turn(b.space.id, 'trim the dead bits');
    const r = run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's2-cup', in_s: 0.6, out_s: 3.4, why: 'Still at 0.0–0.6 and frozen from 3.4.' }] }, t);
    assert.equal(r.ok, true);
    assert.equal(r.content.split('\n').slice(0, 3).join('\n'), 'Done — 1 edit; the cut is now 0:11 (was 0:12), revision 2. Exactly what this call changed (nothing else changed):\n'
        + '- s2-cup: in 0.0→0.6 s, out 4.0→3.4 s, now 2.8 s long (Still at 0.0–0.6 and frozen from 3.4.)\n'
        + 'It is in the Cut already: say what you changed and why in two sentences, in editing words, naming ONLY the edits in this list. Nothing was rendered or exported.');
    const item = f.cuts.current(b.space.id).items[1];
    assert.deepEqual([item.in_ms, item.out_ms, item.note, item.placed_by, item.person_rev], [600, 3400, 'Trimmed −1.2 s', 'director', null]);
    assert.deepEqual(f.turns.repo.reasonsFor(b.space.id, 's2-cup').map((x) => x.why), ['Still at 0.0–0.6 and frozen from 3.4.']);
    // A trim inside the line: the critic says so — but only once per turn.
    const t2 = f.turn(b.space.id, 'tighter');
    const cutLine = run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's2-cup', out_s: 2.0, why: 'Shorter hold.' }] }, t2);
    assert.match(cutLine.content, /CHECK YOUR CUT[\s\S]*s2-cup: a spoken line \(1\.2–3\.0 s\) is cut off at its end\. Move the out point outside the line, or let it run on with an L cut\./);
    const second = run('propose_cut_ops', { ops: [{ op: 'sound', beat: 's1-open', on: false }] }, t2);
    assert.doesNotMatch(second.content, /CHECK YOUR CUT/);
    assert.equal(count('SELECT COUNT(*) n FROM cut_turns WHERE space_id = ? AND after_rev IS NOT NULL', b.space.id), 3, 'stitch, turn 1, turn 2: one row per turn');
});

test('all or nothing, and every refusal in words the model can act on', () => {
    const b = f.board('refuse', TAGS);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    const before = f.cuts.current(b.space.id);
    const t = f.turn(b.space.id, 'make it punchier');
    const r = run('propose_cut_ops', { ops: [
        { op: 'trim', beat: 's1-open', in_s: 0, out_s: 1.4, why: 'Faster open.' },
        { op: 'join', beat: 's1-open', type: 'dissolve', ms: 900, why: 'Time jump.' },
        { op: 'trim', beat: 's3-run', out_s: 6.2, why: 'Hold.' },
        { op: 'move', beat: 's9-end', after: 'start', why: 'End first.' },
        { op: 'trim', beat: 's2-cup', out_s: 2 },
    ] }, t);
    assert.equal(r.ok, false);
    for (const line of [
        '- op 2: a dissolve of 900 ms is more than half of s1-open (1.4 s).',
        '- op 3: out_s 6.2 is past the end of s3-run (5.0 s). Read it with inspect_cut.',
        '- op 4: s9-end is not a beat on this board. The beats are: s1-open, s2-cup, s3-run.',
        '- op 5: say why, from the measured numbers (`why`, one short sentence).',
    ]) assert.ok(r.content.includes(line), `${line}\n---\n${r.content}`);
    assert.match(r.content, /^NOTHING was changed in the cut — the whole op list was refused:/);
    const now = f.cuts.current(b.space.id);
    assert.equal(now.revision, before.revision, 'op 1 was fine and still did not land');
    assert.deepEqual(now.items, before.items);
    assert.equal(t.ledger.cutTurnId, null, 'a refused list begins no turn');
    assert.match(closeTurn({ streamed: 'Tightened the open.', ledger: t.ledger, recover: () => null }).text, /Nothing in the cut changed this turn\.$/);
});

test('the edit lock: the person\'s clip is theirs unless they name it, or the whole cut, this turn', () => {
    const b = f.board('lock', TAGS);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    let cut = f.cuts.current(b.space.id);
    f.edits.save(b.space.id, { items: cut.items.map((i) => (i.beat_tag === 's2-cup' ? { ...i, out_ms: 3500 } : i)), revision: cut.revision, by: 'person' });
    cut = f.cuts.current(b.space.id);
    assert.equal(cut.items[1].person_rev, cut.revision);
    const ops = [{ op: 'sound', beat: 's1-open', on: false }, { op: 'trim', beat: 's2-cup', out_s: 3.0, why: 'Tighter.' }];
    const refused = run('propose_cut_ops', { ops }, f.turn(b.space.id, 'make it punchier'));
    assert.ok(refused.content.includes('- op 2: s2-cup was changed by the person after you placed it, so it is theirs. Leave it, or ask them in one sentence whether you may change it.'));
    assert.equal(f.cuts.current(b.space.id).items[0].sound, true, 'the unlocked op did not land either');
    for (const words of ['tighten s2-cup a bit', 'trim the cup shot', 'beat 2 is too long', 'tighten the whole cut', 'go through everything']) {
        const before = f.cuts.current(b.space.id);
        const r = run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's2-cup', out_s: before.items[1].out_ms === 3000 ? 3.2 : 3.0, why: 'Named by the person.' }] }, f.turn(b.space.id, words));
        assert.equal(r.ok, words !== 'trim the cup shot', `${words}: ${r.content}`);
    }
});

test('beats: an out point within 80 ms of a measured downbeat lands on it, and says so', () => {
    const b = f.board('snap', TAGS);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    f.measure(b.bed.take.media_path, { duration_ms: 60_000, has_video: false, bpm: 94, beats: [0, 640, 1280, 1920, 2560], downbeats: [0, 2560, 5120, 7680, 10_240] });
    const r = run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's1-open', out_s: 2.6, why: 'Out on the swing.' }] }, f.turn(b.space.id, 'cut on the beat'));
    assert.match(r.content, /s1-open's out point moved 40 ms onto the downbeat at 2\.6 s \(estimated\)\./);
    assert.equal(f.cuts.current(b.space.id).items[0].out_ms, 2560);
    const snap = run('propose_cut_ops', { ops: [{ op: 'snap', beat: 's2-cup', why: 'On the downbeat.' }] }, f.turn(b.space.id, 'cut on the beat'));
    assert.equal(snap.ok, true, snap.content);
    assert.equal(f.cuts.current(b.space.id).items[1].out_ms, 2560, 's2 now ends on the downbeat at 5.12 s in the cut');
});

test('no video tools: timed ops refuse plainly, untimed ops apply, inspect_cut uses no times', async () => {
    const b = f.board('no tools', TAGS);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    f.analysis.toolsMissing = true;
    try {
        const t = f.turn(b.space.id, 'tighten it');
        const timed = run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's1-open', out_s: 2, why: 'x' }] }, t);
        assert.ok(timed.content.includes('- op 1: s1-open is not measured, so no time can be set. Say the cut could not be measured on this PC in one sentence.'));
        const duck = run('propose_cut_ops', { ops: [{ op: 'duck', depth_db: -10 }] }, t);
        assert.match(duck.content, /op 1: The cut is not measured/);
        const plain = run('propose_cut_ops', { ops: [
            { op: 'move', beat: 's3-run', after: 'start', why: 'Open on the run.' }, { op: 'sound', beat: 's2-cup', on: false },
            { op: 'join', beat: 's3-run', type: 'cut', why: 'Hard cut into the open.' },
        ] }, t);
        assert.equal(plain.ok, true, plain.content);
        assert.deepEqual(f.cuts.current(b.space.id).items.map((i) => i.beat_tag), ['s3-run', 's1-open', 's2-cup']);
        const inspect = await run('inspect_cut', {}, f.turn(b.space.id, 'is it tight?'));
        assert.match(inspect.content, /^Not measured: the video tools are missing on this PC\. Use no times\./);
    } finally {
        f.analysis.toolsMissing = false;
    }
});

test('one undo per turn: the whole turn goes back with its stamps, only while it is on top', async () => {
    const b = f.board('undo', TAGS);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    const stitched = f.cuts.current(b.space.id);
    const t = f.turn(b.space.id, 'tighter, and dissolve into the run');
    run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's1-open', out_s: 2.5, why: 'Hold ends at 2.5.' }] }, t);
    const second = run('propose_cut_ops', { ops: [{ op: 'join', beat: 's2-cup', type: 'dissolve', ms: 500, why: 'Time jump into the run.' }] }, t);
    assert.equal(second.ok, true, second.content);
    const row = f.turns.view(b.space.id);
    assert.deepEqual([row.turn, row.edits, row.undoable, row.rows.length, row.before_total_ms, row.after_total_ms], [t.ledger.cutTurnId, 2, true, 2, 12_000, 11_000]);
    assert.deepEqual(row.rows.map((r) => r.text), ['Trimmed −0.5 s', 's2-cup→s3-run Dissolve 0.5 s']);

    const res = await f.send('POST', `/spaces/${b.space.id}/cut/undo-turn`, { turn: row.turn, revision: row.after_rev });
    assert.equal(res.status, 200);
    const back = f.cuts.current(b.space.id);
    assert.deepEqual(back.items, stitched.items, 'every item, note and stamp as it was before the turn');
    assert.equal((await res.json()).turn.undone, true);
    assert.equal((await f.send('POST', `/spaces/${b.space.id}/cut/undo-turn`, { turn: row.turn, revision: back.revision })).status, 422, 'once');
    assert.equal((await f.send('POST', `/spaces/${b.space.id}/cut/undo-turn`, { turn: row.turn, revision: back.revision }, { token: null })).status, 403, 'CSRF');

    // A later edit by the person: the turn is no longer on top.
    const t2 = f.turn(b.space.id, 'trim the open');
    run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's1-open', out_s: 2.0, why: 'Shorter open.' }] }, t2);
    const cut = f.cuts.current(b.space.id);
    f.edits.save(b.space.id, { items: cut.items.map((i, k) => (k === 2 ? { ...i, sound: false } : i)), revision: cut.revision, by: 'person' });
    const late = await f.send('POST', `/spaces/${b.space.id}/cut/undo-turn`, { turn: t2.ledger.cutTurnId, revision: cut.revision + 1 });
    assert.equal(late.status, 422);
    assert.equal((await late.json()).error, LATER_EDITS);
});

test('"undo that" in words, and "keep the trims, undo the dissolves"', () => {
    const b = f.board('undo words', TAGS);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    const stitched = f.cuts.current(b.space.id);
    run('propose_cut_ops', { ops: [
        { op: 'trim', beat: 's1-open', out_s: 2.5, why: 'Hold ends at 2.5.' },
        { op: 'join', beat: 's1-open', type: 'dissolve', why: 'A jump in time.' },
    ] }, f.turn(b.space.id, 'tighter, softer'));
    const partial = run('propose_cut_ops', { ops: [{ op: 'undo_turn', kinds: ['join'] }] }, f.turn(b.space.id, 'keep the trims but undo the dissolves'));
    assert.equal(partial.ok, true, partial.content);
    let cut = f.cuts.current(b.space.id);
    assert.deepEqual([cut.items[0].out_ms, cut.items[1].join], [2500, { type: 'cut' }]);
    const all = run('propose_cut_ops', { ops: [{ op: 'undo_turn' }] }, f.turn(b.space.id, 'undo that'));
    assert.match(all.content, /^Done — your last turn is taken back; the cut is 0:11 again \(was 0:12\)/);
    cut = f.cuts.current(b.space.id);
    assert.equal(cut.items[0].out_ms, 2500, 'only the partial undo turn was taken back');
    const alone = run('propose_cut_ops', { ops: [{ op: 'undo_turn' }, { op: 'sound', beat: 's1-open', on: false }] }, f.turn(b.space.id, 'undo'));
    assert.match(alone.content, /undo_turn goes alone in its call/);
    assert.ok(stitched.revision < cut.revision);
});

test('inspect_cut: one line per clip and the bed, measured numbers only, and the why ledger when asked', async () => {
    const b = f.board('inspect', TAGS);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    f.spaces.createNode(b.space.id, { type: 'text', label: 's2-cup · script', text_content: 'We open at six.' });
    f.measure(pathOf(b, 's2-cup'), { duration_ms: 4000, still_head: [0, 600], still_tail: [3400, 4000], speech: [[1200, 3000]], silence: [[3000, 4000]], loudness: { i: -19.8, tp: -3.1 }, scenes: [2700] });
    f.measure(b.bed.take.media_path, { duration_ms: 58_400, has_video: false, bpm: 92, downbeats: [0, 2600, 5200, 7800], loudness: { i: -14.2, tp: -1 } });
    const r = await run('inspect_cut', {}, f.turn(b.space.id, 'is it tight?'));
    const id = b.clips['s2-cup'].node.id;
    assert.match(r.content, new RegExp(`^s2-cup @${id} 4\\.0 s, used 0\\.0–4\\.0, at 3\\.0 in the cut \\| still head 0\\.0–0\\.6 \\| still tail 3\\.4–4\\.0 \\| speech 1\\.2–3\\.0 "We open at six\\." \\| silence 3\\.0–4\\.0 \\| -19\\.8 LUFS, peak -3\\.1 dBTP \\| scene change 2\\.7 \\| can lose 1\\.4 s$`, 'm'));
    assert.match(r.content, /^music @\d+ 58\.4 s \| ~92 BPM \(estimated\) \| downbeats 0\.0 2\.6 5\.2 7\.8 \(in cut time\) \| -14\.2 LUFS \| level -12 dB \| ends 58\.4 s \(cut is 12\.0 s\)$/m);
    assert.match(r.content, /Not measured yet: s1-open \(not measured\), s3-run \(not measured\)\. Use only these numbers; do not guess the rest\./);
    assert.deepEqual(f.queued.slice(-2), [`analysis:${pathOf(b, 's1-open')}`, `analysis:${pathOf(b, 's3-run')}`], 'inspect_cut asks for what is not measured');
    run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's2-cup', in_s: 0.6, why: 'Settles until 0.6 s.' }] }, f.turn(b.space.id, 'trim the head'));
    const why = await run('inspect_cut', { beats: ['s2-cup', 's7-gone'] }, f.turn(b.space.id, 'why did you cut there?'));
    assert.match(why.content, /Last edit: Trimmed −0\.6 s — Settles until 0\.6 s\./);
    assert.match(why.content, /Not in the cut: s7-gone\./);
});

test('pack_assets starts the Pack job only when the person asked in words', async () => {
    const b = f.board('pack', TAGS);
    const no = await run('pack_assets', {}, f.turn(b.space.id, 'make it punchier'));
    assert.equal(no.ok, false);
    assert.equal(f.packs.length, 0);
    const yes = await run('pack_assets', {}, f.turn(b.space.id, 'pack everything up for my editor'));
    assert.equal(f.packs.length, 1);
    assert.deepEqual(f.packs[0], { spaceId: b.space.id, options: { includePrompts: true } });
    assert.match(yes.content, /^Packing 12 files \(1\.2 GB\) into "night-drive-….zip" in the media folder\. It will say when it is done\. Nothing was rendered or exported\./);
    f.state.freeBytes = 1e8;
    const full = await run('pack_assets', {}, f.turn(b.space.id, 'zip it all'));
    assert.match(full.content, /^Not packed: the pack needs about 1\.3 GB free/);
    assert.equal(f.packs.length, 1);
    f.state.freeBytes = 1e12;
});

test('the snapshot lines: the cut line verbatim, then lock, gaps and roles only when needed; EditCraft once', () => {
    const b = f.board('snapshot', ['s1-open', 's2-cup', 's3-run'], ['s1-open', 's3-run']);
    f.plans.saveBeats(b.plan.id, [{ tag: 's1-open', lane: 1, brief: 'b', staging: { role: 'hook' } }, { tag: 's2-cup', lane: 2, brief: 'b' }, { tag: 's3-run', lane: 3, brief: 'b', staging: { role: 'close' } }]);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    const cut = f.cuts.current(b.space.id);
    f.edits.save(b.space.id, { items: cut.items.map((i, k) => (k === 1 ? { ...i, out_ms: 3500 } : i)), revision: cut.revision, by: 'person' });
    const state = cutState(f.cutDeps, b.space.id, f.plans.latest(b.space.id));
    assert.equal(cutSnapshot(state), '\nCut: 2 of 3 beats, 0:07, revision 2\nLocked (the person changed them since): s3-run.\nGaps: s2-cup (never rendered).\nRoles: s1-open hook, s3-run close.\n');
    const prompt = systemPrompt({ space: f.spaces.find(b.space.id), board: f.spaces.board(b.space.id), plan: f.plans.latest(b.space.id), cut: state });
    assert.equal(prompt.split('THE EDITOR — owns the Cut.').length, 2, 'EditCraft appears once');
    assert.ok(prompt.indexOf(EDIT_CRAFT) > prompt.indexOf('THE STORY EDITOR'), 'after STORY_CRAFT');
    assert.ok(prompt.endsWith(cutSnapshot(state)), 'the cut lines close the board state');
});

test('owner rules: no Director file reaches a render, an export, the GPU worker, the job queue or bloop cloud', () => {
    const dir = fileURLToPath(new URL('../src/server/director/', import.meta.url));
    const files = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));
    for (const file of files(dir).filter((x) => x.endsWith('.js'))) {
        const text = readFileSync(file, 'utf8');
        const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]).join('\n');
        assert.doesNotMatch(imports, /generation\/(worker|enqueue|render-plan|jobs)|cut\/export|comfy|bloop-account|bloop-cloud|cloud-models|tools-queue|capped-ffmpeg/, file);
        assert.doesNotMatch(text, /\bexporter\b|CutExporter|queue\.add\(|jobs\.add|renderPlan|\.enqueue\(/, file);
    }
});

test('no tool result names a control (whole words press/click/tap/button; Export, Generate, Render, Fill the cut, Pack assets)', () => {
    assert.ok(said.length > 30, `${said.length} results collected`);
    for (const text of said) for (const word of BUTTON_WORDS) assert.doesNotMatch(withoutInstruction(text), word, text);
});

test('build_board takes a role per beat and keeps it in the beat\'s staging JSON (no migration)', async () => {
    const { harness } = await import('./director-harness.js');
    const h = harness();
    const t = h.turn();
    f.run('plan_board', { approach: 'x' }, t);
    f.run('build_board', { beats: [
        { tag: 'open', brief: 'A door opens.', role: 'hook' },
        { tag: 'chase', brief: 'She runs.', role: 'turn' },
        { tag: 'home', brief: 'She is home.', role: 'close', staging: { landmark: 'the porch' } },
        { tag: 'extra', brief: 'Rain.', role: 'not-a-role' },
    ], resolution: 'extra' }, t);
    const beats = h.plans.beats(h.plans.latest(h.space.id).id);
    assert.deepEqual(beats.map((b) => b.staging.role ?? null), ['hook', 'turn', 'close', null]);
    assert.equal(beats[2].staging.landmark, 'the porch');
});

test('editing style: saved only when the person asks to remember it, then read on every turn after EditCraft', async () => {
    const { editStyle } = await import('../src/server/director/prompts/doctrine-edit.js');
    const store = { editStyle: '' };
    const settings = { get: (k) => store[k], update: (v) => Object.assign(store, v) };
    const b = f.board('style', TAGS);
    const no = run('remember_edit_style', { text: 'No dissolves.' }, { ...f.turn(b.space.id, 'make it punchier'), settings });
    assert.equal(no.ok, false);
    assert.equal(store.editStyle, '');
    const yes = run('remember_edit_style', { text: '  No dissolves.   Mix to -14 LUFS. ' }, { ...f.turn(b.space.id, 'I never want dissolves, remember that'), settings });
    assert.equal(yes.ok, true);
    assert.equal(store.editStyle, 'No dissolves. Mix to -14 LUFS.');
    const prompt = systemPrompt({ space: f.spaces.find(b.space.id), board: f.spaces.board(b.space.id), plan: null, editStyle: store.editStyle });
    assert.ok(prompt.includes(editStyle(store.editStyle)));
    assert.ok(prompt.indexOf('THE PERSON\'S EDITING STYLE') > prompt.indexOf('THE EDITOR — owns the Cut.'));
    assert.equal(editStyle('  '), '');
    assert.equal(editStyle('x'.repeat(900)).length, editStyle('x'.repeat(600)).length, 'at most 600 characters');
});

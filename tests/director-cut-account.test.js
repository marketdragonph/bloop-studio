// Regression (live turn on real clips, 2026-10-05): the Director said it "trimmed the silent head and tails" of every
// clip when one was never trimmed, and the dock's strip read "8 edits · 0:00 → 0:29" over a 0:40 cut while the line
// under it said "made 5 edits". The account now comes from what actually landed (applied-edits.js): one list, one
// count, for the tool result, the strip, the reveal text, Undo turn and the ledger's closing words.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { directorCutFixture } from './director-cut-fixture.js';
import { closeTurn } from '../src/server/director/turn/closing.js';
import { EDIT_CRAFT } from '../src/server/director/prompts/doctrine-edit.js';
import { appliedEdits } from '../src/server/director/cut/applied-edits.js';
import { fakeDock, withItems } from './cut-dock-fakes.js';

// The dock's modules import /shared/…, which cut-dock-fakes.js maps; load them after it.
const { readTurn, turnHead } = await import('../public/js/components/cut-turn.js');

let f;
before(async () => { f = await directorCutFixture('dir-account-'); });
after(() => f.close());

const TAGS = ['s1-open', 's2-cup', 's3-run', 's4-end'];

test('the tool result lists exactly what changed; an op that changed nothing is not an edit', () => {
    const b = f.board('account', TAGS);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    for (const tag of TAGS) f.measure(b.clips[tag].take.media_path, { duration_ms: 4000 });
    const cut = f.cuts.current(b.space.id);
    const t = f.turn(b.space.id, 'under 30 seconds, punchy');
    const r = f.run('propose_cut_ops', { ops: [
        { op: 'trim', beat: 's1-open', in_s: 0, out_s: cut.items[0].out_ms / 1000, why: 'Silent head and tail.' }, // the same points: nothing changes
        { op: 'remove', beat: 's2-cup', why: 'No speech, still.' },
        { op: 'trim', beat: 's4-end', out_s: 3.0, why: 'Dead tail.' },
    ] }, t);
    assert.equal(r.ok, true, r.content);
    const lines = r.content.split('\n');
    assert.match(lines[0], /^Done — 2 edits; the cut is now 0:11 \(was 0:18\), revision 2\. Exactly what this call changed/);
    assert.deepEqual(lines.slice(1, 3), ['- s4-end: out 6.0→3.0 s, now 3.0 s long (Dead tail.)', '- s2-cup: removed from the cut (No speech, still.)']);
    assert.doesNotMatch(r.content, /s1-open/, 's1-open was not trimmed, so it is not in the account');
    assert.match(r.content, /naming ONLY the edits in this list/);

    // The strip, the reveal text and Undo turn read the same count as the tool result.
    const view = f.turns.view(b.space.id);
    assert.equal(view.edits, 2);
    assert.equal(view.rows.length + view.sound_rows.length, view.edits, 'Show edits lists as many rows as the count says');
    // The ledger's closing words come from the same list.
    const closed = closeTurn({ streamed: '', ledger: t.ledger, recover: () => null });
    assert.equal(closed.text, 'I made 2 edits to the cut: s4-end: Trimmed −3.0 s; s2-cup: Taken out of the cut.');
});

test('a write whose ops changed nothing says so, and claims no edit', () => {
    const b = f.board('noop', TAGS);
    f.run('stitch_cut', { mode: 'fill' }, f.turn(b.space.id, 'stitch'));
    f.measure(b.clips['s1-open'].take.media_path, { duration_ms: 4000 });
    const out = f.cuts.current(b.space.id).items[0].out_ms / 1000;
    const r = f.run('propose_cut_ops', { ops: [{ op: 'trim', beat: 's1-open', in_s: 0, out_s: out, why: 'Tighter.' }] }, f.turn(b.space.id, 'tighter'));
    assert.match(r.content, /^Done, but nothing in the cut actually changed: .* Say that in one sentence; describe no edit\./);
    assert.equal(f.turns.view(b.space.id).edits, 0);
});

test('the doctrine: describe only the edits listed in the tool result, never more', () => {
    assert.match(EDIT_CRAFT, /SAY ONLY WHAT LANDED\. Describe only the edits listed in the tool result of stitch_cut or propose_cut_ops, never\nmore/);
});

test('a turn that fills an empty cut, then edits: one count, and the strip starts at the length the dock showed', () => {
    const b = f.board('fill then edit', TAGS);
    for (const tag of TAGS) f.measure(b.clips[tag].take.media_path, { duration_ms: 4000 });
    const t = f.turn(b.space.id, 'cut it together, under 15 seconds');
    const stitched = f.run('stitch_cut', { mode: 'fill' }, t);
    assert.match(stitched.content, /Exactly what changed: s1-open, s2-cup, s3-run, s4-end placed whole, in beat order; nothing was trimmed, moved or taken out\./);
    f.run('propose_cut_ops', { ops: [{ op: 'remove', beat: 's3-run', why: 'Silent.' }, { op: 'trim', beat: 's1-open', in_s: 0.5, why: 'Still head.' }] }, t);
    const view = f.turns.view(b.space.id);
    // Before: the four clips the dock's lane showed (0:18), not the empty stored cut (0:00).
    assert.deepEqual([view.before_total_ms, view.after_total_ms], [18_000, 12_500]);
    assert.deepEqual(view.rows.map((r) => r.text), ['Put 4 clips in beat order', 'Trimmed −0.5 s', 'Taken out of the cut']);
    assert.equal(view.edits, 3, 'one write of clips + two edits, as many as Show edits lists');
    const turn = readTurn(view, f.cuts.current(b.space.id).items);
    assert.equal(turnHead(turn), 'Director · 3 edits · 0:18 → 0:12');
    assert.equal(closeTurn({ streamed: '', ledger: t.ledger, recover: () => null }).text,
        'I made 3 edits to the cut: Put 4 clips in beat order; s1-open: Trimmed −0.5 s; s3-run: Taken out of the cut.');
    // A stitch on its own: the closing words say the clips went in, not "N edits".
    const b2 = f.board('fill only', TAGS);
    const t2 = f.turn(b2.space.id, 'stitch it');
    f.run('stitch_cut', { mode: 'fill' }, t2);
    assert.equal(closeTurn({ streamed: '', ledger: t2.ledger, recover: () => null }).text, 'I put the clips into the cut in beat order.');
    assert.equal(f.turns.view(b2.space.id).edits, 1);
});

test('appliedEdits reads the cuts, not the ops: a move back to where it was, a snap, a take swap', () => {
    const item = (id, extra = {}) => ({ id, node_id: id.length, beat_tag: id, media_path: `${id}.mp4`, take_id: 1, seconds_ms: 4000, in_ms: 0, out_ms: 4000, sound: true, join: { type: 'cut' }, ...extra });
    const before = { items: [item('a'), item('bb'), item('ccc')] };
    const after = { items: [item('a', { out_ms: 3500 }), item('bb', { take_id: 2, media_path: 'bb2.mp4' }), item('ccc', { join: { type: 'dissolve', ms: 500 } })] };
    const rows = [
        { kind: 'move', item_id: 'a', text: 'Moved after ccc' }, { kind: 'move', item_id: 'a', text: 'Moved to the start' }, // back where it was
        { kind: 'snap', item_id: 'a', text: 'Cut on the downbeat at 3.5 s', why: 'On the beat.' },
    ];
    const applied = appliedEdits({ before, after, rows });
    assert.deepEqual(applied.rows.map((r) => [r.beat_tag, r.kind, r.text]), [
        ['a', 'snap', 'Cut on the downbeat at 3.5 s'], ['bb', 'place', 'Swapped in another take'], ['ccc', 'join', 'bb→ccc dissolve 0.5 s into it'],
    ]);
    assert.equal(applied.count, 3);
    assert.deepEqual(applied.rows[0].was, { in_ms: 0, out_ms: 4000 });
});

test('the dock says the turn\'s count again when the same turn grows (stitch, then edits): never a stale number', (t) => {
    const { dock } = fakeDock(t);
    const turn = (rev, edits) => ({ turn: 9, after_rev: rev, before_total_ms: 18_000, after_total_ms: 16_000, edits, undoable: true, changed: [11],
        rows: Array.from({ length: edits }, (_, k) => ({ kind: 'trim', node_id: 11, item_id: 'i11', text: 'Row ' + k })) });
    dock.cutApply({ ...withItems([11, 12, 13], 2), turn: turn(2, 1) });
    assert.equal(dock.cutAnnounce, 'The Director made 1 edit. Undo turn takes it back.');
    dock.cutApply({ ...withItems([11, 12, 13], 3), turn: turn(3, 3) });
    assert.equal(dock.cutTurnHead(), 'Director · 3 edits · 0:18 → 0:16');
    assert.equal(dock.cutAnnounce, 'The Director made 3 edits. Undo turn takes them all back.', 'the line under the strip reads the strip\'s number');
});

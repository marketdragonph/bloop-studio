// The Director in the Cut dock (Mini Katana P4, 05-irresistible.md §3.1–§3.6): the turn strip, Show edits, Undo
// turn, notes and reasons, the lock mark, trim ghosts; measuring, beat ticks, Snap to beats, Duck under lines and
// the timed Check your cut lines. The dock's own methods against fakes (cut-dock-fakes.js): no server, no GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_SNAP_MS, duckGain, snapToBeat } from '../src/shared/cut-sound.js';
import { cutClock } from '../src/shared/cut-clock.js';
import { fakeDock, flush, respond, store, stored, withItems } from './cut-dock-fakes.js';

// The dock's modules import /shared/…, which cut-dock-fakes.js maps; load them after it.
const { readTurn, turnHead } = await import('../public/js/components/cut-turn.js');
const { readAnalysis, snapTrim } = await import('../public/js/components/cut-measure.js');

/** A cut the Director just edited: i11 trimmed (with a note), i12 dissolved, i13 the person's own clip. */
function directorCut(revision = 3) {
    const items = stored([11, 12, 13]);
    items[0] = { ...items[0], out_ms: 5400, note: 'Trimmed −0.6 s' };
    items[1] = { ...items[1], join: { type: 'dissolve', ms: 500 }, note: 'Dissolve 0.5 s' };
    items[2] = { ...items[2], placed_by: 'person', person_rev: 2 };
    return { ...withItems([11, 12, 13], revision), cut: { ...withItems([], revision).cut, items, updated_by: 'director' } };
}

const turnRow = {
    id: 5, after_rev: 3, before_total_ms: 18_000, after_total_ms: 16_900, edits: 2, changed: [11, 12],
    rows: [
        { kind: 'trim', beat_tag: 's11', node_id: 11, item_id: 'i11', text: 'Trimmed −0.6 s · cut on action', was: { in_ms: 0, out_ms: 6000 } },
        { kind: 'join', beat_tag: 's12', node_id: 12, item_id: 'i12', text: 'Dissolve 0.5 s', at_ms: 4900 },
    ],
    ops_summary: ['Music: ducked −10 dB under 3 lines'],
    reasons: [{ item_id: 'i11', beat_tag: 's11', op: 'trim', why: 'The door finishes its swing at 5.4 s.' }],
};

const player = () => {
    const seen = [];
    return { seen, handle: { seek: (ms) => seen.push(['board', ms]), seekExport: (ms) => seen.push(['export', ms]), levels() {}, refresh() {}, time: () => 0 } };
};

test('readTurn: one shape from the cut_turns row; reasons join their rows, sound rows follow, the person\'s clips are locked', () => {
    const items = directorCut().cut.items;
    const turn = readTurn(turnRow, items);
    assert.equal(turn.id, '5');
    assert.equal(turn.revision, 3);
    assert.deepEqual(turn.rows.map((r) => r.text), ['Trimmed −0.6 s · cut on action', 'Dissolve 0.5 s', 'Music: ducked −10 dB under 3 lines']);
    assert.equal(turn.rows[0].why, 'The door finishes its swing at 5.4 s.');
    assert.equal(turn.rows[2].kind, 'sound');
    assert.deepEqual(turn.locked, ['i13'], 'the person\'s clip the turn did not touch');
    assert.equal(turnHead(turn), 'Director · 2 edits · 0:18 → 0:16');
    assert.equal(readTurn({ ...turnRow, undone_at: '2026-10-05' }, items), null, 'an undone turn shows no strip');
    assert.equal(readTurn({ id: 5 }, items), null, 'no revision, no strip');
    // No rows stored: the changed clips' notes stand in.
    const bare = readTurn({ id: 6, revision: 3, changed: [11] }, items);
    assert.deepEqual(bare.rows.map((r) => r.text), ['Trimmed −0.6 s']);
    assert.equal(turnHead({ ...bare, before_ms: null }), 'Director · 1 edit');
    assert.equal(turnHead({ ...bare, before_ms: 25_600, after_ms: 25_100 }), 'Director · 1 edit · 0:25.6 → 0:25.1', 'a half-second trim still shows');
    // The server's CutTurns.view() names: turn, sound_rows, undoable.
    const view = readTurn({ turn: 7, after_rev: 3, edits: 1, rows: [], sound_rows: ['Music: ducked −10 dB under 3 lines'], changed: [], undoable: false }, items);
    assert.equal(view.id, '7');
    assert.deepEqual(view.rows.map((r) => r.kind), ['sound']);
    assert.equal(view.undoable, false);
});

test('the turn strip shows while the turn is on top, marks and reveals its clips, and goes at the person\'s next edit', (t) => {
    const { dock } = fakeDock(t);
    const p = player();
    dock._cutPlayer = p.handle;
    dock.cutApply({ ...directorCut(), turn: turnRow });
    assert.equal(dock.cutTurnShown(), true);
    assert.equal(dock.cutTurnHead(), 'Director · 2 edits · 0:18 → 0:16');
    assert.equal(dock.cutAnnounce, 'The Director made 2 edits. Undo turn takes them all back.');
    const [a, b, c] = dock.cutItems;
    assert.equal(a.note, 'Trimmed −0.6 s', 'the note sits on the clip, sensor blue');
    assert.equal(dock.cutTurnWhy(a), 'Why: The door finishes its swing at 5.4 s.');
    assert.equal(dock.cutTurnMark(c).locked, true, '"Yours, untouched"');
    assert.equal(dock.cutTurnMark(a).locked, false);
    assert.equal(dock.cutTurnMark(a).marked, false, 'marked only while Show edits is open');

    dock.cutPps = 10;
    assert.equal(dock.cutTurnMark(a).ghostOut, 6, '0.6 s of trimmed frames at 10 px/s');
    assert.equal(dock.cutTurnMark(a).ghostIn, 0);

    dock.cutTurnToggle();
    assert.equal(dock.cutTurnOpen, true);
    assert.deepEqual(dock.cutTurnKeys(), [a.key, b.key]);
    assert.equal(dock.cutSelectedKey, a.key, 'Show edits selects the first changed clip');
    assert.equal(dock.cutTurnMark(b).marked, true);
    assert.equal(dock.cutTurnMark(c).marked, false);

    dock.cutTurnGo(dock.cutTurn.rows[1]);
    assert.equal(dock.cutSelectedKey, b.key);
    assert.deepEqual(p.seen.at(-1), ['export', 4900], 'a timed row seeks to its time');
    dock.cutTurnGo(dock.cutTurn.rows[0]);
    assert.deepEqual(p.seen.at(-1), ['board', a.board_ms], 'else to the clip');
    assert.match(dock.cutAnnounce, /^s11: Trimmed −0\.6 s · cut on action\. Why: The door/);

    // The person trims the Director's clip: its note goes, the strip folds into the undo history.
    dock.cutSelectedKey = a.key;
    dock.cutNudge('out', -100);
    assert.equal(dock.cutModel[0].note, undefined, 'the person\'s edit clears the Director\'s note on that clip (cut-edit.js)');
    assert.equal(dock.cutModel[1].note, 'Dissolve 0.5 s', 'other notes stay');
    assert.equal(dock.cutTurnShown(), false);
    assert.equal(dock.cutTurnMark(a).ghostOut, 0, 'no ghosts once the strip is gone');
});

test('Undo turn posts {turn, revision} with CSRF; 200 takes the cut back as one step; 409 says later edits came after', async (t) => {
    const before = { revision: 4, items: stored([11, 12, 13]), sound: null };
    const { dock, calls } = fakeDock(t, [respond(200, { cut: before })]);
    dock.cutApply({ ...directorCut(), turn: turnRow });
    await dock.cutUndoTurn();
    const post = calls.find((x) => x.method === 'POST');
    assert.equal(post.url, '/spaces/7/cut/undo-turn');
    assert.deepEqual(post.body, { turn: 5, revision: 3 });
    assert.equal(post.headers['X-CSRF-Token'], 'csrf-test');
    assert.equal(dock.cutRevision, 4);
    assert.equal(dock.cutModel[0].out_ms, 6000);
    assert.equal(dock.cutSaveState, 'saved', 'the server saved the undo; nothing is sent back');
    assert.equal(dock.cutTurnShown(), false);
    assert.equal(dock.cutAnnounce, 'Undid the Director\'s turn.');
    assert.equal(dock._cutHistory.nextUndoLabel(), 'Undid the Director\'s turn.', 'one step in the dock\'s history');

    const refused = fakeDock(t, [respond(422, { error: 'Later edits came after that turn, so it cannot be undone as a whole.' })]);
    refused.dock.cutApply({ ...directorCut(), turn: turnRow });
    await refused.dock.cutUndoTurn();
    assert.equal(refused.dock.cutAnnounce, 'Later edits came after the Director\'s turn.');
    assert.equal(refused.dock.cutTurnShown(), false);
    const notOnTop = fakeDock(t).dock;
    notOnTop.cutApply({ ...directorCut(), turn: { ...turnRow, undoable: false } });
    assert.equal(notOnTop.cutTurnShown(), false, 'the server says it is no longer on top');

    const late = fakeDock(t, [respond(409, { error: 'Later edits came after that turn.', cut: { revision: 6, items: stored([12]), sound: null, updated_by: 'person' } })]);
    late.dock.cutApply({ ...directorCut(), turn: turnRow });
    await late.dock.cutUndoTurn();
    assert.equal(late.dock.cutAnnounce, 'Later edits came after the Director\'s turn.');
    assert.equal(late.dock.cutTurnShown(), false);
    assert.deepEqual(late.dock.cutModel.map((i) => i.node_id), [12], 'the newer cut is taken like any change');
    assert.equal(late.calls.filter((x) => x.method === 'POST').length, 1);
});

test('a Director cut event rings the changed clips by node id; a dirty dock shows no strip until the person chooses', (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([11, 12, 13]));
    dock.onCutEvent({ spaceId: 7, revision: 4, by: 'director', changed: [12], turn: 5 });
    dock.cutReceive({ revision: 4, items: stored([11, 12, 13]).map((i) => (i.node_id === 12 ? { ...i, out_ms: 5000, note: 'Trimmed −1.0 s' } : i)) }, { by: 'director' });
    assert.deepEqual(dock.cutRung, ['c:i12']);

    const dirty = fakeDock(t).dock;
    dirty.cutApply(withItems([11, 12, 13]));
    dirty.cutSelectedKey = 'c:i11';
    dirty.cutToggleSound();
    dirty.cutApply({ ...directorCut(4), turn: { ...turnRow, after_rev: 4 } });
    assert.equal(dirty.cutBanner, 'director');
    assert.equal(dirty.cutTurnShown(), false, 'the strip waits for Use the newer version');
});

test('measuring: "Measuring 3 clips…" while the queue reads them, "Not measured" without video tools', (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply({ ...withItems([11, 12]), analysis: { state: 'measuring', pending: 3 } });
    assert.equal(dock.cutMeasuring(), true);
    assert.equal(dock.cutMeasuringText(), 'Measuring 3 clips…');
    dock.onCutEvent({ spaceId: 7, analysis: { pending: 1 } });
    assert.equal(dock.cutMeasuringText(), 'Measuring 1 clip…');
    dock.onCutEvent({ spaceId: 7, analysis: { state: 'done', pending: 0 } });
    assert.equal(dock.cutMeasuring(), false);
    assert.deepEqual(readAnalysis({ tools: false }), { state: 'missing', pending: 0 });
    dock.cutApply({ ...withItems([11, 12]), analysis: { state: 'missing' }, beats_ms: [] });
    assert.equal(dock.cutToolsMissing(), true);
    assert.equal(dock.cutBeatsShort(), 'Not measured');
    assert.equal(dock.cutSnapReady(), false, 'no ticks, no snap');
    assert.equal(dock.cutBeatsLabel(), 'Not measured: the video tools are missing on this PC.');
});

test('beat ticks come from measured beats only, downbeats taller and labelled estimated; duck bands and lines from the server', (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply({
        ...withItems([11, 12]), beats_ms: [0, 650, 1300, 1950, 2600, 99_000], downbeats_ms: [0, 2600],
        ducks: [{ from_ms: 1200, to_ms: 3400 }], speech: [{ from_ms: 1200, to_ms: 3400, beat_tag: 's11', text: 'We open at six.' }],
        sound: null,
    });
    dock.cutPps = 10;
    dock.cutMeasureLayout(dock.cutLay(), 10);
    assert.deepEqual(dock.cutBeats.map((b) => [b.x, b.down]), [[0, true], [6.5, false], [13, false], [19.5, false], [26, true]], 'none past the cut');
    assert.equal(dock.cutBeatsShort(), 'Beats · estimated');
    assert.deepEqual(dock.cutSpeechSpans.map((s) => [s.x, s.w]), [[12, 22]]);
    assert.equal(dock.cutSpeechLabel(dock.cutSpeechSpans[0]), 's11 · We open at six.');
    assert.deepEqual(dock.cutDuckBands, [], 'no duck set: no bands');
});

test('Snap to beats: a dragged trim within 80 ms of a downbeat lands on it, through the shared snapToBeat; drafts never', (t) => {
    assert.equal(BEAT_SNAP_MS, 80);
    assert.equal(snapToBeat(5060, [2600, 5200, 5000]), 5000, 'the nearest one');
    assert.equal(snapToBeat(5130, [5200, 5000]), 5200, 'either side');
    assert.equal(snapToBeat(5090, [5000]), null, 'past 80 ms nothing moves');
    const items = stored([11, 12]).map((i) => ({ ...i, out_ms: 5950 }));
    const out = snapTrim(items, 0, 'out', [6000]);
    assert.equal(out.beat, 6000);
    assert.equal(out.items[0].out_ms, 6000);
    const inEdge = snapTrim(items, 1, 'in', [11_850]);
    assert.equal(cutClock(inEdge.items).items[1].end_ms, 11_850, 'trimming in moves the cut point the other way');
    assert.equal(inEdge.items[1].in_ms, 50);
    assert.equal(snapTrim(items, 1, 'in', [11_950]).beat, null, 'a snap the trim cannot reach (in below 0) does nothing');
    assert.equal(snapTrim(items, 0, 'out', [6200]).beat, null);

    const { dock } = fakeDock(t);
    dock.cutApply({ ...withItems([11, 12]), downbeats_ms: [6000], beats_ms: [3000, 6000] });
    assert.deepEqual(dock.cutSnapped(items, 0, 'out').items, items, 'off by default');
    dock.cutSnapToggle();
    assert.equal(dock.cutSnap, true);
    assert.equal(store.get('bloop-studio:cut-snap'), '1', 'remembered per viewer');
    assert.equal(dock.cutAnnounce, 'Snap to beats: on');
    assert.equal(dock.cutSnapped(items, 0, 'out').items[0].out_ms, 6000);
    dock.cutDraft = true;
    assert.equal(dock.cutSnapped(items, 0, 'out').beat, null, 'drafts are never snapped');
});

test('Duck under lines: on at −10 dB in one undo step, the slider commits once, bands follow, the envelope is the export\'s', async (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply({ ...withItems([11, 12]), speech: [{ from_ms: 1200, to_ms: 3400 }] });
    assert.equal(dock.cutDuckDb(), null);
    assert.equal(dock.cutDuckText(), 'Duck under lines: off');
    assert.equal(dock.cutDuckLinesText(), 'Under 1 spoken line');
    dock.cutDuckToggle();
    assert.deepEqual(dock.cutSound.music.duck, { depth_db: -10, attack_ms: 120, release_ms: 400 });
    assert.equal(dock.cutSound.music.gain_db, -12, 'the bed gets its default level first');
    assert.equal(dock.cutDuckText(), 'Duck −10 dB under lines');
    assert.deepEqual(dock.cutDuckWindows(), [{ from_ms: 1200, to_ms: 3400, beat_tag: null, text: '' }], 'measured lines until the server sends ducks');
    assert.equal(dock.cutSaveState, 'unsaved');
    dock.cutSetDuck(-14);
    dock.cutSetDuck(-16);
    dock.cutSetDuck(-16, { commit: true });
    assert.equal(dock.cutDuckDb(), -16);
    await dock.cutUndo();
    assert.equal(dock.cutDuckDb(), -10, 'the whole slider drag is one step');
    dock.cutSetDuck(-40, { commit: true });
    assert.equal(dock.cutDuckDb(), -18, 'clamped to the rule');
    assert.ok(Math.abs(duckGain(dock.cutDuckWindows(), dock.cutDuckDb(), 2000) - 10 ** (-18 / 20)) < 1e-9, 'held under the line');
    dock.cutDuckToggle();
    assert.equal(dock.cutSound.music.duck, null, 'off again');
    await flush();
});

test('Check your cut: timed lines first with their time, Show me seeks there, card fixes show Go to card', (t) => {
    const { dock } = fakeDock(t);
    const p = player();
    dock._cutPlayer = p.handle;
    dock.cutApply({ ...withItems([11, 12]), findings: [
        { code: 'GAP', text: '04 · Flashback has no video yet.', node_id: 14 },
        { code: 'LOUDNESS_OFF', text: 'Music 4 dB loud under s12.', beat_tag: 's12', at_ms: 8000 },
        { code: 'LINE_CUT_OFF', text: 's11: the line is cut off.', node_id: 11, at_ms: 5400 },
        { code: 'OVER_RUNTIME', text: '58 s, planned 45 s.' },
    ] });
    const lines = dock.cutChecks();
    assert.deepEqual(lines.map((l) => l.code), ['LINE_CUT_OFF', 'LOUDNESS_OFF', 'GAP', 'OVER_RUNTIME']);
    assert.deepEqual(lines.map((l) => l.time), ['0:05', '0:08', '', '']);
    assert.equal(lines[1].target.key, 'c:i12', 'found by beat tag');
    assert.deepEqual(lines.map((l) => l.card), [false, false, true, false]);
    assert.equal(dock.cutCheckTitle(), 'Check your cut · 4');
    dock.cutStatus = 'ready';
    dock.cutSheet = 'check';
    dock.cutShowMe(lines[0]);
    assert.equal(dock.cutSheet, null);
    assert.equal(dock.cutOpen, true);
    assert.equal(dock.cutSelectedKey, 'c:i11');
    assert.deepEqual(p.seen.at(-1), ['export', 5400]);
    assert.equal(dock.cutAnnounce, '0:05: s11: the line is cut off.');
    assert.equal(dock.cutCheckOnRail(), true);
});

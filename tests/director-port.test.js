import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/db/database.js';
import { SpacesRepository } from '../src/server/repositories/spaces.js';
import { DirectorPlans } from '../src/server/repositories/director-plans.js';
import { BoardOps, BoardOpsRejected } from '../src/server/director/ops/board-ops.js';
import { BuildStages } from '../src/server/director/plan/stages.js';
import { TurnLedger } from '../src/server/director/turn/ledger.js';
import { runSkill } from '../src/server/director/skills/index.js';
import { boardSnapshot } from '../src/server/director/prompts/compose.js';
import { harness } from './director-harness.js';

const PLATES = [
    { tag: 'mira-sen', kind: 'cast', description: 'Mira Sen, 31, a long oval face, short black hair, grey flight jacket.', voice: 'Low and quick, Manila vowels.' },
    { tag: 'kai-reyes', kind: 'cast', description: 'Kai Reyes, 40, heavy jaw, beard, orange jumpsuit.' },
    { tag: 'hangar', kind: 'location', description: 'A rain-soaked hangar at night, orange work lights.' },
];

test('board ops: lane and stage become coordinates, refs wire, and one bad op refuses the whole list', () => {
    const { spaces, space, ops } = harness();
    assert.throws(() => ops.apply(space.id, [{ op: 'note', ref: 'a', body: 'x' }]), (e) => e instanceof BoardOpsRejected && /has no `lane`/.test(e.reasons[0]));
    assert.throws(() => ops.apply(space.id, [{ op: 'node', ref: 'a', type: 'image', prompt: 'x', lane: 1 }]), /WIRED INTO IT/);
    assert.throws(() => ops.apply(space.id, [{ op: 'note', ref: 'a', body: 'x', lane: 1, x: 40 }]), /canvas owns layout/);
    const applied = ops.apply(space.id, [
        { op: 'note', ref: 's1', title: 's1', body: 'Mira runs.', lane: 1, stage: 5 },
        { op: 'node', ref: 's1-still', type: 'image', label: 's1', lane: 1, stage: 7, aspect_ratio: '9:16' },
        { op: 'wire', from: 's1', to: 's1-still' },
    ]);
    const still = spaces.findNode(space.id, applied.refs['s1-still']);
    assert.equal(still.position_y, spaces.findNode(space.id, applied.refs.s1).position_y); // one lane, one row
    assert.equal(still.position_x - spaces.findNode(space.id, applied.refs.s1).position_x, 760); // two stages apart
    assert.equal(still.settings.aspect, '9:16');
    // A wire that cannot land rolls back the cards made before it in the same list.
    const before = spaces.board(space.id).nodes.length;
    assert.throws(() => ops.apply(space.id, [
        { op: 'note', ref: 'n', body: 'words', lane: 2, stage: 1 },
        { op: 'wire', from: 'n', to: `@${applied.refs.s1}` },
    ]), BoardOpsRejected);
    assert.equal(spaces.board(space.id).nodes.length, before);
});

test('plan_board writes nothing, drops voice questions, resolves the shape, and never asks twice', () => {
    const { spaces, space, plans, turn } = harness();
    const t = turn();
    const result = runSkill('plan_board', {
        approach: 'Six beats, a rescue at night.',
        questions: ['Six beats at eight seconds, or tighter at four?', 'Should it use spoken dialogue or stay wordless?'],
        destination: 'tiktok', board_title: 'The Wall Holds', plates: PLATES,
    }, t);
    assert.equal(spaces.board(space.id).nodes.length, 0);
    assert.match(result.content, /STOP THERE/);
    assert.match(result.content, /A QUESTION ABOUT VOICE WAS DROPPED/);
    assert.match(result.content, /THE SHAPE IS 9:16 \(for TikTok\)/);
    assert.deepEqual(t.ledger.questions, ['Six beats at eight seconds, or tighter at four?']);
    assert.equal(spaces.find(space.id).name, 'The Wall Holds'); // a placeholder name is replaced
    assert.equal(plans.latest(space.id).aspect, '9:16');
    const again = runSkill('plan_board', { approach: 'again', questions: ['Another?'] }, turn());
    assert.match(again.content, /already been planned/);
    assert.equal(plans.latest(space.id).questions.length, 1);
});

test('plan first: two new lanes on an empty, unplanned board are refused until there is a plan', () => {
    const { spaces, space, turn } = harness();
    const ops = [
        { op: 'note', ref: 'a', body: 'one', lane: 1 },
        { op: 'note', ref: 'b', body: 'two', lane: 2 },
    ];
    assert.match(runSkill('propose_board_ops', { ops }, turn()).content, /^STOP — do not build this yet/);
    assert.equal(spaces.board(space.id).nodes.length, 0);
    assert.match(runSkill('propose_board_ops', { ops: [ops[0]] }, turn()).content, /^Done — 1 cards/); // one lane is fine
});

test('the rail goes down in stages: cast first, then the places and props, each card wired', () => {
    const { spaces, space, plans, turn } = harness();
    runSkill('plan_board', { approach: 'x', plates: PLATES }, turn());
    const cast = runSkill('advance_build', { stage: 'cast' }, turn());
    assert.match(cast.content, /on the board now/);
    assert.match(cast.content, /NEXT IS WHERE IT HAPPENS/);
    let plan = plans.latest(space.id);
    assert.deepEqual(Object.keys(plan.plates), ['mira-sen', 'kai-reyes']);
    assert.ok(plan.plates['mira-sen'].voice); // a speaking person gets a voice card
    const labels = spaces.board(space.id).nodes.map((n) => n.label);
    assert.ok(labels.includes('cast: mira-sen') && labels.includes('cast: mira-sen · sheet') && labels.includes('voice: mira-sen'));
    const world = runSkill('advance_build', { stage: 'world' }, turn());
    assert.match(world.content, /THE RAIL IS DONE/);
    plan = plans.latest(space.id);
    assert.equal(plan.plates.hangar.kind, 'location');
    assert.match(runSkill('advance_build', { stage: 'all' }, turn()).content, /already on the board/);
});

test('build_board: guards, then the rail, the bed and the look go down and the beats are queued', () => {
    let started = null;
    const { spaces, space, plans, turn } = harness({ runner: { isRunning: () => false, start: (id) => { started = id; } } });
    runSkill('plan_board', { approach: 'x', plates: PLATES, destination: 'youtube' }, turn());
    const beats = [
        { tag: 'warning', brief: 'Mira watches the sea wall buckle.', refs: ['mira-sen', 'kai-reyes', 'hangar'] },
        { tag: 'choice', brief: 'Kai, gruff, orders Mira into the cockpit.', refs: ['mira-sen', 'kai-reyes'] },
        { tag: 'launch', brief: 'Mira launches into the storm.', refs: ['mira-sen'] },
    ];
    assert.match(runSkill('build_board', { beats: beats.slice(0, 2) }, turn()).content, /only 2 beats/);
    assert.match(runSkill('build_board', { beats, runtime_seconds: 300 }, turn()).content, /NOT BUILT — 3 beats cannot run 5:00/);
    assert.match(runSkill('build_board', { beats, hook: 'launch', runtime_seconds: 30 }, turn()).content, /THE HOOK AND THE RESOLUTION/);
    const t = turn();
    const result = runSkill('build_board', { beats, music: 'a low taiko pulse', look: 'sodium orange against wet blue-black, lifted blacks', voice_over: true }, t);
    assert.match(result.content, /The beats are RUNNING/);
    assert.match(result.content, /CAST NARROWED[\s\S]*warning: left out kai-reyes/);
    const plan = plans.latest(space.id);
    assert.equal(started, plan.id);
    assert.deepEqual(plans.beats(plan.id).map((b) => [b.tag, b.state, b.lane]), [['warning', 'queued', 6], ['choice', 'queued', 7], ['launch', 'queued', 8]]);
    const labels = spaces.board(space.id).nodes.map((n) => n.label);
    assert.ok(labels.includes('music bed') && labels.includes('the look'));
    assert.ok(t.ledger.built && t.ledger.touched());
});

test('the snapshot is bloop\'s: @ids, settings, render state and what feeds each card', () => {
    const { spaces, space, ops } = harness();
    const applied = ops.apply(space.id, [
        { op: 'note', ref: 'b', title: 'brief', body: 'A long brief. '.repeat(30), lane: 1 },
        { op: 'node', ref: 'v', type: 'video', label: 'clip', duration: 5, lane: 1, stage: 3 },
        { op: 'wire', from: 'b', to: 'v' },
    ]);
    const text = boardSnapshot({ space: spaces.find(space.id), ...spaces.board(space.id) });
    assert.match(text, /^THE BOARD RIGHT NOW — 2 cards, 1 wire, room for 298 more\./);
    assert.match(text, /Board name: "test" \(a placeholder name, no description\)\./);
    assert.match(text, new RegExp(`@${applied.refs.v} video "clip" duration=5 unrendered ← @${applied.refs.b}`));
    assert.match(text, /text="A long brief\.[^"]{100,}…"/);
    assert.equal(boardSnapshot({ space: { name: 'My film', description: 'x' }, nodes: [], connections: [] }), 'THE BOARD IS EMPTY. Nothing has been made yet.\nBoard name: "My film" — description: "x".');
});

test('a free turn lands beside the cards it wires to, on clear board, not past the far edge', () => {
    const { spaces, space, ops } = harness();
    const uno = spaces.createNode(space.id, { type: 'text', label: 'Uno', position_x: 0, position_y: 0 });
    const roof = spaces.createNode(space.id, { type: 'text', label: 'Rooftop', position_x: 0, position_y: 600 });
    spaces.createNode(space.id, { type: 'image', label: 'far shot', position_x: 6000, position_y: -3000 });
    spaces.createNode(space.id, { type: 'image', label: 'beside Uno', position_x: 440, position_y: 0 });
    const applied = ops.apply(space.id, [
        { op: 'note', ref: 'brief', title: 'thumbnail brief', body: 'Uno and Pip on the roof.', lane: 4, stage: 5 },
        { op: 'node', ref: 'thumb', type: 'image', label: 'thumbnail', lane: 4, stage: 7, aspect_ratio: '16:9' },
        { op: 'wire', from: 'brief', to: 'thumb' },
        { op: 'wire', from: `@${uno.id}`, to: 'thumb' },
        { op: 'wire', from: `@${roof.id}`, to: 'thumb' },
    ]);
    const brief = spaces.findNode(space.id, applied.refs.brief);
    const thumb = spaces.findNode(space.id, applied.refs.thumb);
    assert.equal(brief.position_x, 440, 'starts right of Uno and Rooftop, not right of the far shot');
    assert.equal(thumb.position_x - brief.position_x, 760, 'the shape of the block is kept');
    assert.equal(thumb.position_y, brief.position_y);
    assert.ok(brief.position_y >= 540 && brief.position_y < 1200, `slid just below the card beside Uno (y=${brief.position_y})`);
});

test('a free turn with no wires lands beside the newest card', () => {
    const { spaces, space, ops } = harness();
    spaces.createNode(space.id, { type: 'image', position_x: 5000, position_y: 0 });
    const newest = spaces.createNode(space.id, { type: 'image', position_x: 0, position_y: 2000 });
    const applied = ops.apply(space.id, [{ op: 'note', ref: 'n', body: 'words', lane: 3, stage: 2 }]);
    const note = spaces.findNode(space.id, applied.refs.n);
    assert.deepEqual([note.position_x, note.position_y], [newest.position_x + 280 + 160, 2000]);
});

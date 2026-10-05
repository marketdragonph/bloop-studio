import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './director-harness.js';
import { parseBeat, secondsFor, scriptOf, writerSystem, placeOf } from '../src/server/director/build/beat-writer.js';
import { laneOps } from '../src/server/director/build/lane.js';
import { BuildRunner } from '../src/server/director/build/runner.js';
import { runSkill } from '../src/server/director/skills/index.js';
import { closeTurn, isEcho, opsFromProse } from '../src/server/director/turn/closing.js';
import { TurnLedger } from '../src/server/director/turn/ledger.js';
import { auditBoard } from '../src/server/director/audit.js';
import { DirectorRuns } from '../src/server/director/runs.js';
import { DirectorRepository } from '../src/server/repositories/director.js';
import { BoardEvents } from '../src/server/generation/events.js';

const ANSWER = `VO: Every city has a wall.
LINE: The wall will not hold past dawn.
"Then we launch tonight."
SPEAKERS: @mira-sen (quiet urgency)
@kai-reyes (gruff)
SECONDS: 5
SHOT: medium two-shot | eye level | 35mm | slow push in | orange work lights from frame left, hard | orange and blue-black | extra fingers, text | rain on metal, thunder
STILL: Mira and Kai face each other under orange work lights.
CLIP: Rain sheets past the open hangar door; Kai turns away first.
SOUND: Rain drumming on the metal roof, distant thunder.`;

test('the writer\'s answer: lines in order with their speakers, and the clip sized to the words', () => {
    const w = parseBeat(ANSWER, 'brief');
    assert.deepEqual(w.lines, ['The wall will not hold past dawn.', 'Then we launch tonight.']);
    assert.equal(w.shot.move, 'slow push in');
    assert.equal(scriptOf(w, ['mira-sen', 'kai-reyes']), '[VO] Every city has a wall.\n[@mira-sen (quiet urgency)] The wall will not hold past dawn.\n[@kai-reyes (gruff)] Then we launch tonight.');
    assert.equal(secondsFor(w, [3, 4, 5, 6, 8, 10]), 8); // 16 words need 7 s, so the 8 s rung: never cut a line to fit
    assert.equal(secondsFor({ ...w, vo: [], lines: [], seconds: 7 }, [3, 4, 5, 6, 8, 10]), 8); // nearest legal, tie → longer
    assert.match(parseBeat('SECONDS: none', 'the brief').still, /^the brief$/); // a missing label falls back to the brief
});

test('a lane: brief and still words into the still, look and plates wired, the still into the clip\'s first frame', () => {
    const w = parseBeat(ANSWER, 'brief');
    const plates = { 'mira-sen': { kind: 'cast', look: 11, voice: 12 }, 'kai-reyes': { kind: 'cast', look: 13 }, hangar: { kind: 'location', look: 14 } };
    const { ops, seconds } = laneOps({ tag: 'choice', brief: 'Kai orders Mira in.', refs: ['mira-sen', 'kai-reyes', 'hangar', 'ghost'] }, w,
        { lane: 7, aspect: '9:16', plates, lookId: 20, clipFamily: 'ltx', lengths: [3, 5, 8, 10], withSound: true });
    const wires = ops.filter((o) => o.op === 'wire').map((o) => `${o.from}>${o.to}${o.socket ? `(${o.socket})` : ''}`);
    assert.ok(wires.includes('@20>choice-still') && wires.includes('@14>choice-still') && !wires.includes('@14>choice-clip'));
    assert.ok(wires.includes('choice-still>choice-clip(first_frame)') && wires.includes('choice-script>choice-clip') && wires.includes('@12>choice-clip'));
    const clip = ops.find((o) => o.ref === 'choice-clip');
    assert.deepEqual([clip.duration, clip.aspect_ratio, clip.settings.family, seconds], [8, '9:16', 'ltx', 8]);
    assert.match(ops.find((o) => o.ref === 'choice-still-words').body, /^SHOT: medium two-shot, eye level, 35mm/);
    assert.match(ops.find((o) => o.ref === 'choice-motion').body, /^SHOT: slow push in/);
    assert.ok(ops.every((o) => o.ref !== 'choice-ghost')); // a ref with no plate is skipped, never a card
});

test('each writer knows its neighbours and the lane it is (hook, resolution)', () => {
    const beats = [{ tag: 'a', brief: 'first' }, { tag: 'b', brief: 'second' }, { tag: 'c', brief: 'third' }];
    assert.match(placeOf(beats, 1), /BEFORE YOU — `a`: first[\s\S]*AFTER YOU — `c`: third/);
    const system = writerSystem({ intent: { voice_over: true, narration: false }, aspect: '9:16', withSound: true, lengths: [3, 5, 8], plan: {}, beatCount: 3, lane: { place: '', hook: true } });
    assert.match(system, /THIS LANE IS THE HOOK/);
    assert.match(system, /A TALL FRAME/);
    assert.match(system, /SPEAKERS:/);
});

test('the build runner writes every lane in the background; a lane that fails keeps its reason', async () => {
    const h = harness();
    const writes = [];
    const runner = new BuildRunner({
        plans: h.plans, stages: h.stages, ops: h.ops, events: { director: (e) => h.events.push(e) },
        write: async ({ user }) => {
            writes.push(user);
            if (user.includes('explodes')) throw new Error('the model went away');
            return ANSWER;
        },
    });
    const t = { ...h.turn(), runner };
    runSkill('plan_board', { approach: 'x', plates: [{ tag: 'mira-sen', kind: 'cast', description: 'Mira, 31.' }] }, t);
    runSkill('build_board', { beats: [
        { tag: 'one', brief: 'Mira wakes.', refs: ['mira-sen'] },
        { tag: 'two', brief: 'The tower explodes.' },
        { tag: 'three', brief: 'Mira runs.', refs: ['mira-sen'] },
    ] }, t);
    while (runner.isRunning(h.plans.latest(h.space.id).id)) await new Promise((r) => setTimeout(r, 5));
    const plan = h.plans.latest(h.space.id);
    assert.deepEqual(h.plans.beats(plan.id).map((b) => b.state), ['written', 'failed', 'written']);
    assert.match(h.plans.beats(plan.id)[1].error, /went away/);
    assert.ok(plan.built_at);
    assert.match(writes[0], /Who and what is in it[\s\S]*@mira-sen: Mira, 31\./);
    const labels = h.spaces.board(h.space.id).nodes.map((n) => n.label);
    assert.ok(['one · still', 'one · motion', 'one · script', 'one · sound', 'three · still'].every((l) => labels.includes(l)));
    const last = h.events.filter((e) => e.event === 'build').at(-1).data;
    assert.deepEqual([last.building, last.total, last.written, last.failed], [false, 3, 2, 1]);
});

test('closing: ops written as text are recovered once; a refused turn and a silent one say so; the ledger speaks', () => {
    const found = opsFromProse('Here you go:\n```json\n{"ops":[{"op":"note","ref":"a","body":"x","lane":1}]}\n```');
    assert.equal(found.ops.length, 1);
    assert.equal(found.text, 'Here you go:');
    let ledger = new TurnLedger();
    const recovered = closeTurn({ streamed: '[{"op":"note","ref":"a","body":"x","lane":1}]', ledger, recover: () => ({ nodes: [{ id: 1 }], updated: [] }) });
    assert.deepEqual([recovered.text, recovered.replaced], ['Added one card to the board.', true]);
    ledger = new TurnLedger();
    ledger.refused();
    assert.match(closeTurn({ streamed: 'Built it!', ledger, recover() {} }).text, /None of that reached the board/);
    assert.equal(closeTurn({ streamed: '', ledger: new TurnLedger(), recover() {} }).failed, true);
    ledger = new TurnLedger();
    ledger.record({ nodes: [{ id: 1 }, { id: 2 }], updated: [], connections: [], actions: [{ kind: 'card' }, { kind: 'card' }] });
    assert.equal(closeTurn({ streamed: '', ledger, recover() {} }).text, 'I put 2 cards on the board.');
    ledger = new TurnLedger();
    ledger.planned(['Reels or YouTube?']);
    assert.equal(closeTurn({ streamed: '', ledger, recover() {} }).text, 'Before I build this:\n\n- Reels or YouTube?');
    assert.ok(isEcho('Built **three** lanes.', 'Built three lanes.'));
    assert.ok(!isEcho('yes', 'Built three lanes.'));
});

test('the critic: a plate named in a shot but not wired into it is the Director\'s own fix', () => {
    const h = harness();
    const applied = h.ops.apply(h.space.id, [
        { op: 'note', ref: 'mira', title: 'cast: mira-sen', body: 'Mira, 31.', lane: 1, stage: 1 },
        { op: 'node', ref: 'pic', type: 'image', label: 'cast: mira-sen', lane: 1, stage: 3 },
        { op: 'wire', from: 'mira', to: 'pic' },
        { op: 'note', ref: 'b', title: 'run', body: 'Mira runs along the wall.', lane: 2, stage: 5 },
        { op: 'node', ref: 's', type: 'image', label: 'run', lane: 2, stage: 7 },
        { op: 'wire', from: 'b', to: 's' },
    ]);
    const findings = auditBoard(h.spaces.board(h.space.id), { only: [applied.refs.s] });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'lane_unlinked');
    assert.match(findings[0].message, /written about mira-sen/);
});

test('a Director run is one turn in the background; a run cut off by a closed app resumes by itself', async () => {
    const h = harness();
    const director = new DirectorRepository(h.db);
    const seen = [];
    const events = new BoardEvents();
    events.on('director', (u) => seen.push(u.event));
    const requests = [];
    const service = {
        resolveProvider: () => ({ providerId: 'anthropic' }),
        turn: async (spaceId, request, emit) => {
            requests.push(request);
            emit('text', { delta: 'Planning…' });
            emit('replace', { text: 'Before I build this.' });
            return { status: 'done', text: 'Before I build this.', actions: [] };
        },
    };
    const runs = new DirectorRuns({ director, service, events });
    runs.start(h.space.id, 'A film about a cat');
    await runs.live.get(h.space.id).done;
    assert.deepEqual(seen, ['text', 'replace', 'done']);
    director.startRun(h.space.id, 'cut off');
    new DirectorRuns({ director, service, events }).recover();
    assert.match(requests.at(-1), /^Continue where you stopped/);
});

// The cut critic (03-director.md §6, 05 §3.6): each timed finding on a fixture cut, thresholds from cut-rules.js,
// the dock's merged list, the Director's "CHECK YOUR CUT" lines scoped to the turn, and no control name in any line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFindings, shotWords, timedFindings } from '../src/server/cut/findings.js';
import { criticLines, cutCheckText, cutSectionText } from '../src/server/director/cut/audit-cut.js';
import { CRITIC } from '../src/shared/cut-rules.js';
import { BUTTON_WORDS, withoutInstruction } from './director-cut-fixture.js';

const item = (id, tag, ms, extra = {}) => ({ id, node_id: Number(id.slice(1)), beat_tag: tag, media_path: `${tag}.mp4`, seconds_ms: ms, in_ms: 0, out_ms: ms, sound: true, join: { type: 'cut' }, ...extra });
const run = (cut, analysis = {}, extra = {}) => timedFindings({ cut, analysisOf: (p) => analysis[p] ?? null, ...extra });
const codes = (list) => list.map((x) => x.code);

test('LINE_CUT_OFF: an in or out point more than 0.15 s inside a spoken line — unless a J or L cut lets it be heard', () => {
    const a = { 's1.mp4': { speech: [[1000, 3000]], duration_ms: 5000 } };
    const out = run({ items: [item('i1', 's1', 5000, { out_ms: 2500 }), item('i2', 's2', 4000)] }, a);
    assert.deepEqual(out.map((x) => [x.code, x.edge, x.at_ms, x.line]), [['LINE_CUT_OFF', 'out', 2500, [1000, 3000]]]);
    // Inside by only the slack: no finding.
    assert.deepEqual(run({ items: [item('i1', 's1', 5000, { out_ms: 3000 - CRITIC.lineInsideMs + 10 })] }, a), []);
    // An L cut that lets the line finish under the next clip: no finding.
    assert.deepEqual(run({ items: [item('i1', 's1', 5000, { out_ms: 2500 }), item('i2', 's2', 4000, { join: { type: 'cut', audio_ms: 600 } })] }, a), []);
    const head = run({ items: [item('i1', 's1', 5000, { in_ms: 1500 })] }, a);
    assert.deepEqual(head.map((x) => [x.code, x.edge]), [['LINE_CUT_OFF', 'in']]);
    assert.deepEqual(run({ items: [item('i0', 's0', 3000), item('i1', 's1', 5000, { in_ms: 1500, join: { type: 'cut', audio_ms: -600 } })] }, a), [], 'a J cut');
    assert.deepEqual(run({ items: [item('i1', 's1', 5000, { out_ms: 2500, sound: false })] }, a), [], 'the clip\'s sound is off');
});

test('DEAD_AIR: 1.2 s of still frames with no line, no clip sound and no music', () => {
    const still = { 's1.mp4': { still: [[3000, 5000]], silence: [[2500, 5000]], has_audio: true, duration_ms: 5000 } };
    const dead = run({ items: [item('i1', 's1', 5000)] }, still);
    assert.deepEqual(dead.map((x) => [x.code, x.span, x.at_ms]), [['DEAD_AIR', [3000, 5000], 3000]]);
    assert.deepEqual(run({ items: [item('i1', 's1', 5000, { out_ms: 4100 })] }, still), [], '1.1 s is under the threshold');
    const bed = { music: { media_path: 'bed.mp3', node_id: 9 } };
    assert.deepEqual(run({ items: [item('i1', 's1', 5000)], sound: bed }, { ...still, 'bed.mp3': { duration_ms: 60_000 } }), [], 'music under it');
    const noisy = { 's1.mp4': { still: [[3000, 5000]], silence: [], has_audio: true, duration_ms: 5000 } };
    assert.deepEqual(run({ items: [item('i1', 's1', 5000)] }, noisy), [], 'the clip\'s own sound plays');
});

test('LOUDNESS_OFF, MUSIC_ENDS_EARLY, OVER_RUNTIME, SHORT and JUMP', () => {
    const loud = { 'a.mp4': { loudness: { i: -20 } }, 'b.mp4': { loudness: { i: -12 } }, 'c.mp4': { loudness: { i: -21 } } };
    const items = [item('i1', 'a', 4000), item('i2', 'b', 4000), item('i3', 'c', 4000)];
    const l = run({ items }, loud).filter((x) => x.code === 'LOUDNESS_OFF');
    assert.deepEqual(l.map((x) => [x.beat_tag, x.lu]), [['b', 8.5]]);
    assert.ok(Math.abs(8.5) > CRITIC.loudnessJumpLu);

    const bed = { music: { media_path: 'bed.mp3', node_id: 9 } };
    const early = run({ items, sound: bed }, { 'bed.mp3': { duration_ms: 10_000 } });
    assert.deepEqual(early.map((x) => [x.code, x.at_ms]), [['MUSIC_ENDS_EARLY', 10_000]]);
    assert.deepEqual(run({ items, sound: bed }, { 'bed.mp3': { duration_ms: 11_500 } }), [], 'within a second');

    const over = run({ items }, {}, { plan: { runtime_seconds: 10 } });
    assert.deepEqual(over.map((x) => [x.code, x.text]), [['OVER_RUNTIME', 'The cut is 0:12; the plan asked for 0:10.']]);
    assert.deepEqual(run({ items }, {}, { plan: { runtime_seconds: 11 } }), [], 'under 15 % over');

    const slots = [{ state: 'ready', measured: true, node_id: 1, beat_tag: 'a', seconds: 3.2, planned_seconds: 5 }, { state: 'ready', measured: true, node_id: 2, beat_tag: 'b', seconds: 4.8, planned_seconds: 5 }];
    assert.deepEqual(run({ items }, {}, { slots }).map((x) => [x.code, x.beat_tag, x.short_ms, x.text]), [['SHORT', 'a', 1800, 'a: short by 1.8 s.']]);

    const briefs = new Map([['a', 'Close-up on her hands.'], ['b', 'A close-up of the cup.'], ['c', 'Wide shot of the street, low angle.']]);
    assert.deepEqual(run({ items }, {}, { briefs }).map((x) => [x.code, x.beat_tag]), [['JUMP', 'b']]);
    assert.deepEqual(shotWords('Low-angle wide shot'), { size: 'wide', angle: 'low angle' });
    const softened = [items[0], { ...items[1], join: { type: 'dissolve', ms: 500 } }, items[2]];
    assert.deepEqual(run({ items: softened }, {}, { briefs }), [], 'a dissolve softens the jump');
});

test('the dock gets one list: OVER_RUNTIME replaces a long RUNTIME_OFF; a short one stays', () => {
    const base = [{ code: 'GAP', beat_tag: 's4' }, { code: 'RUNTIME_OFF', text: 'x' }];
    assert.deepEqual(codes(mergeFindings(base, [{ code: 'OVER_RUNTIME' }])), ['GAP', 'OVER_RUNTIME']);
    assert.deepEqual(codes(mergeFindings(base, [])), ['GAP', 'RUNTIME_OFF']);
});

test('CHECK YOUR CUT: the turn\'s own clips plus whole-cut findings; each line says what to do, never a control', () => {
    const findings = [
        { code: 'GAP', beat_tag: 's4-flashback', node_id: null, text: '04 · Flashback has no video yet.' },
        { code: 'LINE_CUT_OFF', beat_tag: 's2-cup', node_id: 2, edge: 'out', line: [1200, 3000] },
        { code: 'DEAD_AIR', beat_tag: 's5-run', node_id: 5, span: [3000, 4400] },
        { code: 'TAKES', beat_tag: 's5-run', node_id: 5, text: 'two takes' },
    ];
    const mine = cutCheckText(findings, [2]);
    assert.equal(mine, [
        'CHECK YOUR CUT — what the cut has now:',
        '- s4-flashback has no video. Name it in one sentence; do not offer to render it, and do not name any buttons.',
        '- s2-cup: a spoken line (1.2–3.0 s) is cut off at its end. Move the out point outside the line, or let it run on with an L cut.',
        'Fix what you can with ONE more propose_cut_ops call, or say plainly what is left. Do not claim the cut is finished if a line above still holds.',
    ].join('\n'));
    assert.equal(cutCheckText([{ code: 'TAKES', node_id: 3 }], null), null, 'notes alone say nothing');
    assert.match(cutSectionText(findings), /^THE CUT:\n- s4-flashback[\s\S]*- s5-run: 1\.4 s of still frames/);
    assert.equal(cutSectionText([]), 'THE CUT: nothing to fix.');
});

test('every critic line, for every code, is free of button words and control names', () => {
    const all = [
        { code: 'GAP', beat_tag: 's4' }, { code: 'MISSING_FILE', beat_tag: 's4' }, { code: 'STALE', beat_tag: 's4' },
        { code: 'UNMEASURED', beat_tag: 's4' }, { code: 'ORDER_GUESSED' }, { code: 'MIXED_ASPECT', text: 'Clips have different shapes: 16:9, 9:16.' },
        { code: 'RUNTIME_OFF', text: 'The cut is 0:30; the plan asked for 0:45.' }, { code: 'OVER_RUNTIME', text: 'The cut is 1:30; the plan asked for 0:45.' },
        { code: 'LINE_CUT_OFF', beat_tag: 's2', edge: 'in', line: [0, 900] }, { code: 'DEAD_AIR', beat_tag: 's2', span: [0, 2000] },
        { code: 'LOUDNESS_OFF', beat_tag: 's2', lu: -7.5 }, { code: 'MUSIC_ENDS_EARLY', text: 'The music ends at 0:40; the picture runs to 0:47.' },
        { code: 'SHORT', beat_tag: 's2', short_ms: 1200 }, { code: 'JUMP', text: 's1 → s2: two close-up shots at the same angle in a row (read from the briefs\' words).' },
    ];
    const lines = criticLines(all);
    assert.equal(lines.length, all.length);
    for (const line of lines) {
        for (const word of BUTTON_WORDS) assert.doesNotMatch(withoutInstruction(line), word, line);
        assert.doesNotMatch(withoutInstruction(line), /\b(render|generate|export)/i, line);
    }
});

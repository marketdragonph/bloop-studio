// Captions from the script (05-irresistible.md §5.5): words, timing, the 32-character split, the caps, the .srt
// and where a plate sits in each shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPTIONS, captionCues, checkCaptionText, placeCaption, scriptLines, toSrt, wrapLines } from '../src/shared/cut-captions.js';

const item = (id, tag) => ({ id, beat_tag: tag });

test('script lines lose their speaker tags; wrapping keeps whole words at 32 characters', () => {
    assert.deepEqual(scriptLines('[VO] The night market opens.\n[@aiko (quietly)] Two, please.\n\n[on camera] Thanks!'),
        ['The night market opens.', 'Two, please.', 'Thanks!']);
    const lines = wrapLines('The lanterns come on one by one along the river while the stalls open');
    assert.ok(lines.every((l) => l.length <= 32), lines.join('|'));
    assert.deepEqual(lines, ['The lanterns come on one by one', 'along the river while the stalls', 'open']);
    assert.deepEqual(wrapLines('a'.repeat(70)), ['a'.repeat(32), 'a'.repeat(32), 'a'.repeat(6)]);
});

test('one line per measured span maps one to one; longer words spread over the window by length', () => {
    const items = [item('i1', 's1-open'), item('i2', 's2-cup')];
    const speech = [
        { item_id: 'i1', from_ms: 1000, to_ms: 2000 }, { item_id: 'i1', from_ms: 2500, to_ms: 3200 },
        { item_id: 'i2', from_ms: 5000, to_ms: 9000 },
    ];
    const words = { 's1-open': '[VO] Here we are.\n[@aiko] Finally.', 's2-cup': '[@ren] I have walked past this stall every night for ten years and never once stopped to buy a cup.' };
    const { cues } = captionCues({ items, speech, textOf: (i) => words[i.beat_tag] });
    assert.deepEqual(cues.slice(0, 2).map((c) => [c.id, c.from_ms, c.to_ms, c.lines]), [
        ['c1', 1000, 2000, ['Here we are.']], ['c2', 2500, 3200, ['Finally.']],
    ]);
    const second = cues.filter((c) => c.item_id === 'i2');
    assert.equal(second.length, 2);
    assert.equal(second[0].from_ms, 5000);
    assert.equal(second.at(-1).to_ms, 9000);
    assert.equal(second[0].to_ms, second[1].from_ms, 'back to back, no gap');
    assert.ok(second.every((c) => c.lines.length <= 2 && c.lines.every((l) => l.length <= 32)));
});

test('no words or no measured line: no caption; three a clip at most (the last one marked); fifty a cut', () => {
    const none = captionCues({ items: [item('a', 'x')], speech: [], textOf: () => 'Words' });
    assert.deepEqual(none.cues, []);
    const long = 'word '.repeat(80).trim();
    const one = captionCues({ items: [item('a', 'x')], speech: [{ item_id: 'a', from_ms: 0, to_ms: 9000 }], textOf: () => long });
    assert.equal(one.cues.length, 3);
    assert.deepEqual(one.trimmed, ['x']);
    assert.match(one.cues[2].lines.at(-1), /…$/);
    const items = Array.from({ length: 20 }, (_, i) => item(`i${i}`, `s${i}`));
    const speech = items.map((it, i) => ({ item_id: it.id, from_ms: i * 10_000, to_ms: i * 10_000 + 9000 }));
    const many = captionCues({ items, speech, textOf: () => long });
    assert.equal(many.cues.length, CAPTIONS.maxCues);
    assert.equal(many.dropped, 10);
    assert.equal(many.cues.at(-1).id, 'c50');
});

test('the .srt: numbered from 1, comma milliseconds, CRLF, two lines kept', () => {
    const srt = toSrt([{ from_ms: 1000, to_ms: 2500, lines: ['Here we are.'] }, { from_ms: 3_725_004, to_ms: 3_726_000, lines: ['One', 'two'] }]);
    assert.equal(srt, '1\r\n00:00:01,000 --> 00:00:02,500\r\nHere we are.\r\n\r\n2\r\n01:02:05,004 --> 01:02:06,000\r\nOne\r\ntwo\r\n');
});

test('plates: scaled from the 1080 reference, centred, above each platform’s safe line, never wider than 90 %', () => {
    const plate = { width: 900, height: 160 };
    assert.deepEqual(placeCaption({ width: 1080, height: 1920, shape: '9:16' }, plate), { w: 900, h: 160, x: 90, y: 1338 });
    assert.deepEqual(placeCaption({ width: 1920, height: 1080, shape: '16:9' }, plate), { w: 900, h: 160, x: 510, y: 834 });
    assert.deepEqual(placeCaption({ width: 720, height: 720, shape: '1:1' }, plate), { w: 600, h: 106, x: 60, y: 542 });
    const wide = placeCaption({ width: 1080, height: 1920, shape: '9:16' }, { width: 1400, height: 160 });
    assert.ok(wide.w <= 972, `${wide.w} fits 90 % of 1080`);
});

test('caption fixes: beat → words, at most 300 characters', () => {
    assert.equal(checkCaptionText({ 's2-cup': 'Two cups, please.' }), null);
    assert.match(checkCaptionText({ 's2-cup': 'x'.repeat(301) }), /at most 300/);
    assert.match(checkCaptionText(['x']), /not readable/);
});

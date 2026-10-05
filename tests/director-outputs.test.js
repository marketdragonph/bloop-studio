// The Director's `outputs` op (05-irresistible.md §5.6): "make this ready for TikTok" sets up the preset, the
// shapes and the captions in the cut's settings, says the crop will be soft when the clips are another shape, and
// never sets a crop box, never queues an export and never names a control. One undo per turn takes it back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { directorCutFixture, BUTTON_WORDS, withoutInstruction } from './director-cut-fixture.js';

let f;
before(async () => { f = await directorCutFixture('dir-outputs-'); });
after(() => f.close());

const TAGS = ['s1-open', 's2-cup', 's3-run'];
const exportsMade = () => f.db.prepare("SELECT COUNT(*) n FROM cut_exports WHERE kind = 'export'").get().n;
const clean = (text) => {
    for (const word of BUTTON_WORDS) assert.doesNotMatch(withoutInstruction(text), word, `no control named in: ${text}`);
};

test('"make this ready for TikTok": preset, shapes, captions set up; the soft-crop sentence; no export, no job', async () => {
    const b = await f.stitched('tiktok', TAGS);
    const t = f.turn(b.space.id, 'make this ready for TikTok with captions');
    const r = f.run('propose_cut_ops', { ops: [{ op: 'outputs', preset: 'tiktok', shapes: ['9:16'], captions: 'burned' }] }, t);
    assert.equal(r.ok, true, r.content);
    assert.match(r.content, /^Done — 1 export setup; the cut is now 0:12 \(was 0:12\), revision 2\./);
    assert.match(r.content, /The clips are 16:9, so 9:16 crops into each one from the middle and the picture gets softer: say that in one sentence\. The person moves the crop boxes; you never do\./);
    assert.match(r.content, /Nothing was rendered or exported\./);
    clean(r.content);
    const cut = f.cuts.current(b.space.id);
    assert.deepEqual(cut.settings.outputs, { preset: 'tiktok', shapes: ['9:16'], captions: 'burned' });
    assert.ok(cut.items.every((i) => !i.frame), 'no crop box set');
    assert.equal(exportsMade(), 0, 'no cut_exports row');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM jobs').get().n, 0);
    assert.equal(f.runner.starts, 0);
    assert.equal(f.packs.length, 0);
    const row = f.turns.repo.find(t.ledger.cutTurnId);
    assert.deepEqual(row.ops_summary.map((s) => s.text), ['Set up for TikTok · 9:16 · captions burned in']);
});

test('a crop box or an export in any op is refused whole, in words; nothing changes', async () => {
    const b = await f.stitched('refuse', TAGS);
    const before = f.cuts.current(b.space.id);
    const t = f.turn(b.space.id, 'make it vertical and move the crop left on the whole cut');
    const r = f.run('propose_cut_ops', { ops: [
        { op: 'outputs', preset: 'reels', frame: { '9:16': { x: 0 } } },
        { op: 'outputs', shapes: ['9:16'], export: true },
        { op: 'sound', beat: 's1-open', on: true, crop: { x: 0 } },
        { op: 'outputs', shapes: ['4:3'] },
        { op: 'outputs' },
    ] }, t);
    assert.equal(r.ok, false);
    assert.match(r.content, /^NOTHING was changed in the cut/);
    assert.match(r.content, /op 1: Crop boxes are the person's to move; you never set them\. Leave `frame` out\./);
    assert.match(r.content, /op 2: You never start an export; the person does\. Leave `export` out/);
    assert.match(r.content, /op 3: Crop boxes are the person's to move; you never set them\. Leave `crop` out\./);
    assert.match(r.content, /op 4: The shapes are 16:9, 9:16 and 1:1, each once\./);
    assert.match(r.content, /op 5: an outputs op sets `preset`, `shapes`, `captions` or `caption_text`\./);
    assert.equal(f.cuts.current(b.space.id).revision, before.revision);
    assert.equal(exportsMade(), 0);
});

test('caption fixes: a clip the person changed needs them to name it; an empty fix takes it back; undo outputs only', async () => {
    const b = await f.stitched('fixes', TAGS);
    const cut = f.cuts.current(b.space.id);
    f.edits.save(b.space.id, { items: cut.items.map((i) => (i.beat_tag === 's2-cup' ? { ...i, out_ms: i.out_ms - 500 } : i)), revision: cut.revision, by: 'person' });
    const locked = f.run('propose_cut_ops', { ops: [{ op: 'outputs', caption_text: { 's2-cup': 'Two cups, please.' } }] }, f.turn(b.space.id, 'fix the caption typo'));
    assert.equal(locked.ok, false);
    assert.match(locked.content, /s2-cup was changed by the person after you placed it, so it is theirs\./);
    const missing = f.run('propose_cut_ops', { ops: [{ op: 'outputs', caption_text: { 's9-gone': 'x' } }] }, f.turn(b.space.id, 'fix s9'));
    assert.match(missing.content, /s9-gone is not in the cut, so it has no caption to fix\./);

    const named = f.turn(b.space.id, 'fix the caption on s2-cup and burn captions in');
    const ok = f.run('propose_cut_ops', { ops: [{ op: 'outputs', captions: 'burned', caption_text: { 's2-cup': ' Two cups, please. ' } }] }, named);
    assert.equal(ok.ok, true, ok.content);
    assert.doesNotMatch(ok.content, /crops into/, 'no other shape asked: no soft-crop sentence');
    assert.deepEqual(f.cuts.current(b.space.id).settings.outputs, { captions: 'burned', caption_text: { 's2-cup': 'Two cups, please.' } });
    const item = f.cuts.current(b.space.id).items.find((i) => i.beat_tag === 's2-cup');
    assert.notEqual(item.person_rev, null, 'a caption fix never takes the clip from the person');

    // "undo the export set-up, keep the rest": the outputs go back to what they were before that turn.
    const undo = f.run('propose_cut_ops', { ops: [{ op: 'undo_turn', kinds: ['outputs'] }] }, f.turn(b.space.id, 'undo the caption change'));
    assert.equal(undo.ok, true, undo.content);
    assert.equal(f.cuts.current(b.space.id).settings.outputs, undefined);
    clean(ok.content);
    assert.equal(exportsMade(), 0);
});

test('inspect_cut shows the export set-up and says the crop boxes are the person’s', async () => {
    const b = await f.stitched('inspect', TAGS);
    f.run('propose_cut_ops', { ops: [{ op: 'outputs', preset: 'shorts', shapes: ['9:16', '16:9'] }] }, f.turn(b.space.id, 'ready for Shorts and YouTube'));
    for (const tag of TAGS) f.measure(b.clips[tag].take.media_path, { duration_ms: 4000 });
    const r = await f.run('inspect_cut', {}, f.turn(b.space.id, 'how is it set up?'));
    assert.match(r.content, /Export set up: shorts, shapes 9:16 \+ 16:9\. Crop boxes are the person's\./);
});

// The Music lane (bug 2026-10-06: a score the Director made never reached the timeline). One source: the lanes and
// the export play the cut's own sound; a board card the cut has not got is offered. Add new clips brings the music
// in when the cut has none (not a card taken off on purpose), and the Director's `music` op puts a card on the lane,
// takes it off, and undoes as one kind.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { directorCutFixture } from './director-cut-fixture.js';
import { fakeDock, flush, withItems } from './cut-dock-fakes.js';

let f;
before(async () => { f = await directorCutFixture('cut-music-'); });
after(() => f.close());

const TAGS = ['s1-open', 's2-cup', 's3-run'];
const audio = (spaceId, label) => f.clip(spaceId, label, 50_000, { type: 'audio', mime: 'audio/mpeg' }).node;

test('BoardCut: a "Score" card counts as music; the cut\'s own bed is the bed whatever its name; others are offered', () => {
    const b = f.board('reader', TAGS, TAGS, { music: false });
    const score = audio(b.space.id, 'Score');
    const read = (cut) => f.boardCut.read(b.space.id, { cut });
    assert.deepEqual(read({ items: [] }).beds.map((x) => [x.kind, x.node_id, x.in_cut]), [['music', score.id, false]]);

    const sfx = audio(b.space.id, 'rain sfx');
    const held = read({ items: [], sound: { music: { node_id: sfx.id, take_id: null, media_path: 'x/rain.mp3' } } }).beds[0];
    assert.deepEqual([held.node_id, held.label, held.in_cut, held.media_url], [sfx.id, 'rain sfx', true, '/media/x/rain.mp3']);
    assert.deepEqual(f.boardCut.soundCards(b.space.id).map((c) => c.node_id), [sfx.id, score.id], 'every sound card, newest first');
});

test('Add new clips brings the music in when the cut has none, but never a card taken off on purpose', () => {
    const b = f.board('add new', TAGS, ['s1-open'], { music: false });
    f.drafts.draft(b.space.id, { mode: 'fill' });
    assert.equal(f.cuts.current(b.space.id).sound, null);
    const score = audio(b.space.id, 'score');
    const added = f.drafts.draft(b.space.id, { mode: 'add_new' });
    assert.equal(added.drafted, true, 'the score alone is something new');
    assert.equal(added.music, 'score');
    assert.equal(f.cuts.current(b.space.id).sound.music.node_id, score.id);

    const cut = f.cuts.current(b.space.id);
    f.edits.save(b.space.id, { items: cut.items, sound: null, revision: cut.revision, by: 'person' });
    assert.equal(f.cuts.current(b.space.id).settings.music_off, score.id);
    assert.equal(f.drafts.draft(b.space.id, { mode: 'add_new' }).reason, 'nothing_new', 'the person took it off: it stays off');
});

test('stitch_cut add_new says the music went on the lane', () => {
    const b = f.board('stitch music', TAGS, TAGS, { music: false });
    const t = f.turn(b.space.id, 'cut it together');
    f.run('stitch_cut', { mode: 'fill' }, t);
    audio(b.space.id, 'soundtrack');
    const r = f.run('stitch_cut', { mode: 'add_new' }, f.turn(b.space.id, 'add the new stuff'));
    assert.match(r.content, /^"soundtrack" on the Music lane; the cut is/);
    assert.match(r.content, /no clip was added; "soundtrack" on the Music lane/);
});

test('the music op: puts a card on the lane, replaces it keeping the level, takes it off; undo takes back only the music', async () => {
    const b = await f.stitched('music op', TAGS, TAGS, { music: false });
    const score = audio(b.space.id, 'Score');
    const other = audio(b.space.id, 'Theme');
    const ops = (list, words = 'add the score') => f.run('propose_cut_ops', { ops: list }, f.turn(b.space.id, words));

    const insp = await f.run('inspect_cut', {}, f.turn(b.space.id, 'is there music?'));
    assert.match(insp.content, new RegExp(`Sound cards on the board, not in the cut .*@${other.id} "Theme".*@${score.id} "Score"`));

    let r = ops([{ op: 'music', card: `@${score.id}` }]);
    assert.equal(r.ok, true, r.content);
    assert.match(r.content, /- Music: "Score" on the Music lane/);
    assert.equal(f.cuts.current(b.space.id).sound.music.node_id, score.id);
    assert.ok(f.cuts.current(b.space.id).sound.music.media_path, 'pinned to its file for the export');

    ops([{ op: 'level', track: 'music', gain_db: -6 }], 'music up');
    r = ops([{ op: 'music', card: `@${other.id}` }], 'use the theme instead');
    assert.match(r.content, /"Theme" on the Music lane, in place of the music before/);
    assert.equal(f.cuts.current(b.space.id).sound.music.gain_db, -6, 'the level carries over');

    r = f.run('propose_cut_ops', { ops: [{ op: 'undo_turn', kinds: ['music'] }] }, f.turn(b.space.id, 'undo the music change'));
    assert.equal(r.ok, true, r.content);
    assert.equal(f.cuts.current(b.space.id).sound.music.node_id, score.id);

    r = ops([{ op: 'music', off: true }], 'no music');
    assert.equal(f.cuts.current(b.space.id).sound, null);
    assert.equal(f.cuts.current(b.space.id).settings.music_off, score.id, 'off on purpose: Add new clips leaves it off');
});

test('the music op refuses plainly: unknown card, both fields, nothing to take off', async () => {
    const b = await f.stitched('music refusals', TAGS, TAGS, { music: false });
    const score = audio(b.space.id, 'Score');
    const ops = (list) => f.run('propose_cut_ops', { ops: list }, f.turn(b.space.id, 'music'));
    assert.match(ops([{ op: 'music', card: '@99999' }]).content, new RegExp(`@99999 is not a sound card .* The sound cards are: @${score.id} "Score"`));
    assert.match(ops([{ op: 'music', card: `@${score.id}`, off: true }]).content, /one of the two/);
    assert.match(ops([{ op: 'music', off: true }]).content, /the cut has no music, so there is nothing to take off/);
    assert.equal(f.cuts.current(b.space.id).sound, null);
});

test('the dock: a cut with no music shows none and offers the card; Use as music, Take off, Undo', async (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([11, 12]));
    assert.equal(dock.cutBeds.music, null, 'the export would play no music, so the lane shows none');
    assert.equal(dock.cutOffered.music.node_id, 20);

    dock.cutUseBed('music');
    assert.equal(dock.cutSound.music.node_id, 20);
    assert.equal(dock.cutBeds.music.node_id, 20);
    assert.equal(dock.cutOffered.music, null);
    assert.equal(dock.cutAnnounce, 'music bed is the music now.');

    dock.cutBedOff('music');
    assert.equal(dock.cutSound, null);
    assert.equal(dock.cutBeds.music, null);
    assert.equal(dock.cutOffered.music.node_id, 20);
    await dock.cutUndo();
    assert.equal(dock.cutBeds.music.node_id, 20, 'undo puts it back on the lane');
    await flush();
});

test('the dock: an empty cut\'s draft plays the board\'s music (a fill takes it in)', (t) => {
    const { dock } = fakeDock(t);
    dock.cutApply(withItems([]));
    assert.equal(dock.cutBeds.music.node_id, 20);
    assert.equal(dock.cutOffered.music, null);
});

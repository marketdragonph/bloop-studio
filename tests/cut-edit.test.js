// The person's edits on the Cut (src/shared/cut-edit.js): pure, never changing their input, clamped by the
// rule file (cut-rules.js) and the one clock (cut-clock.js), so the dock never sends a cut the server refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MIN_CLIP_MS, NUDGE_MS, TRIM_SLACK_MS, dissolveRefusal, itemFromSlot, itemsRefusal, levelOf, mediaPathOf,
    mediaUrlOf, moveItem, nudgeItem, removeItem, sameCut, setEdgeAt, toggleJoin, toggleSound, trimItem, useTake, withLevel,
} from '../src/shared/cut-edit.js';
import { checkItems, checkSound } from '../src/shared/cut-rules.js';

const item = (id, seconds_ms, extra = {}) => ({
    id, node_id: Number(id.slice(1)), take_id: 1, beat_tag: id, media_path: `spaces/1/${id}.mp4`,
    seconds_ms, in_ms: 0, out_ms: seconds_ms, sound: true, join: { type: 'cut', ms: 0 }, placed_by: 'director', ...extra,
});
const cut = () => [item('n1', 4000), item('n2', 6000, { note: 'Cut on action' }), item('n3', 3000)];
const ids = (items) => items.map((i) => i.id);

test('media urls and paths round trip (spaces and # survive)', () => {
    const path = 'spaces/7/takes/a b#1.mp4';
    assert.equal(mediaUrlOf(path), '/media/spaces/7/takes/a%20b%231.mp4');
    assert.equal(mediaPathOf(mediaUrlOf(path)), path);
    assert.equal(mediaPathOf('https://example.com/x.mp4'), null);
});

test('a ready slot becomes a whole clip that the server rules accept', () => {
    const slot = { node_id: 12, take_id: 4, beat_tag: 's2-arrival', state: 'ready', seconds: 8.2, media_url: '/media/spaces/1/t%204.mp4' };
    const clip = itemFromSlot(slot);
    assert.deepEqual([clip.in_ms, clip.out_ms, clip.seconds_ms, clip.media_path, clip.sound], [0, 8200, 8200, 'spaces/1/t 4.mp4', true]);
    assert.equal(checkItems([clip]), null);
});

test('move: the item travels, the input is untouched, a person edit clears the Director note', () => {
    const before = cut();
    const after = moveItem(before, 1, 0);
    assert.deepEqual(ids(after), ['n2', 'n1', 'n3']);
    assert.deepEqual(ids(before), ['n1', 'n2', 'n3'], 'pure');
    assert.equal(after[0].note, undefined);
    assert.equal(before[1].note, 'Cut on action');
    assert.equal(moveItem(before, 0, -4)[0].id, 'n1', 'clamped at the start');
    assert.deepEqual(ids(moveItem(before, 0, 99)), ['n2', 'n3', 'n1'], 'clamped at the end');
});

test('trim clamps: 0 ≤ in, in + 100 ms ≤ out ≤ length + 50 ms, whole milliseconds', () => {
    const items = cut();
    assert.equal(trimItem(items, 0, { in_ms: -500 }), items, 'nothing to change returns the same list');
    assert.deepEqual(pick(trimItem(items, 0, { in_ms: 1200.4 })[0]), [1200, 4000]);
    assert.deepEqual(pick(trimItem(items, 0, { in_ms: 3990 })[0]), [4000 - MIN_CLIP_MS, 4000]);
    assert.deepEqual(pick(trimItem(items, 0, { out_ms: 9000 })[0]), [0, 4000 + TRIM_SLACK_MS]);
    assert.deepEqual(pick(trimItem(items, 0, { out_ms: 20 })[0]), [0, MIN_CLIP_MS]);
    assert.equal(checkItems(trimItem(items, 0, { out_ms: 9000 })), null, 'the slack is what the server allows');
    assert.deepEqual(pick(nudgeItem(items, 2, 'out', -NUDGE_MS)[2]), [0, 2900]);
    assert.deepEqual(pick(nudgeItem(items, 2, 'in', NUDGE_MS)[2]), [100, 3000]);
    assert.deepEqual(pick(setEdgeAt(items, 1, 'in', 2500)[1]), [2500, 6000]);
    assert.deepEqual(pick(setEdgeAt(items, 1, 'out', 2500)[1]), [0, 2500]);
});

const pick = (i) => [i.in_ms, i.out_ms];

test('remove takes the item out (never the card); a new first item has no join', () => {
    const items = toggleJoin(cut(), 1).items;
    const after = removeItem(items, 0);
    assert.deepEqual(ids(after), ['n2', 'n3']);
    assert.deepEqual(after[0].join, { type: 'cut' });
    assert.deepEqual(ids(removeItem(cut(), 1)), ['n1', 'n3']);
});

test('join chip: cut ↔ dissolve 500 ms; refused on the first clip and when a clip is too short', () => {
    const { items, refused } = toggleJoin(cut(), 2);
    assert.equal(refused, null);
    assert.deepEqual(items[2].join, { type: 'dissolve', ms: 500 });
    assert.deepEqual(toggleJoin(items, 2).items[2].join, { type: 'cut' });
    assert.match(toggleJoin(cut(), 0).refused, /first clip/);
    const short = trimItem(cut(), 2, { out_ms: 400 });
    assert.match(dissolveRefusal(short, 2), /half a second/);
    assert.equal(toggleJoin(short, 2).items, short, 'a refusal changes nothing');
    const jl = cut();
    jl[1] = { ...jl[1], join: { type: 'cut', ms: 0, audio_ms: -400 } };
    assert.equal(toggleJoin(jl, 1).items[1].join.audio_ms, undefined, 'a dissolve drops a J/L offset');
});

test('clip sound and Use new take (trim kept when it fits, reset when it does not)', () => {
    assert.equal(toggleSound(cut(), 0)[0].sound, false);
    assert.equal(toggleSound(toggleSound(cut(), 0), 0)[0].sound, true);
    const trimmed = trimItem(cut(), 1, { in_ms: 1000, out_ms: 5000 });
    const longer = useTake(trimmed, 1, { take_id: 9, media_path: 'spaces/1/n2-b.mp4', seconds_ms: 7000 });
    assert.equal(longer.clamped, false);
    assert.deepEqual([longer.items[1].take_id, ...pick(longer.items[1])], [9, 1000, 5000]);
    const shorter = useTake(trimmed, 1, { take_id: 10, media_path: 'spaces/1/n2-c.mp4', seconds_ms: 3000 });
    assert.equal(shorter.clamped, true);
    assert.deepEqual(pick(shorter.items[1]), [1000, 3000]);
    assert.equal(checkItems(shorter.items), null);
});

test('itemsRefusal is the rule file: 50 clips, 10 minutes', () => {
    assert.equal(itemsRefusal(cut()), null);
    const many = Array.from({ length: 51 }, (_, i) => item(`n${i + 1}`, 1000));
    assert.match(itemsRefusal(many), /at most 50/);
    const long = Array.from({ length: 11 }, (_, i) => item(`n${i + 1}`, 60_000));
    assert.match(itemsRefusal(long), /limit is 10:00/);
});

test('bed levels: default −12 dB for music, clamped −24..+6, a new bed joins the sound in a shape the server accepts', () => {
    assert.equal(levelOf(null, 'music'), -12);
    assert.equal(levelOf(null, 'voice'), 0);
    const bed = { node_id: 20, take_id: 3, media_url: '/media/spaces/1/song.mp3' };
    const sound = withLevel(null, 'music', bed, -14.4);
    assert.deepEqual(sound.music, { fade_out_ms: 1500, node_id: 20, take_id: 3, media_path: 'spaces/1/song.mp3', gain_db: -14 });
    assert.equal(checkSound(sound), null);
    assert.equal(withLevel(sound, 'music', bed, 40).music.gain_db, 6);
    const voiced = withLevel(sound, 'voice', { node_id: 21, media_url: '/media/v.wav' }, -3);
    assert.deepEqual([voiced.voice.gain_db, voiced.voice.start_ms, voiced.music.gain_db], [-3, 0, -14]);
    assert.equal(checkSound(voiced), null);
    assert.equal(withLevel(null, 'music', null, 0), null, 'no bed, nothing to set');
});

test('sameCut: the server\'s stamps and join shape are the same cut; a trim or a level is not', () => {
    const mine = { items: cut(), sound: null };
    const saved = {
        items: cut().map((i, k) => ({ ...i, join: { type: 'cut' }, media_path: `stored/${k}.mp4`, placed_by: 'person', person_rev: 4 })),
        sound: null,
    };
    assert.equal(sameCut(mine, saved), true);
    assert.equal(sameCut(mine, { items: trimItem(cut(), 0, { out_ms: 3000 }), sound: null }), false);
    const music = withLevel(null, 'music', { node_id: 9, media_url: '/media/m.mp3' }, -12);
    assert.equal(sameCut({ items: [], sound: music }, { items: [], sound: { music: { ...music.music, media_path: 'x.mp3' } } }), true);
    assert.equal(sameCut({ items: [], sound: music }, { items: [], sound: withLevel(music, 'music', null, -6) }), false);
    assert.deepEqual(removeItem(cut(), 0)[0].join, { type: 'cut' }, 'the dock writes the join the server stores');
});

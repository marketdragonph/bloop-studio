// Windows-safe names for exports, packs and zip entries (05-irresistible.md §5.2, 01-core.md §8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAME_MAX, safeName, safePath, slugName, storyFileName } from '../src/shared/safe-name.js';

test('characters Windows refuses become a hyphen; the person\'s words stay', () => {
    assert.equal(safeName('Night <Market>: "final"?'), 'Night -Market- -final-');
    assert.equal(safeName('a/b\\c|d*e'), 'a-b-c-d-e');
    assert.equal(safeName('tab\there\nnew'), 'tab-here-new');
    assert.equal(safeName('Café Noir'), 'Café Noir');
});

test('reserved device names get a prefix, with or without an extension', () => {
    for (const name of ['CON', 'con', 'PRN', 'AUX', 'NUL', 'COM1', 'lpt9', 'nul.txt', 'Con .mp4']) {
        assert.ok(safeName(name).startsWith('_'), name);
    }
    assert.equal(safeName('CONTROL'), 'CONTROL');
    assert.equal(safeName('com10'), 'com10');
});

test('no trailing dot or space, never empty, at most 80 characters', () => {
    assert.equal(safeName('draft. . '), 'draft');
    assert.equal(safeName('...'), 'untitled');
    assert.equal(safeName(''), 'untitled');
    assert.equal(safeName(null, { fallback: 'cut' }), 'cut');
    const long = safeName('x'.repeat(200));
    assert.equal(long.length, NAME_MAX);
    const emoji = safeName('🎬'.repeat(100));
    assert.equal([...emoji].length, NAME_MAX); // never half a surrogate pair
    assert.ok(!safeName(`${'a'.repeat(79)} .`).endsWith(' '));
});

test('slugs and story file names', () => {
    assert.equal(slugName('Night Market!'), 'night-market');
    assert.equal(slugName('  Été à Paris  '), 'ete-a-paris');
    assert.equal(slugName('東京の夜'), '東京の夜');
    assert.equal(slugName('***'), 'cut');
    assert.equal(slugName('con'), '_con');
    assert.equal(storyFileName({ story: 'Night Market', preset: 'youtube', revision: 12, ext: 'mp4' }), 'night-market-youtube-r12.mp4');
    assert.equal(storyFileName({ story: 'Night Market', preset: 'youtube', revision: 12, ext: 'jpg', suffix: '-poster' }), 'night-market-youtube-r12-poster.jpg');
    assert.equal(storyFileName({ story: 'Night Market', preset: 'master', revision: 3, ext: 'mp4', n: 2 }), 'night-market-master-r3-2.mp4');
    const long = storyFileName({ story: 'word '.repeat(60), preset: 'master', revision: 999, ext: 'mp4' });
    assert.ok(long.length <= NAME_MAX && long.endsWith('-master-r999.mp4'));
});

test('paths: every segment made safe, no climbing out', () => {
    assert.equal(safePath('beats/01-s1:open/AUX.mp4'), 'beats/01-s1-open/_AUX.mp4');
    assert.equal(safePath('../../etc/passwd'), 'etc/passwd');
    assert.equal(safePath('a\\b/./c'), 'a/b/c');
});

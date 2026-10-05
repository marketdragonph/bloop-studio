// Two things the Mini Katana final gate found in the real dock (katana.md "Final gate"):
// 1. A cut of only missing beats showed the gap slate AND "No clips yet" on top of each other in the preview.
// 2. At 390 px the rail scrolled Export (the dock's main key) off the right edge, with no sign it was there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the preview says "No clips yet" only while no gap slate is showing', () => {
    const preview = read('src/server/views/pages/spaces/cut/preview.edge');
    const empty = preview.match(/<p class="cut-preview__empty" x-show="([^"]+)"/);
    assert.ok(empty, 'the empty line is there');
    assert.match(empty[1], /^!slate && /, 'it hides while a slate plays');
    assert.match(preview, /<div class="cut-slate" x-show="slate"/);
});

test('Export and the fold key sit in the rail end group, pinned on a narrow window', () => {
    const rail = read('src/server/views/pages/spaces/cut/rail.edge');
    const end = rail.slice(rail.indexOf('<div class="cut-rail__end">'));
    assert.ok(rail.includes('<div class="cut-rail__end">'));
    assert.match(end, /data-control="cut\.export"/);
    assert.match(end, /data-control="cut\.fold"/);
    assert.equal((rail.match(/data-control="cut\.export"/g) ?? []).length, 1, 'one Export key on the rail');
    const narrow = read('public/css/cut-narrow.css');
    const block = narrow.match(/\.cut-rail__end \{([^}]+)\}/)?.[1] ?? '';
    assert.match(block, /position: sticky;/);
    assert.match(block, /background: var\(--bg-secondary\);/);
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|!important/i, 'tokens only');
    assert.match(read('public/css/cut.css'), /\.cut-rail__end \{ display: flex;/);
});

// AA contrast for every Katana surface, in light and dark, measured from the tokens (02-dock.md §10, P5):
// text 4.5:1; playhead, handles, clip edges, join chips, gap hatching, duck bands, ticks and focus rings 3:1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkContrast, PAIRS, ratio, readTokens, resolve } from '../scripts/katana-contrast.mjs';

test('the resolver reads the tokens the way the browser does', () => {
    const tokens = readTokens();
    assert.equal(tokens['--accent'], '#F97316');
    assert.deepEqual(resolve('var(--bg-secondary)', 'light', tokens), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual(resolve('var(--bg-secondary)', 'dark', tokens), { r: 17, g: 17, b: 19, a: 1 });
    const half = resolve('color-mix(in srgb, white 50%, black)', 'dark', tokens);
    assert.deepEqual([half.r, half.a], [127.5, 1]);
    const seam = resolve('color-mix(in srgb, white 26%, transparent)', 'dark', tokens);
    assert.deepEqual([Math.round(seam.r), seam.a], [255, 0.26], 'mixing with transparent keeps the colour, scales alpha (premultiplied)');
    assert.equal(Math.round(ratio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })), 21);
});

test('every Katana pair holds AA in both themes', () => {
    const rows = checkContrast();
    assert.equal(rows.length, PAIRS.length * 2);
    const failed = rows.filter((r) => !r.ok).map((r) => `${r.theme} ${r.name}: ${r.ratio} < ${r.min}`);
    assert.deepEqual(failed, []);
});

test('orange marks on a theme ground use --accent-mark (plain --accent is 2.8:1 on white)', () => {
    const css = ['cut-tracks.css', 'cut-edit.css', 'cut-director.css'].map((f) => readFileSync(new URL(`../public/css/${f}`, import.meta.url), 'utf8')).join('\n');
    for (const selector of ['.cut-playhead {', '.cut-clip.is-selected {', '.cut-handle::after {']) {
        const at = css.indexOf(selector);
        assert.ok(at >= 0, selector);
        const block = css.slice(at, css.indexOf('}', at));
        assert.match(block, /var\(--accent-mark\)/, `${selector} must use --accent-mark`);
    }
});

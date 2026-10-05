import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateVersion } from '../scripts/build-installer.mjs';

test('date versions have no leading zeros and always grow', () => {
    assert.equal(dateVersion(new Date(2026, 9, 2, 14, 35)), '2026.1002.1435');
    assert.equal(dateVersion(new Date(2027, 0, 5, 9, 5)), '2027.105.905');
    const order = [new Date(2026, 9, 2, 9, 5), new Date(2026, 9, 2, 14, 35), new Date(2026, 11, 31, 0, 0), new Date(2027, 0, 1, 0, 1)]
        .map((d) => dateVersion(d).split('.').map(Number));
    for (let i = 1; i < order.length; i++) {
        const [a, b] = [order[i - 1], order[i]];
        assert.ok(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2]))), `${a} < ${b}`);
    }
});

test('the notices list the bundled FFmpeg as a native program with its licence and source', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { nativeComponents, renderNotices } = await import('../scripts/third-party-notices.mjs');
    const root = mkdtempSync(join(tmpdir(), 'notices-'));
    try {
        assert.deepEqual(nativeComponents(root), [], 'nothing fetched, nothing listed');
        const dir = join(root, 'vendor', 'ffmpeg');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'LICENSE.txt'), 'GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3');
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
            name: 'FFmpeg', version: 'n7.1.5', license: 'LGPL-3.0-or-later', source: 'https://github.com/FFmpeg/FFmpeg/tree/abc',
            url: 'https://example.invalid/ffmpeg.zip', sha256: 'f'.repeat(64), buildScripts: 'https://example.invalid/scripts', configure: '--enable-version3',
        }));
        const natives = nativeComponents(root);
        assert.equal(natives.length, 1);
        const text = renderNotices([{ name: 'hono', version: '4.0.0', license: 'MIT', text: 'MIT text' }], natives);
        assert.match(text, /Native programs, run as separate processes:\n {2}FFmpeg n7\.1\.5 - LGPL-3\.0-or-later/);
        assert.match(text, /source: https:\/\/github\.com\/FFmpeg\/FFmpeg\/tree\/abc, run as a separate program/);
        assert.match(text, /GNU LESSER GENERAL PUBLIC LICENSE/);
        assert.doesNotMatch(renderNotices([]), /Native programs/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

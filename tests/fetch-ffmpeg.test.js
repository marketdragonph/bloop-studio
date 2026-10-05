import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureFlags, ensureGplText, GPL_TEXT, licenceId, licenceProblem, PINNED } from '../scripts/fetch-ffmpeg.mjs';
import { nativeComponents } from '../scripts/third-party-notices.mjs';

const LGPL3 = `ffmpeg is free software; you can redistribute it and/or modify
it under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation; either version 3 of the License, or
(at your option) any later version.`;

test('the pinned build is an LGPL win64 zip with a full sha256', () => {
    assert.match(PINNED.url, /^https:\/\/github\.com\/BtbN\/FFmpeg-Builds\/releases\/download\/autobuild-[\d-]+\//);
    assert.match(PINNED.name, /-win64-lgpl(-shared)?-/);
    assert.ok(PINNED.url.endsWith(PINNED.name));
    assert.match(PINNED.sha256, /^[0-9a-f]{64}$/);
    assert.ok(PINNED.size > 1_000_000);
});

test('a GPL or nonfree configure line is refused; version3 alone is LGPL', () => {
    const conf = '  configuration:\n  --prefix=/ffbuild --enable-version3 --enable-shared --disable-libfdk-aac';
    assert.deepEqual(configureFlags(conf), ['--prefix=/ffbuild', '--enable-version3', '--enable-shared', '--disable-libfdk-aac']);
    assert.equal(licenceProblem(conf), null);
    assert.match(licenceProblem(`${conf} --enable-gpl --enable-libx264`), /not LGPL \(--enable-gpl\)/);
    assert.match(licenceProblem(`${conf} --enable-nonfree`), /--enable-nonfree/);
    assert.match(licenceProblem('no flags here'), /no configure flags/);
});

test('the licence id comes from ffmpeg -L', () => {
    assert.equal(licenceId(LGPL3), 'LGPL-3.0-or-later');
    assert.equal(licenceId(LGPL3.replace('version 3', 'version 2.1')), 'LGPL-2.1-or-later');
    assert.equal(licenceId(LGPL3.replace('Lesser ', '')), null, 'a GPL build is not LGPL');
});

test('COPYING.GPLv3: the official gnu.org text with its own pinned sha256', () => {
    assert.equal(GPL_TEXT.file, 'COPYING.GPLv3');
    assert.equal(GPL_TEXT.url, 'https://www.gnu.org/licenses/gpl-3.0.txt');
    assert.match(GPL_TEXT.sha256, /^[0-9a-f]{64}$/);
    assert.equal(GPL_TEXT.size, 35149);
});

test('ensureGplText writes the text only when its hash matches the pin, and fetches nothing when it is there', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'bloop-gpl-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const text = Buffer.from('                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n');
    const pin = { ...GPL_TEXT, size: text.length, sha256: createHash('sha256').update(text).digest('hex') };
    const dir = join(root, 'ffmpeg');
    const cache = join(root, 'cache');
    const asked = [];
    const serve = (body) => async (url, options) => { asked.push([url, options.headers['User-Agent']]); return new Response(body, { status: 200 }); };

    await assert.rejects(ensureGplText({ dir, cache, pin, fetchImpl: serve(Buffer.alloc(text.length, 32)) }), /checksum|SHA-256/);
    assert.equal(existsSync(join(dir, 'COPYING.GPLv3')), false, 'a wrong text is never installed');

    assert.equal(await ensureGplText({ dir, cache, pin, fetchImpl: serve(text) }), true);
    assert.deepEqual(readFileSync(join(dir, 'COPYING.GPLv3')), text);
    assert.match(asked.at(-1)[1], /bloop-studio-build/, 'gnu.org refuses the default Node user agent');
    const calls = asked.length;
    assert.equal(await ensureGplText({ dir, cache, pin, fetchImpl: serve(text) }), false);
    assert.equal(asked.length, calls, 'already in place: no download');
});

test('the GPL text kept in the repo matches the pin and is used without asking gnu.org', async (t) => {
    const bundled = fileURLToPath(new URL('../build/licenses/gpl-3.0.txt', import.meta.url));
    assert.equal(createHash('sha256').update(readFileSync(bundled)).digest('hex'), GPL_TEXT.sha256);
    const root = mkdtempSync(join(tmpdir(), 'bloop-gpl-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dir = join(root, 'ffmpeg');
    const refuse = async () => { throw new Error('gnu.org must not be asked'); };
    assert.equal(await ensureGplText({ dir, cache: join(root, 'cache'), bundled, fetchImpl: refuse }), true);
    assert.deepEqual(readFileSync(join(dir, 'COPYING.GPLv3')), readFileSync(bundled));
});

test('the notices list COPYING.GPLv3 beside the LGPL text for ffmpeg', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'bloop-notices-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dir = join(root, 'vendor', 'ffmpeg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ name: 'FFmpeg', version: 'n7', license: 'LGPL-3.0-or-later', source: 's', url: 'u', sha256: 'h', buildScripts: 'b', configure: '--enable-version3' }));
    writeFileSync(join(dir, 'LICENSE.txt'), 'GNU LESSER GENERAL PUBLIC LICENSE');
    assert.doesNotMatch(nativeComponents(root)[0].text, /COPYING\.GPLv3/);
    writeFileSync(join(dir, 'COPYING.GPLv3'), 'GNU GENERAL PUBLIC LICENSE');
    const [ffmpeg] = nativeComponents(root);
    assert.ok(ffmpeg.text.includes('LICENSE.txt (GNU LGPL 3.0) and COPYING.GPLv3 (GNU GPL 3.0'));
    assert.ok(ffmpeg.text.indexOf('GNU LESSER') < ffmpeg.text.indexOf('\nGNU GENERAL'), 'both texts, LGPL first');
});

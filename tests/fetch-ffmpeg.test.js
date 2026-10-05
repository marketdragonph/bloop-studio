import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureFlags, licenceId, licenceProblem, PINNED } from '../scripts/fetch-ffmpeg.mjs';

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

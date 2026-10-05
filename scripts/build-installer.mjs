// Builds the Windows installer with an automatic date version, so nobody manages version numbers.
// The version is YEAR.MONTHDAY.HOURMINUTE (e.g. 2026.1002.1435): later builds always compare higher,
// which is all the auto-updater needs. package.json's own "version" is left alone.
// Usage: npm run dist   (installer, blockmap and latest.yml in dist/; the Release workflow uploads them)
import { existsSync, writeFileSync } from 'node:fs';
import { build, Platform } from 'electron-builder';
import { nativeComponents, NOTICES_PATH, productionPackages, renderNotices } from './third-party-notices.mjs';

/** No leading zeros (semver forbids them): 2 Oct 14:35 -> 2026.1002.1435, 5 Jan 09:05 -> 2027.105.905. */
export function dateVersion(at = new Date()) {
    const monthDay = (at.getMonth() + 1) * 100 + at.getDate();
    const hourMinute = at.getHours() * 100 + at.getMinutes();
    return `${at.getFullYear()}.${monthDay}.${hourMinute}`;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    const version = dateVersion();
    const natives = nativeComponents();
    if (!natives.some((n) => n.name === 'FFmpeg')) {
        console.error('vendor/ffmpeg is missing: run npm run fetch:ffmpeg first (npm run dist does).');
        process.exit(1);
    }
    // The LGPL-3.0 builds on the GPL-3.0: both texts ship beside ffmpeg (fetch-ffmpeg.mjs writes COPYING.GPLv3).
    if (!['LICENSE.txt', 'COPYING.GPLv3'].every((f) => existsSync(new URL(`../vendor/ffmpeg/${f}`, import.meta.url)))) {
        console.error('vendor/ffmpeg has no LICENSE.txt or COPYING.GPLv3: run npm run fetch:ffmpeg again.');
        process.exit(1);
    }
    writeFileSync(NOTICES_PATH, renderNotices(productionPackages(), natives));
    console.log(`Building Bloop Studio ${version}`);
    await build({
        targets: Platform.WINDOWS.createTarget(),
        config: { extraMetadata: { version } },
        publish: 'never', // .github/workflows/release.yml publishes (draft first, with retries)
    });
    console.log(`Done: dist/Bloop-Studio-Setup-${version}.exe`);
}

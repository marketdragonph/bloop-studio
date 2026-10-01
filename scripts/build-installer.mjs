// Builds the Windows installer with an automatic date version, so nobody manages version numbers.
// The version is YEAR.MONTHDAY.HOURMINUTE (e.g. 2026.1002.1435): later builds always compare higher,
// which is all the auto-updater needs. package.json's own "version" is left alone.
// Usage: npm run dist
import { build, Platform } from 'electron-builder';

/** No leading zeros (semver forbids them): 2 Oct 14:35 -> 2026.1002.1435, 5 Jan 09:05 -> 2027.105.905. */
export function dateVersion(at = new Date()) {
    const monthDay = (at.getMonth() + 1) * 100 + at.getDate();
    const hourMinute = at.getHours() * 100 + at.getMinutes();
    return `${at.getFullYear()}.${monthDay}.${hourMinute}`;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    const version = dateVersion();
    console.log(`Building Bloop Studio ${version}`);
    await build({
        targets: Platform.WINDOWS.createTarget(),
        config: { extraMetadata: { version } },
        publish: 'never',
    });
    console.log(`Done: dist/Bloop-Studio-Setup-${version}.exe`);
}

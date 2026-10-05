// Puts a pinned LGPL ffmpeg for Windows x64 in vendor/ffmpeg/ (git-ignored), which electron-builder ships as
// resources/ffmpeg (package.json build.extraResources), where locateFfmpeg() looks. Owner decision 1
// (docs/plans/katana.md §8): LGPL only, encode with Windows' h264_mf / aac_mf, no GPL anywhere. BtbN's LGPL builds
// configure --enable-version3 (libopencore-amr, gmp, libaribb24), so the program is LGPL-3.0-or-later.
// The zip is checked against its pinned SHA-256; the build is refused when its configure line enables GPL or
// nonfree parts. vendor/ffmpeg gets ffmpeg.exe, ffprobe.exe, their DLLs (a shared build: the LGPL libraries stay
// separate, replaceable files), LICENSE.txt and manifest.json (read by third-party-notices.mjs).
// Usage: npm run fetch:ffmpeg   (npm run dist runs it; it does nothing when the pinned build is already in place)
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, sha256Of } from '../src/server/engine-install/download.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const FFMPEG_DIR = join(ROOT, 'vendor', 'ffmpeg');
export const MANIFEST_PATH = join(FFMPEG_DIR, 'manifest.json');
const CACHE_DIR = join(ROOT, 'vendor', '.cache');

/** The one build we ship. Month-end BtbN autobuilds are kept long term; change all fields together. */
export const PINNED = Object.freeze({
    name: 'ffmpeg-n7.1.5-12-g1fdbca85aa-win64-lgpl-shared-7.1.zip',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-31-14-10/ffmpeg-n7.1.5-12-g1fdbca85aa-win64-lgpl-shared-7.1.zip',
    size: 62425578,
    sha256: '0f376f96fb38554ccefb1b2ae9c7c6a7b351f0e60a372b38262c320e8392c5d0',
    version: 'n7.1.5-12-g1fdbca85aa',
    source: 'https://github.com/FFmpeg/FFmpeg/tree/1fdbca85aa',
    buildScripts: 'https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-07-31-14-10',
});

/** Configure flags that would make the build GPL or unredistributable. --enable-version3 alone means LGPL-3.0. */
export const FORBIDDEN_FLAGS = ['--enable-gpl', '--enable-nonfree'];

/** The configure flags from `ffmpeg -buildconf` (or a `configuration:` line), one per entry. */
export function configureFlags(buildconf) {
    return buildconf.split(/\s+/).map((s) => s.trim()).filter((s) => s.startsWith('--'));
}

/** Null when the build is fine to ship, else the plain reason it is not. */
export function licenceProblem(buildconf) {
    const flags = configureFlags(buildconf);
    if (!flags.length) return 'ffmpeg -buildconf printed no configure flags.';
    const bad = FORBIDDEN_FLAGS.filter((flag) => flags.includes(flag));
    return bad.length ? `this ffmpeg build is not LGPL (${bad.join(', ')}); Bloop Studio ships no GPL or nonfree code.` : null;
}

/** SPDX id from `ffmpeg -L` ("LGPL-3.0-or-later"), or null when it is not an LGPL text. */
export function licenceId(text) {
    const flat = text.replace(/\s+/g, ' ');
    if (!/under the terms of the GNU Lesser General Public License/i.test(flat)) return null;
    const version = flat.match(/either version ([\d.]+) of the License/i)?.[1];
    if (!version) return null;
    const spdx = version.includes('.') ? version : `${version}.0`;
    return `LGPL-${spdx}${/any later version/i.test(flat) ? '-or-later' : '-only'}`;
}

function run(bin, args) {
    const result = spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed (exit ${result.status}): ${result.stderr.trim()}`);
    return `${result.stdout}${result.stderr}`;
}

function readManifest() {
    try {
        return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    } catch {
        return null;
    }
}

const inPlace = () => {
    const manifest = readManifest();
    return manifest?.sha256 === PINNED.sha256 && ['ffmpeg.exe', 'ffprobe.exe'].every((f) => existsSync(join(FFMPEG_DIR, f)));
};

/** Windows' own bsdtar reads zip files (Windows 10 1803 and later, and the GitHub Windows runners). */
function unzip(zip, into) {
    rmSync(into, { recursive: true, force: true });
    mkdirSync(into, { recursive: true });
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    run(tar, ['-xf', zip, '-C', into]);
    const [top] = readdirSync(into);
    if (!top || !existsSync(join(into, top, 'bin', 'ffmpeg.exe'))) throw new Error(`${PINNED.name} has no bin/ffmpeg.exe.`);
    return join(into, top);
}

/** Copies the two programs, their DLLs and the licence; ffplay is not shipped. */
function install(extracted) {
    rmSync(FFMPEG_DIR, { recursive: true, force: true });
    mkdirSync(FFMPEG_DIR, { recursive: true });
    const bin = join(extracted, 'bin');
    const files = readdirSync(bin).filter((f) => f === 'ffmpeg.exe' || f === 'ffprobe.exe' || f.toLowerCase().endsWith('.dll'));
    for (const file of files) copyFileSync(join(bin, file), join(FFMPEG_DIR, file));
    copyFileSync(join(extracted, 'LICENSE.txt'), join(FFMPEG_DIR, 'LICENSE.txt'));
    return files;
}

export async function fetchFfmpeg({ log = console.log } = {}) {
    if (process.platform !== 'win32') throw new Error('fetch-ffmpeg: the pinned build is for Windows x64.');
    if (inPlace()) {
        log(`ffmpeg: ${PINNED.version} already in ${FFMPEG_DIR}`);
        return readManifest();
    }
    const zip = join(CACHE_DIR, PINNED.name);
    log(`ffmpeg: downloading ${PINNED.url}`);
    let last = 0;
    await download(PINNED, zip, {
        onProgress: (done, total) => {
            const pct = Math.floor((done / total) * 10) * 10;
            if (pct > last) log(`ffmpeg: ${(last = pct)}%`);
        },
    });
    // download() trusts a finished file of the right size; check the hash every time anyway.
    const hash = await sha256Of(zip);
    if (hash !== PINNED.sha256) {
        rmSync(zip, { force: true });
        throw new Error(`fetch-ffmpeg: ${PINNED.name} has SHA-256 ${hash}, pinned ${PINNED.sha256}. Deleted; nothing installed.`);
    }

    const files = install(unzip(zip, join(CACHE_DIR, 'extract')));
    const exe = join(FFMPEG_DIR, 'ffmpeg.exe');
    const buildconf = run(exe, ['-hide_banner', '-buildconf']);
    const problem = licenceProblem(buildconf);
    if (problem) {
        rmSync(FFMPEG_DIR, { recursive: true, force: true });
        throw new Error(`fetch-ffmpeg: refused, ${problem}`);
    }
    const licence = licenceId(run(exe, ['-hide_banner', '-L']));
    if (!licence) {
        rmSync(FFMPEG_DIR, { recursive: true, force: true });
        throw new Error('fetch-ffmpeg: refused, ffmpeg -L does not print an LGPL licence.');
    }
    const encoders = run(exe, ['-hide_banner', '-encoders']);
    const manifest = {
        name: 'FFmpeg',
        version: PINNED.version,
        license: licence,
        source: PINNED.source,
        buildScripts: PINNED.buildScripts,
        url: PINNED.url,
        sha256: PINNED.sha256,
        configure: configureFlags(buildconf).join(' '),
        encoders: ['h264_mf', 'aac_mf', 'aac'].filter((name) => new RegExp(`\\s${name}\\s`).test(encoders)),
        files: [...files, 'LICENSE.txt'].sort(),
    };
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    rmSync(join(CACHE_DIR, 'extract'), { recursive: true, force: true });
    log(`ffmpeg: ${manifest.version} -> ${FFMPEG_DIR}`);
    log(`ffmpeg: licence: ${licence}`);
    log(`ffmpeg: built-in encoders: ${manifest.encoders.join(', ')}`);
    return manifest;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    try {
        await fetchFfmpeg();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

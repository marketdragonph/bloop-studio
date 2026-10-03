// Writes build/THIRD-PARTY-NOTICES.txt (ASCII header, readable in any viewer): every production dependency shipped in the installer with its
// license text, as MIT / Apache-2.0 / OFL require when redistributing. Electron and Chromium ship their
// own notices (LICENSE.electron.txt, LICENSES.chromium.html) next to the app.
// Usage: node scripts/third-party-notices.mjs   (npm run dist runs it)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const NOTICES_PATH = join(ROOT, 'build', 'THIRD-PARTY-NOTICES.txt');

const licenseOf = (pkg) =>
    (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type) ?? (pkg.licenses ?? []).map((l) => l.type).join(' OR ') ?? 'UNKNOWN';

/** Production dependencies, resolved the way Node does (nested node_modules first). */
export function productionPackages(root = ROOT) {
    const found = new Map();
    const visit = (name, from) => {
        if (found.has(name)) return;
        const nested = join(from, 'node_modules', name);
        const dir = existsSync(join(nested, 'package.json')) ? nested : join(root, 'node_modules', name);
        if (!existsSync(join(dir, 'package.json'))) return;
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
        const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
        found.set(name, { name, version: pkg.version, license: licenseOf(pkg), text: file ? readFileSync(join(dir, file), 'utf8').trim() : null, repo });
        for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir);
    };
    const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    for (const dep of Object.keys(app.dependencies ?? {})) visit(dep, root);
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function renderNotices(packages) {
    const rule = '-'.repeat(78);
    const head = [
        'Bloop Studio - third-party notices',
        '',
        'Bloop Studio is proprietary software, (c) MarketDragon, all rights reserved.',
        'It includes the open-source components below, each under its own license.',
        'Electron and Chromium notices: LICENSE.electron.txt and LICENSES.chromium.html in the install folder.',
        '',
        ...packages.map((p) => `  ${p.name}@${p.version} - ${p.license}`),
    ];
    const bodies = packages.map((p) => [
        rule,
        `${p.name}@${p.version} - ${p.license}`,
        p.repo ? `Source: ${p.repo.replace(/^git\+/, '')}` : null,
        '',
        p.text ?? `Licensed under ${p.license}. The package ships no license file; see its source repository for the full text.`,
    ].filter((line) => line !== null).join('\n'));
    return `${head.join('\n')}\n\n${bodies.join('\n\n')}\n`;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    const packages = productionPackages();
    writeFileSync(NOTICES_PATH, renderNotices(packages));
    console.log(`notices: ${packages.length} packages -> ${NOTICES_PATH}`);
}

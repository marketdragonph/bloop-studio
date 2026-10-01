// Copies browser libraries and fonts into public/vendor so the app works fully offline.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'public', 'vendor');

const copies = [
    ['node_modules/htmx.org/dist/htmx.min.js', 'htmx.min.js'],
    ['node_modules/alpinejs/dist/module.esm.js', 'alpine.esm.js'],
    ['node_modules/@fontsource/inter/files', 'fonts/inter'],
    ['node_modules/@fontsource/orbitron/files', 'fonts/orbitron'],
];

for (const [from, to] of copies) {
    const target = join(vendor, to);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, from), target, { recursive: true });
}

console.log(`vendor: copied ${copies.length} entries to public/vendor`);

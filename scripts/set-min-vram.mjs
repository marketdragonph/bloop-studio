// One-off: records each workflow variant's graphics-memory need (`minVramGb`), the same tiers the
// installer suggests from (engine-install/plan.js): full-precision sets 20 GB, int8 / fp8 sets 11 GB
// (12 GB cards report ~11.99), Z-Image int8 and Wan 5B 8 GB.
//   node scripts/set-min-vram.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../workflows/', import.meta.url);
const NEEDS = [
    [/^zimage-.*\.int8\.json$/, 8],
    [/^zimage-.*\.json$/, 20],
    [/^h3-.*\.int8\.json$/, 11],
    [/^h3-.*\.json$/, 20],
    [/^ltx-.*\.json$/, 11],
    [/^wan5b-.*\.json$/, 8],
];

for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const need = NEEDS.find(([pattern]) => pattern.test(name))?.[1];
    if (!need) throw new Error(`No VRAM tier for ${name}`);
    const text = readFileSync(new URL(name, dir), 'utf8');
    const flow = JSON.parse(text);
    if (flow.minVramGb === need) continue;
    // Placed right after `variant`, keeping the file's own formatting otherwise.
    const updated = /"minVramGb":/.test(text)
        ? text.replace(/"minVramGb":\s*\d+(\.\d+)?/, `"minVramGb": ${need}`)
        : text.replace(/("variant":\s*"[^"]*",)/, `$1\n  "minVramGb": ${need},`);
    if (JSON.parse(updated).minVramGb !== need) throw new Error(`Could not set ${name}`);
    writeFileSync(new URL(name, dir), updated);
    console.log(name, need);
}

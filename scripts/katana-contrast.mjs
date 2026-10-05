// AA contrast for every Katana surface, measured from the tokens (02-dock.md §10, P5). It reads the :root custom
// properties of tokens.css and mecha.css, resolves light-dark(), var() and color-mix(in srgb, …) the way the browser
// does (premultiplied alpha), composites each colour over the layers under it, and checks the pairs below in BOTH
// themes: text 4.5:1 (WCAG 1.4.3), and 3:1 for the marks a person must see (1.4.11): playhead, handles, clip edges,
// join chips, gap hatching and edges, duck bands, ticks and focus rings. Pictures are dark in both themes, so text
// on a media chip is checked over a white frame too (the worst picture under it).
// Usage: node scripts/katana-contrast.mjs   (tests/katana-contrast.test.js runs the same check)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = ['tokens.css', 'mecha.css'].map((f) => fileURLToPath(new URL(`../public/css/${f}`, import.meta.url)));
export const THEMES = Object.freeze(['light', 'dark']);

/** Custom properties declared in top-level `:root { … }` blocks (not inside @media). */
export function readTokens(files = CSS) {
    const tokens = {};
    for (const file of files) {
        const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        let depth = 0;
        let i = 0;
        while (i < css.length) {
            const open = css.indexOf('{', i);
            if (open < 0) break;
            const head = css.slice(i, open).trim().split(/[;}]/).pop().trim();
            if (depth === 0 && head === ':root') {
                const close = css.indexOf('}', open);
                for (const [, name, value] of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[name] = value.trim();
                i = close + 1;
                continue;
            }
            // Skip any other block, nested blocks included.
            let level = 0;
            let j = open;
            for (; j < css.length; j++) {
                if (css[j] === '{') level++;
                else if (css[j] === '}' && --level === 0) break;
            }
            i = j + 1;
            depth = 0;
        }
    }
    return tokens;
}

/** Splits on commas outside parentheses. */
function args(text) {
    const out = [];
    let level = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '(') level++;
        else if (text[i] === ')') level--;
        else if (text[i] === ',' && level === 0) {
            out.push(text.slice(start, i).trim());
            start = i + 1;
        }
    }
    out.push(text.slice(start).trim());
    return out;
}

const call = (expr, name) => (expr.startsWith(`${name}(`) && expr.endsWith(')') ? expr.slice(name.length + 1, -1) : null);

function hex(text) {
    let h = text.slice(1);
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (k) => Number.parseInt(h.slice(k, k + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

/** A resolved colour {r, g, b (0–255), a (0–1)} for a CSS colour expression in a theme. */
export function resolve(expr, theme, tokens = readTokens()) {
    const e = expr.trim();
    if (e === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (e === 'white') return { r: 255, g: 255, b: 255, a: 1 };
    if (e === 'black') return { r: 0, g: 0, b: 0, a: 1 };
    if (e.startsWith('#')) return hex(e);
    let inner = call(e, 'var');
    if (inner != null) {
        const [name, fallback] = args(inner);
        if (tokens[name] != null) return resolve(tokens[name], theme, tokens);
        if (fallback != null) return resolve(fallback, theme, tokens);
        throw new Error(`Unknown token ${name}`);
    }
    inner = call(e, 'light-dark');
    if (inner != null) return resolve(args(inner)[theme === 'light' ? 0 : 1], theme, tokens);
    inner = call(e, 'rgb') ?? call(e, 'rgba');
    if (inner != null) {
        const parts = inner.replace('/', ' / ').split(/[\s,/]+/).filter(Boolean).map(Number);
        return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    }
    inner = call(e, 'color-mix');
    if (inner != null) {
        const [space, first, second] = args(inner);
        if (space !== 'in srgb') throw new Error(`Only srgb mixes are measured: ${e}`);
        const part = (text) => {
            const m = text.match(/^(.*?)(?:\s+([\d.]+)%)?$/);
            return { color: resolve(m[1], theme, tokens), pct: m[2] == null ? null : Number(m[2]) / 100 };
        };
        const a = part(first);
        const b = part(second);
        const p = a.pct ?? (b.pct == null ? 0.5 : 1 - b.pct);
        const q = b.pct ?? 1 - p;
        // Premultiplied interpolation, as CSS Color 5 specifies.
        const alpha = a.color.a * p + b.color.a * q;
        const mix = (k) => (alpha ? (a.color[k] * a.color.a * p + b.color[k] * b.color.a * q) / alpha : 0);
        return { r: mix('r'), g: mix('g'), b: mix('b'), a: alpha };
    }
    throw new Error(`Cannot measure ${e}`);
}

/** `top` drawn over `under` (normal blending). */
export const over = (top, under) => {
    const a = top.a + under.a * (1 - top.a);
    const ch = (k) => (a ? (top[k] * top.a + under[k] * under.a * (1 - top.a)) / a : 0);
    return { r: ch('r'), g: ch('g'), b: ch('b'), a };
};

const linear = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ({ r, g, b }) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** WCAG contrast ratio of two opaque colours. */
export function ratio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** A stack, bottom first: each layer is composited over the ones under it. */
export function flatten(layers, theme, tokens) {
    return layers.reduce((under, layer) => over(resolve(layer, theme, tokens), under), { r: 0, g: 0, b: 0, a: 1 });
}

// ── The surfaces ──
const DOCK = ['var(--bg-secondary)']; // the dock, its sheets, the lanes and the level popover
const KEY = [...DOCK, 'var(--bg-tertiary)', 'color-mix(in srgb, var(--text-primary) 18%, var(--bg-tertiary))']; // .ae-key fill
const VOICE = [...DOCK, 'color-mix(in srgb, var(--text-primary) 9%, var(--bg-secondary))'];
const TURN = [...DOCK, 'color-mix(in srgb, var(--sensor) 8%, var(--bg-secondary))'];
const MEASURE = [...DOCK, 'color-mix(in srgb, var(--sensor) 10%, var(--bg-secondary))'];
const SNAP_ON = [...DOCK, 'color-mix(in srgb, var(--sensor) 14%, transparent)'];
const PICK_ON = [...DOCK, 'color-mix(in srgb, var(--accent) 8%, var(--bg-secondary))'];
const WHITE_FRAME = ['white'];
const BLACK_FRAME = ['black'];
const CHIP = [...WHITE_FRAME, 'var(--media-chip)'];
const CAPTION = [...WHITE_FRAME, 'var(--media-scrim-deck)'];

const text = (name, fg, bg) => ({ name, fg, bg, min: 4.5, kind: 'text' });
const mark = (name, fg, bg) => ({ name, fg, bg, min: 3, kind: 'mark' });

/** Every Katana pair. `fg` is one colour (composited over `bg`); `bg` is a stack, bottom first. */
export const PAIRS = Object.freeze([
    text('Primary text (dock, sheets)', 'var(--text-primary)', DOCK),
    text('Secondary text (rows, gap words, save chip)', 'var(--text-secondary)', DOCK),
    text('Muted text (ruler labels, "Not measured", notes)', 'var(--text-muted)', DOCK),
    text('Stencil and readout ink', 'var(--ae-stencil-ink)', DOCK),
    text('Orange text (join dissolve, links)', 'var(--accent-text)', DOCK),
    text('Sensor text (saving, measuring, Director)', 'var(--sensor-text)', DOCK),
    text('Alert text (not saved, failed)', 'var(--status-alert-text)', DOCK),
    text('Warn text (sheet notes)', 'var(--status-warn-text)', DOCK),
    text('Key label', 'var(--text-primary)', KEY),
    text('Key label on hover', 'var(--accent-text)', [...DOCK, 'var(--bg-tertiary)', 'color-mix(in srgb, var(--accent) 14%, var(--bg-tertiary))']),
    text('Export key (ink on orange)', 'var(--ink-on-accent)', ['var(--accent)']),
    text('Playhead cap time', 'var(--ink-on-accent)', ['var(--accent)']),
    text('Voice span label', 'var(--text-secondary)', VOICE),
    text('Director strip head', 'var(--sensor-text)', TURN),
    text('Measuring line', 'var(--sensor-text)', MEASURE),
    text('Snap to beats, on', 'var(--sensor-text)', SNAP_ON),
    text('Picked preset or shape', 'var(--text-primary)', PICK_ON),
    text('Gap words (on their own patch of lane ground over the hatch)', 'var(--text-secondary)', DOCK),
    text('Clip tag and length on a media chip (white frame)', 'var(--on-media)', CHIP),
    text('Caption over a white frame', 'var(--on-media)', CAPTION),
    text('Slate words', 'var(--on-media)', ['var(--media-ground)', 'var(--media-chip)']),
    mark('Playhead line', 'var(--accent-mark)', DOCK),
    mark('Trim handle', 'var(--accent-mark)', DOCK),
    mark('Selected clip edge', 'var(--accent-mark)', DOCK),
    mark('Clip edge', 'var(--cut-clip-edge)', DOCK),
    mark('Join chip edge', 'var(--ae-seam-control)', DOCK),
    mark('Gap hatch stripe', 'var(--cut-hatch)', DOCK),
    mark('Gap edge (dashed)', 'var(--ae-seam-control)', DOCK),
    mark('Duck band top (dashed)', 'var(--sensor)', DOCK),
    mark('Ruler tick', 'var(--cut-tick)', DOCK),
    mark('Ruler tick, whole second', 'var(--text-secondary)', DOCK),
    mark('Beat tick', 'var(--sensor)', DOCK),
    mark('Waveform', 'var(--cut-wave)', DOCK),
    mark('Focus ring (keys, clips, rows)', 'var(--text-primary)', DOCK),
    mark('Focus ring on a handle (inner bar)', 'var(--text-primary)', DOCK),
    mark('Crop box keyline over a white frame', 'var(--media-ground)', WHITE_FRAME),
    mark('Crop box edge over a black frame', 'var(--accent)', BLACK_FRAME),
    mark('Go to card ring on the board', 'var(--accent-mark)', ['var(--bg-primary)']),
    mark('Status dot, sensor', 'var(--sensor)', DOCK),
]);

/** Every pair in every theme: [{ name, theme, kind, ratio, min, ok }]. */
export function checkContrast({ tokens = readTokens(), pairs = PAIRS } = {}) {
    const rows = [];
    for (const theme of THEMES) {
        for (const pair of pairs) {
            const bg = flatten(pair.bg, theme, tokens);
            const fg = over(resolve(pair.fg, theme, tokens), bg);
            const value = ratio(fg, bg);
            rows.push({ name: pair.name, theme, kind: pair.kind, ratio: Math.round(value * 100) / 100, min: pair.min, ok: value >= pair.min });
        }
    }
    return rows;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
    const rows = checkContrast();
    for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.theme.padEnd(5)} ${r.ratio.toFixed(2).padStart(6)} / ${r.min}  ${r.name}`);
    const failed = rows.filter((r) => !r.ok).length;
    console.log(`${rows.length - failed} of ${rows.length} pass`);
    process.exitCode = failed ? 1 : 0;
}

// The Director's Katana guide, the controls registry and the dock views must never drift apart
// (05-irresistible.md §4.1): every shipped control is in the views (data-control="<id>"), every hook in the
// views is in the registry, and the guide never names a control that has not shipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROLS, COPY, EMPTY_TEXT, KEYS, SLOT_TEXT, controlLabel, copy } from '../src/shared/katana-controls.js';
import { PHASES, SHIPPED } from '../src/shared/katana-phases.js';
import { guideKatana } from '../src/server/director/prompts/guide-katana.js';
import { GUIDE } from '../src/server/director/prompts/doctrine-plan.js';

const VIEWS = fileURLToPath(new URL('../src/server/views/', import.meta.url));
const BANNED = /gundam|rx-?78|mobile suit|zeon|zaku|amuro|char aznable|evangelion|macross|mazinger|transformers|voltron/i;
const HOOKED_SURFACES = new Set(['dock', 'board', 'settings', 'katana']);

function edgeFiles(dir) {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return edgeFiles(full);
        return name.endsWith('.edge') ? [full] : [];
    });
}

/** Every data-control="<id>" in the views (literal ids; an Edge mustache id is reported as is). */
function hooks() {
    const found = new Map();
    for (const file of edgeFiles(VIEWS)) {
        for (const m of readFileSync(file, 'utf8').matchAll(/data-control="([^"]+)"/g)) {
            if (!found.has(m[1])) found.set(m[1], file);
        }
    }
    return found;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, label) => new RegExp(`(^|[^\\w])${escape(label)}([^\\w]|$)`).test(text);

test('the registry is well formed: unique ids, known surfaces and phases, a label each', () => {
    const ids = CONTROLS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate control ids');
    for (const c of CONTROLS) {
        assert.ok(HOOKED_SURFACES.has(c.surface), `${c.id}: unknown surface ${c.surface}`);
        assert.ok(PHASES.includes(c.phase), `${c.id}: unknown phase ${c.phase}`);
        assert.ok(c.label && c.where && c.does, `${c.id}: label, where and does are required`);
        assert.equal(controlLabel(c.id), c.label);
    }
    for (const phase of SHIPPED) assert.ok(PHASES.includes(phase));
    assert.throws(() => controlLabel('cut.nope'), /Unknown Katana control/);
});

test('every shipped control has a data-control hook in the views', () => {
    const found = hooks();
    const missing = CONTROLS.filter((c) => SHIPPED.includes(c.phase) && !found.has(c.id)).map((c) => c.id);
    assert.deepEqual(missing, [], `shipped controls with no data-control="<id>" in src/server/views: ${missing.join(', ')}`);
});

test('every data-control hook in the views names a control in the registry', () => {
    const known = new Set(CONTROLS.map((c) => c.id));
    const unknown = [...hooks()].filter(([id]) => !known.has(id)).map(([id, file]) => `${id} (${file})`);
    assert.deepEqual(unknown, [], `data-control ids missing from src/shared/katana-controls.js: ${unknown.join(', ')}`);
});

test('the guide names no control that has not shipped, and explains the P1 dock', () => {
    const guide = guideKatana();
    const shippedLabels = CONTROLS.filter((c) => SHIPPED.includes(c.phase)).map((c) => c.label);
    const unshipped = CONTROLS.filter((c) => !SHIPPED.includes(c.phase))
        // "Undo" inside a shipped "Undo turn" is that shipped control, not the unshipped one.
        .filter((c) => !shippedLabels.some((label) => label !== c.label && label.includes(c.label)))
        .filter((c) => mentions(guide, c.label));
    assert.deepEqual(unshipped.map((c) => `${c.id} (${c.phase})`), []);
    for (const id of ['cut.dock', 'cut.lane.video', 'cut.lane.voice', 'cut.lane.music', 'cut.goToCard']) {
        assert.ok(mentions(guide, controlLabel(id)), `shipped ${id} is not explained in the guide`);
    }
});

test('the guide is byte-stable, short, framed as WHEN ASKED, and part of the Director GUIDE', () => {
    const guide = guideKatana();
    assert.equal(guide, guideKatana());
    assert.match(guide, /THE CUT AND KATANA\. Explain these only WHEN ASKED\. Only what is listed here exists\./);
    assert.ok(guide.length < 3000, `shipped guide is ${guide.length} chars`);
    assert.ok(GUIDE.endsWith(guide), 'doctrine-plan.js GUIDE must end with guideKatana()');
    assert.equal(guideKatana({ shipped: ['P0'] }), '');
    // With every phase shipped it still fits a small budget (the full text in 05 §4.2).
    assert.ok(guideKatana({ shipped: PHASES }).length < 4000);
});

test('the guide grows only with shipped phases, in a fixed order', () => {
    const p1 = guideKatana({ shipped: ['P0', 'P1'] });
    const p2 = guideKatana({ shipped: ['P0', 'P1', 'P2'] });
    assert.ok(p2.startsWith(p1.trimEnd()));
    assert.ok(!p1.includes(controlLabel('cut.fill')));
    assert.ok(p2.includes(controlLabel('cut.fill')));
    assert.ok(p2.includes(KEYS.join));
});

test('no franchise names in the registry, the copy or the guide', () => {
    const all = JSON.stringify({ CONTROLS, COPY, EMPTY_TEXT, SLOT_TEXT, KEYS }) + guideKatana({ shipped: PHASES });
    assert.doesNotMatch(all, BANNED);
});

test('copy() fills placeholders and shows an unknown key as itself', () => {
    assert.equal(copy('beats', { ready: 6, n: 7 }), '6 of 7 beats');
    assert.equal(copy('withGaps', { total: '0:55' }), '0:55 with gaps');
    assert.equal(copy('nope'), 'nope');
    assert.equal(COPY.notRendered, SLOT_TEXT.never_rendered);
});

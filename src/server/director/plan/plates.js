// Plates: the cast, places and props a plan names (bloop's PlateRail). Cleaning what the model sent, and the
// cards each one becomes on the rail: its look note, a reference-sheet note, the picture both feed, and a voice
// note for a speaking person. Beats are later wired to the LOOK note (words), which is what keeps a face, a
// product and a room the same on local models; the picture is the reference sheet a person can look at.
export const KINDS = ['cast', 'prop', 'location'];
const MAX_PLATES = 24;

export const slug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** PlateRail::clean: slugged unique tags, a description each, voice only on people, at most 24. */
export function cleanPlates(plates) {
    const seen = new Set();
    const out = [];
    for (const p of Array.isArray(plates) ? plates : []) {
        const tag = slug(p?.tag);
        const description = String(p?.description ?? '').trim().slice(0, 2000);
        if (!tag || !description || seen.has(tag)) continue;
        seen.add(tag);
        const kind = KINDS.includes(p.kind) ? p.kind : 'cast';
        const plate = { tag, kind, description };
        const of = slug(p.of);
        if (kind === 'cast' && of && of !== tag) plate.of = of;
        if (kind === 'cast' && !plate.of && String(p.voice ?? '').trim()) plate.voice = String(p.voice).trim().slice(0, 1200);
        out.push(plate);
        if (out.length >= MAX_PLATES) break;
    }
    return out;
}

// PlateSheet::contract, as bloop writes it under the description.
const SHEET = {
    cast: 'Reference sheet: the SAME character repeated in four views — a clear front view, three-quarter, profile, and a straight BACK view — evenly spaced on one plain white background, identical build, colouring and markings in every view, and identical wardrobe and hair if it has them, neutral pose and expression.',
    prop: 'Reference sheet: the SAME object repeated in four views — a straight FRONT view, three-quarter front, side and rear — evenly spaced on one plain white background, identical materials, finish, colour and badging in every view. The front view shows, straight on, the side a person uses or reads: a screen, a dial, a label, a face. If a person rides, enters or operates it, at least one view shows how — the cockpit or seat, the hatch open, the step or handholds — drawn as part of the object and never called out: no arrows, no dimension lines, no labels, no text anywhere in the image.',
    // A place is not a sheet: one establishing view (PlateSheetPrompt).
    location: 'One establishing view of this place: the whole space, its size, its light and its surfaces, no people, no text.',
};

/** The rail ops for plates, one lane each from `firstLane`: look note (1) + sheet note (2) → picture (3), voice (4). */
export function railOps(plates, firstLane, { withVoice }) {
    const ops = [];
    plates.forEach((p, i) => {
        const lane = firstLane + i;
        const ref = `plate-${p.tag}`.slice(0, 44);
        const name = `${p.kind}: ${p.tag}`;
        ops.push({ op: 'note', ref: `${ref}-look`, title: name, body: p.description, lane, stage: 1 });
        const sheet = /reference sheet|establishing view/i.test(p.description) ? null : SHEET[p.kind];
        if (sheet) ops.push({ op: 'note', ref: `${ref}-sheet`, title: `${name} · sheet`, body: sheet, lane, stage: 2 });
        ops.push({ op: 'node', ref, type: 'image', label: name, lane, stage: 3, aspect_ratio: p.kind === 'location' ? '16:9' : '21:9' });
        ops.push({ op: 'wire', from: `${ref}-look`, to: ref });
        if (sheet) ops.push({ op: 'wire', from: `${ref}-sheet`, to: ref });
        if (withVoice && p.voice) ops.push({ op: 'note', ref: `${ref}-voice`, title: `voice: ${p.tag}`, body: `${p.tag.toUpperCase()}: ${p.voice}`, lane, stage: 4 });
    });
    return ops;
}

/** After the rail landed: tag → { kind, look, picture, voice } node ids, for wiring beats. */
export function railMap(plates, refs) {
    const map = {};
    for (const p of plates) {
        const ref = `plate-${p.tag}`.slice(0, 44);
        if (!refs[ref]) continue;
        map[p.tag] = { kind: p.kind, look: refs[`${ref}-look`], picture: refs[ref], voice: refs[`${ref}-voice`] ?? null, of: p.of ?? null };
    }
    return map;
}

export const CARDS_PER_PLATE = 3; // look, sheet and picture; a voice note on top for speaking cast

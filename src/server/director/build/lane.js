// One written beat → its lane of cards (bloop's SpaceAgentPlan::opsFor, for a still-then-clip lane):
//   brief (5) + `· still` (6) → image (7)           the look card and the beat's plate looks wire into the still,
//                                                    and (bloop's BeatWires) the plate PICTURES, up to three, so the
//                                                    still is drawn from the sheets on Qwen-Image-Edit
//   `· motion` (8) + `· sound` (9) + `· script` (10) + image (First frame) → video (12)
// Every prompt sits on a card a person can read; the picture and clip cards hold no words of their own.
import { scriptOf, secondsFor } from './beat-writer.js';

const shotLine = (s, { still }) => {
    const parts = still
        ? [s.size, s.angle, s.lens, s.light, s.colour].filter(Boolean)
        : [s.move, s.size, s.lens, s.light].filter(Boolean);
    const avoid = s.avoid ? ` Avoid: ${s.avoid}.` : '';
    return parts.length ? `SHOT: ${parts.join(', ')}.${avoid}\n` : '';
};

/**
 * ctx: { lane, aspect, plates (tag → { kind, look, picture, voice, of }), lookId, clipFamily, editFamily, lengths, withSound }.
 * Returns { ops, seconds, dropped } — dropped: refs with no plate on the board.
 */
export function laneOps(beat, written, ctx) {
    const { lane, aspect, plates, lookId, clipFamily, editFamily, lengths, withSound } = ctx;
    const tag = beat.tag;
    const r = tag.slice(0, 30);
    const castTags = Object.entries(plates).filter(([, p]) => p.kind === 'cast').map(([t]) => t);
    const script = scriptOf(written, castTags);
    const seconds = secondsFor(written, lengths);
    const ops = [
        { op: 'note', ref: `${r}-brief`, title: tag, body: beat.brief, lane, stage: 5 },
        { op: 'note', ref: `${r}-still-words`, title: `${tag} · still`, body: `${shotLine(written.shot, { still: true })}${written.still}`, lane, stage: 6 },
        { op: 'node', ref: `${r}-still`, type: 'image', label: tag, lane, stage: 7, ...(aspect ? { aspect_ratio: aspect } : {}), ...(editFamily ? { settings: { family: editFamily } } : {}) },
        { op: 'note', ref: `${r}-motion`, title: `${tag} · motion`, body: `${shotLine(written.shot, { still: false })}${written.clip}`, lane, stage: 8 },
    ];
    if (withSound && written.sound) ops.push({ op: 'note', ref: `${r}-sound`, title: `${tag} · sound`, body: `DIEGETIC SOUND: ${written.sound}${written.shot.cue ? ` Loudest: ${written.shot.cue}.` : ''}`, lane, stage: 9 });
    if (withSound && script) ops.push({ op: 'note', ref: `${r}-script`, title: `${tag} · script`, body: script, lane, stage: 10 });
    ops.push({ op: 'node', ref: `${r}-clip`, type: 'video', label: tag, lane, stage: 12, duration: seconds, ...(aspect ? { aspect_ratio: aspect } : {}), ...(clipFamily ? { settings: { family: clipFamily } } : {}) });

    // The still: its brief and words, the board's look, and the look note of everyone and everything it uses.
    ops.push({ op: 'wire', from: `${r}-brief`, to: `${r}-still` }, { op: 'wire', from: `${r}-still-words`, to: `${r}-still` });
    if (lookId) ops.push({ op: 'wire', from: `@${lookId}`, to: `${r}-still` });
    const dropped = [];
    const used = [];
    for (const ref of beat.refs) {
        const plate = plates[ref];
        if (!plate?.look) {
            dropped.push({ tag: ref, why: 'no-plate' });
            continue;
        }
        used.push([ref, plate]);
        ops.push({ op: 'wire', from: `@${plate.look}`, to: `${r}-still` });
    }
    // The plate pictures into the still, people first, then props, then the place — three at most (the edit model's
    // limit). Their words are wired too; the pictures are what keep a face the same.
    if (editFamily) {
        const order = { cast: 0, prop: 1, location: 2 };
        const pictured = used.filter(([, p]) => p.picture).sort((a, b) => order[a[1].kind] - order[b[1].kind]).slice(0, 3);
        for (const [, plate] of pictured) ops.push({ op: 'wire', from: `@${plate.picture}`, to: `${r}-still`, socket: 'reference' });
        // bloop's image locks: which picture is who, so the edit model keeps each face and look where it belongs.
        if (pictured.length) {
            const locks = pictured.map(([ref, p], i) => `${p.kind === 'location' ? `the place ${ref}` : `@${ref}`} is picture ${i + 1}`);
            const words = ops.find((o) => o.ref === `${r}-still-words`);
            words.body += `

${locks.join('; ')}. Keep every face, hair, outfit, marking and colour exactly as in those pictures; take pose, framing, light and background from these words.`;
        }
    }
    // The clip: its first frame, what moves, what it sounds like, what is said, and who is in it.
    ops.push({ op: 'wire', from: `${r}-still`, to: `${r}-clip`, socket: 'first_frame' }, { op: 'wire', from: `${r}-motion`, to: `${r}-clip` });
    if (withSound && written.sound) ops.push({ op: 'wire', from: `${r}-sound`, to: `${r}-clip` });
    if (withSound && script) ops.push({ op: 'wire', from: `${r}-script`, to: `${r}-clip` });
    const voiced = new Set();
    for (const [ref, plate] of used) {
        if (plate.kind === 'location') continue; // the place is already in the first frame
        ops.push({ op: 'wire', from: `@${plate.look}`, to: `${r}-clip` });
        // The voice card of whoever speaks here (an outfit speaks with the person's voice).
        const person = plate.of ? plates[plate.of] : plate;
        if (withSound && person?.voice && script.includes(`@${plate.of ?? ref}`) && !voiced.has(person.voice)) {
            voiced.add(person.voice);
            ops.push({ op: 'wire', from: `@${person.voice}`, to: `${r}-clip` });
        }
    }
    return { ops, seconds, dropped };
}

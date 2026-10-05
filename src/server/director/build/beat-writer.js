// BeatWriter (ported from bloop): one model call per beat, each writer seeing only its own brief, its neighbours
// and the doctrine. It answers in a labelled form; the board turns the answer into the lane's cards. Bloop's form is
// a 2x2 storyboard grid for multi-reference clip models; here a beat is ONE still that is its clip's first frame,
// so the form asks for SHOT, STILL and CLIP instead of a sheet of panels.
import { BREVITY, CINEMATOGRAPHY, CRAFT_ROLES, PROP_FACING, STORY_CRAFT, boardRuntime, clipLength, look, orientation, spectacle } from '../prompts/doctrine-craft.js';
import { SOUND_CRAFT, voiceCraft } from '../prompts/doctrine-voice.js';

const LABELS = ['VO', 'LINE', 'SPEAKERS', 'SECONDS', 'SHOT', 'STILL', 'CLIP', 'SOUND'];
const WORDS_PER_SECOND = 2.5;

function form({ aspect, withSound, narrationHere, voiceOver, lengths }) {
    const most = Math.max(...lengths);
    const cap = ` AIM FOR ${Math.floor(most * WORDS_PER_SECOND * 0.9)} WORDS AND NEVER PASS ${Math.floor(most * WORDS_PER_SECOND)} — EVERY SPOKEN WORD IN THIS BEAT TOGETHER, VO AND LINE COMBINED. A scene with more to say CARRIES ON in the next beat.`;
    const vo = narrationHere
        ? `VO: <narration heard over this beat, spoken by nobody on screen, one line per sentence heard, in order, the words exactly as they should be said. Write the whole thought, not a caption.${cap} Leave the label out only where the beat genuinely plays better with the narrator silent. Never write "none">\n`
        : `VO: <a line heard over this beat, spoken by nobody on screen — your call, never a question: write one where this film would really have one, as a director would.${cap} None here? Leave the label out; never write "none">\n`;
    const line = voiceOver
        ? `LINE: <words spoken ON CAMERA by people in shot. ONE LINE PER THING SAID, in the order it is heard. Write only the words: a name or a stage direction here would be READ ALOUD. YOUR CALL, NEVER A QUESTION: write the lines the scene really has — ALL of them, not one clause.${cap} NONE? LEAVE THIS LABEL OUT>\nSPEAKERS: <one line per LINE above, in the same order, naming who says it and how: \`@ryo (grim, quiet)\`. Use the @tag of a cast plate so the voice matches the face. Answer it whenever there is a LINE>\n`
        : '';
    const sound = withSound ? 'SOUND: <the sound direction, as the sound designer above — the world\'s noise, never words anyone says. Omit entirely when this beat has no sound worth directing>\n' : '';
    return `

YOU ARE WRITING ONE LANE, AND NOTHING ELSE.

${aspect ? `The board is ${aspect}. Compose for that shape.` : ''}

Answer in exactly this form, no preamble and no markdown. SECONDS, SHOT, STILL and CLIP are always answered; the rest are answered only when this beat calls for them and are LEFT OUT ENTIRELY otherwise — an empty label makes an empty card.

${vo}${line}SECONDS: <how long this beat's clip runs, ONE of these and nothing else: ${lengths.join(', ')}. IF YOU WROTE VO OR LINE ABOVE, COUNT THOSE WORDS FIRST and take at least the seconds they need (about two and a half words a second): the lines come first and the clip is sized to them. AND NO DEAD AIR: four words is a four-second beat. A BEAT WITH NO LINE, on a board where people talk, takes the SHORTEST length there is>
SHOT: <one line, eight parts split by |: size | angle | lens | move | light | colour | avoid | cue. angle is where the camera IS. move is ONE move, never two. light is its source, direction, quality, colour and effect. cue is the clip's two or three loudest sounds. Example: wide | low angle | 24mm | crane up | torchlight from low left, hard and amber, long shadows up the wall | blue-black and ember orange | extra limbs, text | roar, wind, stone impact>
STILL: <the image prompt, working the art director's six steps in order, written as clauses. It is the clip's FIRST FRAME: the moment the clip starts from. Name who is in it by their @tag where it first names them. Never a camera move>
CLIP: <the clip prompt — motion and time, ending different from its start. NEVER REPEAT THE STILL, because the still IS its first frame. Write what MOVES and the ONE camera move, set off by the action. Name only who the clip's action shows>
${sound}`;
}

/** The writer's system prompt: the craft doctrine (identical across lanes first), then this lane's place. */
export function writerSystem({ intent, aspect, withSound, lengths, plan, beatCount, lane }) {
    const narrationHere = intent.narration || lane.hook || lane.resolution;
    return [
        CRAFT_ROLES, orientation(aspect), CINEMATOGRAPHY, BREVITY, spectacle(intent.register), clipLength(lengths),
        boardRuntime(plan.runtime_seconds, beatCount, Math.max(...lengths)),
        withSound ? SOUND_CRAFT : '', voiceCraft(intent.language), PROP_FACING, look(intent.look), STORY_CRAFT,
        lane.place,
        lane.poster ? '\n\nTHIS LANE IS THE POSTER BEAT — the film\'s most striking image. Give it the board\'s strongest staging and light: the boldest angle, the clearest silhouette, the biggest sense of scale or the most careful light on a face.\n' : '',
        lane.hook ? '\n\nTHIS LANE IS THE HOOK — the film\'s first 2-3 seconds. Open on the strongest image with the tension already running: no slow build, no scene-setting first.\n' : '',
        lane.resolution ? '\n\nTHIS LANE IS THE RESOLUTION — the film\'s ending. The outcome lands and the last frame holds on what it leaves: a real ending, never a trail-off.\n' : '',
        form({ aspect, withSound, narrationHere, voiceOver: intent.voice_over, lengths }),
    ].join('');
}

/** StoryCraft's per-lane contract: where this beat sits, and the beats either side (the writers never see each other). */
export function placeOf(beats, index) {
    const beat = beats[index];
    const before = beats[index - 1];
    const after = beats[index + 1];
    return `

YOUR PLACE IN THE PIECE — this is the plan, and it outranks anything you would otherwise assume about the work.

You are writing beat ${index + 1} of ${beats.length}: \`${beat.tag}\`.
${before ? `BEFORE YOU — \`${before.tag}\`: ${before.brief}\nYour first frame continues from where that one ended. Do not re-establish what it already established.` : 'NOTHING COMES BEFORE YOU. This beat opens the piece: it establishes the place and the people, and it earns the next few seconds on its own.'}
${after ? `AFTER YOU — \`${after.tag}\`: ${after.brief}\nYour last frame has to make that beat possible. Leave it what it needs and do not do its job for it.` : 'NOTHING COMES AFTER YOU. This beat lands the piece: it resolves what the earlier beats raised and it is the last thing anybody sees.'}
The other beats are being written at this same moment by other writers and you will never see a word of what they produce. Follow the plan exactly and the beats meet.
`;
}

/** The labelled answer → its parts. Lines keep their breaks; everything else is collapsed to one paragraph. */
export function parseBeat(text, brief) {
    const pick = (label, keepBreaks = false) => {
        const re = new RegExp(`^\\s*${label}\\s*:[^\\S\\n]*([\\s\\S]*?)(?=^\\s*(?:${LABELS.join('|')})\\s*:|$(?![\\s\\S]))`, 'im');
        const value = (re.exec(text)?.[1] ?? '').trim();
        return keepBreaks ? value.split('\n').map((l) => l.trim()).filter(Boolean) : value.replace(/\s+/g, ' ');
    };
    const none = (l) => !/^(none|n\/a|-)\.?$/i.test(l);
    const shot = pick('SHOT').split('|').map((s) => s.trim());
    return {
        vo: pick('VO', true).filter(none).map((l) => l.replace(/^["“]|["”]$/g, '')),
        lines: pick('LINE', true).filter(none).map((l) => l.replace(/^["“]|["”]$/g, '')),
        speakers: pick('SPEAKERS', true),
        seconds: Number(/\d+/.exec(pick('SECONDS'))?.[0]) || null,
        shot: { size: shot[0], angle: shot[1], lens: shot[2], move: shot[3], light: shot[4], colour: shot[5], avoid: shot[6], cue: shot[7] },
        still: pick('STILL') || brief,
        clip: pick('CLIP') || brief,
        sound: pick('SOUND'),
    };
}

/** The script card: `[VO] …` lines, then `[@who (how)] …` lines paired with SPEAKERS by position. */
export function scriptOf(written, castTags) {
    const out = written.vo.map((l) => `[VO] ${l}`);
    written.lines.forEach((l, i) => {
        const who = /^@?([a-z0-9-]+)\s*(\(([^)]*)\))?/i.exec(String(written.speakers[i] ?? '').trim());
        const tag = who && castTags.includes(who[1].toLowerCase()) ? who[1].toLowerCase() : null;
        out.push(tag ? `[@${tag}${who[3] ? ` (${who[3].trim()})` : ''}] ${l}` : `[on camera] ${l}`);
    });
    return out.join('\n');
}

/** Seconds the words need at 2.5 words a second, never cut: the clip is sized to the lines. */
export function secondsFor(written, lengths) {
    const words = [...written.vo, ...written.lines].join(' ').split(/\s+/).filter(Boolean).length;
    const need = Math.ceil(words / WORDS_PER_SECOND);
    const asked = written.seconds ?? lengths[Math.floor((lengths.length - 1) / 2)];
    const want = Math.max(asked, need);
    // Nearest legal length (tie → longer), never under what the words need while the menu allows.
    const sorted = [...lengths].sort((a, b) => a - b);
    const fits = sorted.filter((s) => s >= need);
    const pool = fits.length ? fits : [sorted.at(-1)];
    return pool.reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) || (Math.abs(s - want) === Math.abs(best - want) && s > best) ? s : best), pool[0]);
}

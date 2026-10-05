// plan_board and advance_build, ported from bloop's PlanBoardSkill and AdvanceBuildSkill. A plan turn puts
// NOTHING on the board: it records the approach and the plates and asks at most two or three questions. Then the
// rail goes down in stages — the cast, then the places and props — as showings, not questions.
import { CAST_NAMES } from '../prompts/doctrine-plan.js';
import { isPlaceholderName } from '../prompts/compose.js';
import { cleanPlates, CARDS_PER_PLATE } from '../plan/plates.js';
import { DESTINATION_KEYS, aspectOnBoard, destination, runtimeField, runtimeSaid } from '../plan/shape.js';
import { MAX_NODES_PER_SPACE } from '../../../shared/node-types.js';

const MAX_QUESTIONS = 3;
// Never ask about voice: dialogue, narration or a wordless cut are the Director's call (dropped in code, as bloop).
const VOICE_QUESTION = /\b(?:dialogue|dialog|voice[\s-]?overs?|voiceovers?|narrat(?:or|ion|ed)|wordless|spoken|speak(?:s|ing)?|silent|silence|music only)\b/iu;

const PLATE_ITEM = (withPhoto) => ({
    type: 'object',
    properties: {
        tag: { type: 'string', description: 'A short kebab-case handle: `<first>-<last>` for an invented person, `corner-shop` for a place.' },
        kind: { type: 'string', enum: ['cast', 'prop', 'location'] },
        of: { type: 'string', description: 'CAST ONLY, and only on an OUTFIT plate: the tag of the person wearing it — `<name>` on `<name>-school`. Leave it out on the person\'s own plate.' },
        description: { type: 'string', description: `What it looks like — this card is wired into every shot that uses it, so it is what keeps a face the same. AN INVENTED PERSON OPENS WITH THEIR FACE, written by the FACE PATTERN.${withPhoto ? ' WHEN A BOARD CARD IS A PHOTO OF THIS SUBJECT, write the description from it; never invent a look beside a photograph.' : ''} NAME EVERY GARMENT for a person, not just the outfit: top, trousers, shoes, jacket, belt, watch. NAME THE SIZE OF ANYTHING THAT IS NOT HUMAN-SIZED, in metres and against a person. IF PEOPLE RIDE, ENTER OR OPERATE IT, SAY WHERE AND HOW. Write it as you would say it; no lists, no field labels.` },
        voice: { type: 'string', description: 'CAST ONLY, and only when this person SPEAKS: one paragraph on how they sound — timbre, register, accent, cadence, their default delivery, and what the voice does under pressure. Plain direction, never numbers. Leave it out for props, places and anyone who never says a word.' },
    },
    required: ['tag', 'kind', 'description'],
});

export const planBoard = {
    name: 'plan_board',
    description: 'Say how you would approach a piece of work BEFORE building it, and ask at most two questions whose answers would change what you build. Use this the first time someone asks for something substantial on a board that has nothing on it yet — a spot, a campaign, a film, a set of posts. It puts NOTHING on the board: no cards, no wires, no changes. Name the cast, the props and the places in `plates` even when nobody asked — they are RECORDED here and go on the board at the next step. Never ask about voice: dialogue, a narrator or a wordless cut are your calls. Once they answer, put the rail down with advance_build and then build the beats; do not come back with more questions.',
    schemaFor(t) {
        return {
            type: 'object',
            properties: {
                board_title: { type: 'string', description: 'A title for this board, the way a film or campaign is titled — two to six words, no quotes. ALWAYS send it. It is used only when the board still has a placeholder name.' },
                approach: { type: 'string', description: 'How you would build it, in two or three sentences. Concrete: how many beats, what shape.' },
                questions: { type: 'array', items: { type: 'string' }, description: 'At most two. Each is a concrete proposal plus ONE named alternative, answerable in a word. NEVER about dialogue, voice-over, narration or whether it is wordless — those are yours. One sent anyway is dropped, not asked.' },
                assumptions: { type: 'array', items: { type: 'string' }, description: 'Everything else you decided for yourself rather than asking about.' },
                destination: { type: 'string', enum: DESTINATION_KEYS, description: 'Where this plays. Ask in their words — "is this for TikTok, Reels, or YouTube?" — never "what aspect ratio". The shape is worked out from this and every card is built in it.' },
                runtime_seconds: runtimeField(Math.max(...t.lengths)),
                plates: { type: 'array', description: `WHO is in it, WHAT is in it and WHERE it happens — one entry each for every recurring person, object and place. These become reference cards on the board that the shots are wired to, which is what keeps a face, a product or a room the same across every beat. Name them even when nobody asked. ONE PLATE IS ONE SUBJECT: three machines are three plates. ${CAST_NAMES}`, items: PLATE_ITEM(true) },
            },
            required: ['approach'],
        };
    },

    run(args, t) {
        const existing = t.plans.latest(t.spaceId);
        const where = destination(args.destination);
        const board = t.spaces.board(t.spaceId);
        if (existing) {
            // A second plan_board only applies corrections: never a second interview (bloop's never-re-ask rule).
            const changes = {};
            if (where) changes.aspect = where.aspect;
            if (args.runtime_seconds > 0) changes.runtime_seconds = Math.min(3600, Math.round(args.runtime_seconds));
            const plan = t.plans.update(existing.id, changes);
            if (Array.isArray(args.plates) && args.plates.length) t.stages.propose(plan, args.plates);
            const next = t.stages.owed(plan)[0];
            return {
                ok: true,
                content: 'This board has already been planned and they have already answered. Do not ask anything else. '
                    + (next ? `The next step is the ${next === 'cast' ? 'cast' : 'places and props'} — call advance_build with stage "${next}" now, or stage "all" if they have told you to get on with it.`
                        : 'The reference cards are down: build the beats now with build_board, and say plainly what you decided for yourself if anything was left open.')
                    + runtimeSaid(plan.runtime_seconds, t.lengths),
            };
        }

        const aspect = where?.aspect ?? aspectOnBoard(board.nodes);
        const asked = (args.questions ?? []).map((q) => String(q).trim().slice(0, 400)).filter(Boolean);
        const questions = asked.filter((q) => !VOICE_QUESTION.test(q)).slice(0, MAX_QUESTIONS);
        const dropped = asked.length - asked.filter((q) => !VOICE_QUESTION.test(q)).length;
        const assumptions = (args.assumptions ?? []).map((a) => String(a).trim().slice(0, 400)).filter(Boolean).slice(0, 8);
        const plan = t.plans.create(t.spaceId, {
            approach: String(args.approach ?? '').slice(0, 4000),
            questions,
            assumptions,
            aspect,
            runtimeSeconds: args.runtime_seconds > 0 ? Math.min(3600, Math.round(args.runtime_seconds)) : null,
        });
        const plates = cleanPlates(args.plates);
        const counts = t.stages.propose(plan, plates);
        t.ledger.planned(questions);

        let said = aspect
            ? `\n\nTHE SHAPE IS ${aspect}${where ? ` (for ${where.label})` : ''}. Say that back in your own words as a decision you made — "${where?.label ?? 'For where this is going'}, so I'll build it ${aspect}" — so they can correct it in one word if you guessed wrong. Every card on this board will be built in it.`
            : '\n\nYOU HAVE NO SHAPE YET and every card depends on it. Ask where it plays — name TikTok, Reels, YouTube or the feed as choices — and do not ask what aspect ratio they want; that is your job to work out from their answer.';
        said += runtimeSaid(plan.runtime_seconds, t.lengths);
        if (!counts.cast) {
            said += '\n\nYOU NAMED NOBODY. Every piece with a person in it needs a cast plate, or every shot invents its own face and the person in beat two is not the person in beat three. If this genuinely has no people in it — a product table, a landscape — say so in a clause and carry on. Otherwise NAME THEM in your reply, then send advance_build with the cast plates in `plates`.';
        } else {
            const cost = plates.length * CARDS_PER_PLATE;
            const room = MAX_NODES_PER_SPACE - board.nodes.length;
            said += `\n\n${counts.cast} in the cast and ${counts.world} place${counts.world === 1 ? '' : 's'} or prop${counts.world === 1 ? '' : 's'} — NAMED, and not on the board yet. Say who and what they are in a clause, not a list, and do not repeat their descriptions. Every shot is later wired to the ones it uses, which is what keeps a face or a product the same across beats.`;
            said += cost > room
                ? ` \n\nTHEY WILL NOT FIT. The rail needs ${cost} cards and this board has room for ${room} — and a rail one card over the limit lands NOTHING. Say that plainly BEFORE you ask them to agree to anything: propose a shorter cast, or ask what to clear off the board.`
                : ` That is ${cost} cards on the board when they go down, out of room for ${room}.`;
        }
        said += '\n\nTHE ORDER FROM HERE, and say it in half a sentence so they know how far it runs: the cast goes down first, then the places and props, then the beats — three steps, no more. Each one is you SHOWING them, not asking them: state what it is and let their next message move it on. IF THEY TELL YOU TO GET ON WITH IT — "just build it", "go", "all of it" — do not stage anything: send advance_build with stage "all" and then build_board, both in that same turn.';
        const title = String(args.board_title ?? '').trim().slice(0, 120);
        if (title && isPlaceholderName(t.spaces.find(t.spaceId)?.name)) {
            t.spaces.rename(t.spaceId, title);
            t.emit('renamed', { title });
            said += ` You also named the board "${title}" — say so in one short line; they can edit it in the header.`;
        }
        if (dropped) said += `\n\nA QUESTION ABOUT VOICE WAS DROPPED AND IS NOT BEING ASKED (${dropped}). Whether anyone speaks, whether there is a narrator, whether it plays wordless: those are YOUR calls, made beat by beat as you write, like the lens. Decide it, say what you chose in one clause, and build.`;

        if (!questions.length) {
            return { ok: true, content: `Noted. You had nothing worth asking, so say your approach in a sentence or two, say plainly what you decided for yourself, and then BUILD IT in this same turn — do not stop to be told to carry on. Nothing was asked, so nothing is waiting on them: run advance_build with stage "all" and then the beats, all in this turn.${said}` };
        }
        return { ok: true, content: `Nothing is on the board yet, and that is right — this turn asks and builds nothing.\n\nNow write your reply AS THE PRODUCER of this piece: lay the approach out by craft — the look, the shape, the movement — in two or three sentences, then the question${questions.length > 1 ? 's' : ''} below, in your own words. Say plainly what you decided for yourself so they can correct it if you guessed wrong. STOP THERE — do not call propose_board_ops in this turn.\n\n${questions.map((q) => `- ${q}`).join('\n')}${said}` };
    },
};

export const advanceBuild = {
    name: 'advance_build',
    description: 'Put the reference cards on the board — the cast first, then the places and props — after you have shown the person who and what is in this and they have moved on. Use it when they accept your plan or correct something IN it: "yes", "make him older", "use a night kitchen". Send stage "cast" to lay the people, "world" for the places and props, or "all" to do the whole rail at once when they have told you to get on with it. Every beat is later wired to these cards, so nothing that names a plate can be built before this. It renders nothing. IT ONLY EVER LAYS THE RAIL: a request to change, add to or extend what is ALREADY on the board is propose_board_ops.',
    schema: {
        type: 'object',
        properties: {
            stage: { type: 'string', enum: ['cast', 'world', 'all'], description: 'cast = the people; world = the places and the props; all = the whole rail in one go, for when they said to get on with it.' },
            plates: { type: 'array', description: 'ONLY when they changed something. Leave this out to put down exactly what you already proposed — resending it unchanged is how a description drifts.', items: PLATE_ITEM(false) },
        },
        required: ['stage'],
    },

    run({ stage, plates }, t) {
        const plan = t.plans.latest(t.spaceId);
        if (!plan) return { ok: false, content: 'Nothing has been planned on this board yet, so there is no cast to put down. Call plan_board first: say how you would approach it, NAME the cast, the props and the places, and ask at most three questions. Nothing is wrong — you are one step early.' };
        if (!t.stages.owed(plan).length) return { ok: true, content: 'The cast, the places and the props are already on the board — this rail is complete. Do not lay it again. Go straight to the beats with build_board, and give every beat the plate tags it uses in `refs` so the shot is wired to them.' };
        const result = t.stages.advance(plan, stage === 'all' ? 'world' : stage === 'world' ? 'world' : 'cast', plates, { withVoice: t.withSound });
        if (result.actions.length) {
            t.ledger.record({ nodes: result.actions.filter((a) => a.kind === 'card').map((a) => ({ id: a.nodeId })), updated: [], connections: result.actions.filter((a) => a.kind === 'wire'), actions: result.actions });
            t.emit('actions', { actions: result.actions });
        }
        if (result.refused) return { ok: false, content: `THE BOARD WOULD NOT TAKE THOSE CARDS and nothing landed:\n- ${result.reasons.join('\n- ')}\n\nSay plainly that the reference cards did not go on, do not claim they did, and ask them what to clear. They are still owed and the next go will lay them.` };
        const next = t.stages.owed(result.plan).length
            ? '\n\nNEXT IS WHERE IT HAPPENS. Say what the places and props are, in a sentence — then STOP and let them look. Their next message runs advance_build with stage "world". If they have already told you to get on with it, do not stop: send stage "all" now and go straight on to the beats in this same turn.'
            : '\n\nTHE RAIL IS DONE, so the beats are next and they are the last step — say so, so nobody is waiting for a fourth. Offer the music and the LOOK ONCE while you are there, in the SAME breath and never as two questions: a bed in half a sentence with one named alternative ("a low taiko bed under the whole thing — or keep it silent?"), and the look of the piece in another ("sodium orange against wet blue-black, lifted blacks and grain — or something cleaner?"). The music can be a SONG with words — then its lyrics go in `song_lyrics`. Then build them with build_board: every beat gets the plate tags it uses in `refs`, and pass `music` and `look` only if they want them.';
        if (!result.made) return { ok: true, content: `Nothing was owed at that stage — there was nothing of that kind in this piece. Say so in a clause and carry on to the next step; do not stop and do not ask about it.${next}` };
        return { ok: true, content: `${result.made} reference card${result.made === 1 ? '' : 's'} for ${result.applied.length > 1 ? 'the cast and the places and props' : result.applied[0] === 'cast' ? 'the cast' : 'the places and props'} ${result.made === 1 ? 'is' : 'are'} on the board now. Say it in ONE clause — name them, do not list them with their descriptions and do not repeat the prompts. Nothing has rendered. THIS LAID REFERENCE CARDS AND NOTHING ELSE: if they asked for something that is not a cast, place or prop card, you have NOT done it — do it now with propose_board_ops.${next}` };
    },
};

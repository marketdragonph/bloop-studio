// build_board, ported from bloop's BuildBoardSkill: the last step. It lays any rail still owed, the music bed and
// the look card, records what the beats were asked for, and hands the beats to the build runner — three writers at
// a time, in the background. It renders nothing. The guards and tool-result texts are bloop's.
import { namesOf } from '../audit.js';
import { cleanPlates, railMap, railOps, slug } from '../plan/plates.js';
import { DESTINATION_KEYS, clock, destination, runtimeField, runtimeShare } from '../plan/shape.js';
import { BoardOpsRejected } from '../ops/board-ops.js';
import { ROLES } from '../cut/cut-state.js';

const MOST_BEATS = 50;
const INLINE_BELOW = 3;
const PROMISE = '\n\nDO NOT ANSWER THIS WITH A PROMISE. Nothing is being corrected while you type: either send build_board again in THIS turn with the fix, or tell the person plainly what you need them to decide.';

const BRIEF_RULE = 'What HAPPENS in this beat — who does what, and where. This note is wired into the still, so every word here is drawn. NO DIALOGUE: never write what anyone says, not even quoted — the words go on the beat\'s own script card. AND NEVER WRITE THAT THERE IS NONE: no "no dialogue", no "nobody speaks". WHERE SOMEONE SPEAKS, NAME THE ACT: "Daichi, halting, admits to Aiko that he sold Yoru to a dealer" — admits, confesses, refuses, pleads, orders, confronts — never the reporting frame ("says", "asks", "replies"). A line the person wrote themselves goes in double quotes, word for word. NO CAMERA MOVES: a still cannot move; motion belongs in the clip\'s own note. AND NO LENGTHS: never "a five-second clip" or any time in the brief — the beat\'s writer sizes the clip.';

const mentions = (text, tag) => namesOf(tag).some((n) => new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s|'s)?($|[^\\p{L}])`, 'iu').test(text));

export const buildBoard = {
    name: 'build_board',
    description: 'Build a whole piece of work — every beat of it — after the person has answered your questions. Give it the beats: a short tag and the brief for each. Use this instead of propose_board_ops when the work is three beats or more: each beat is written by its own writer in the background and the cards arrive as they are made. This is the LAST step of a build: the cast and the places go down before it, and it lays any of them still owed rather than leaving the board half made. Voice is your call and never a question (see `narration`, `voice_over`). Pass `music` and `look` only if they said yes to a bed and to a look. It puts cards on the board and renders nothing. THIS IS WHAT "generate", "let\'s generate", "build it" and "make it" MEAN on this board — laying the cards.',
    schemaFor(t) {
        return {
            type: 'object',
            properties: {
                destination: { type: 'string', enum: DESTINATION_KEYS, description: 'Where this plays. SEND IT EVERY TIME, and especially when they have just corrected you — this decides the shape of every card.' },
                runtime_seconds: runtimeField(Math.max(...t.lengths)),
                narration: { type: 'boolean', description: 'YOUR call from the story, never a question: true when a VOICE carries this film across most beats — a narrator over the top, or somebody explaining what they are doing. Only the person turns narration off.' },
                voice_over: { type: 'boolean', description: 'Dialogue is ON by default and never a question: anyone in a beat who addresses someone gets a line. Only the person turns it off ("no dialogue", "silent film", "wordless"); a false here without those words changes nothing.' },
                music: { type: 'string', description: 'The music bed, in a phrase — "a low taiko pulse under the whole thing". ONE bed for the whole board, never one per beat. Send it only when you offered it and they said yes. A BED IS INDEPENDENT OF DIALOGUE. IT CAN BE A SONG: then send the lyrics in `song_lyrics` and describe here how the song sounds.' },
                song_lyrics: { type: 'string', description: 'The words of the SONG, only when they asked for a song. In the piece\'s own language, in sections, a tag on its own line before each: [Verse], [Chorus], [Bridge], [Outro]. Under 3000 characters.' },
                register: { type: 'string', enum: ['epic', 'intimate'], description: 'EPIC for action, fantasy, war, science fiction and adventure. INTIMATE for drama, romance, grief and family. Omit only when neither fits.' },
                poster: { type: 'string', description: 'The tag of the ONE beat that is this film\'s poster — its most striking image.' },
                language: { type: 'string', description: 'The language every spoken line and [VO] is in, as the person asked for it or wrote their own lines in — "Taglish", "Tagalog", "English". SEND IT whenever they named one or wrote lines in one.' },
                hook: { type: 'string', description: 'The tag of the HOOK beat — ALWAYS beat 1. Its strongest image lands in the first 2-3 seconds. Left out, beat 1 is the hook.' },
                resolution: { type: 'string', description: 'The tag of the RESOLUTION beat — ALWAYS the last beat. A real ending. Left out, the last beat is the resolution.' },
                look: { type: 'string', description: 'The look of the whole piece — the PALETTE and the GRADE in one line, and name BOTH. Prose, never hex codes. ONE look for the whole board. Send it only when you offered it and they said yes.' },
                beats: {
                    type: 'array',
                    description: 'One per beat, in order. The order IS the lane order.',
                    items: {
                        type: 'object',
                        properties: {
                            tag: { type: 'string', description: 'A short kebab-case handle, unique in the piece.' },
                            brief: { type: 'string', description: BRIEF_RULE },
                            refs: { type: 'array', items: { type: 'string' }, description: 'The plate tags this beat uses — who is in it, what is in it, where it is. FOUR AT MOST: name who the shot is ABOUT, what they are touching, and where they are — then stop. AND WIRE WHOEVER THE BRIEF NAMES. AND NEVER THE ROSTER: a character who is not in this beat is not in this list.' },
                            role: { type: 'string', enum: ROLES, description: 'What this beat does in the story: hook (always beat 1), setup, turn, climax or close (always the last). The cut reads it: the hook opens fast, the turn is cut fastest, the close is held.' },
                            staging: {
                                type: 'object',
                                description: 'WHERE IN THE PLACE this beat happens, when refs names a location plate. KEEP THE SAME SPOT across consecutive beats in one place unless the story moves.',
                                properties: { landmark: { type: 'string' }, camera_side: { type: 'string' }, distance: { type: 'string' } },
                            },
                        },
                        required: ['tag', 'brief'],
                    },
                },
            },
            required: ['beats'],
        };
    },

    run(args, t) {
        const seen = new Set();
        const beats = [];
        for (const b of Array.isArray(args.beats) ? args.beats : []) {
            const tag = slug(b?.tag);
            const brief = String(b?.brief ?? '').trim().slice(0, 4000);
            if (!tag || !brief || seen.has(tag)) continue;
            seen.add(tag);
            const staging = b.staging && typeof b.staging === 'object'
                ? Object.fromEntries(['landmark', 'camera_side', 'distance'].filter((k) => b.staging[k]).map((k) => [k, String(b.staging[k]).slice(0, 120)])) : {};
            if (ROLES.includes(b.role)) staging.role = b.role; // stored in staging JSON, no migration (05 §1.1)
            beats.push({ tag, brief, refs: [...new Set((b.refs ?? []).map(slug).filter(Boolean))], staging });
            if (beats.length >= MOST_BEATS) break;
        }
        if (!beats.length) return { ok: false, content: 'No beats were given, so there is nothing to build. Ask what the piece is, or send propose_board_ops for a single change.' };
        if (beats.length < INLINE_BELOW) return { ok: false, content: `That is only ${beats.length} beat${beats.length === 1 ? '' : 's'} — small enough to put on the board right now. Send it as propose_board_ops instead, in this same turn.` };

        let plan = t.plans.latest(t.spaceId) ?? t.plans.create(t.spaceId, {});
        if (t.runner.isRunning(plan.id)) return { ok: true, content: 'That build is already running. Tell them it is on its way and that the cards are appearing as they are made.' };
        const existing = new Map(t.plans.beats(plan.id).map((b) => [b.tag, b]));
        if (existing.size && beats.every((b) => existing.get(b.tag)?.state === 'written')) {
            return { ok: true, content: 'Every one of these beats is ALREADY ON THE BOARD — this build finished, and nothing new was laid. Do not say you are building anything. Tell them plainly the lanes are there. To change a beat that is already built, use propose_board_ops.' };
        }

        const where = destination(args.destination);
        const changes = {};
        if (where) changes.aspect = where.aspect;
        if (args.runtime_seconds > 0) changes.runtime_seconds = Math.min(3600, Math.round(args.runtime_seconds));
        plan = t.plans.update(plan.id, changes);
        const fail = (text) => {
            t.ledger.refused();
            return { ok: false, content: text + PROMISE };
        };
        if (plan.runtime_seconds) {
            const share = runtimeShare(plan.runtime_seconds, t.lengths);
            if (beats.length * share.ceiling < plan.runtime_seconds) {
                return fail(`NOT BUILT — ${beats.length} beats cannot run ${clock(plan.runtime_seconds)}. One beat is one clip and a clip runs ${share.ceiling} seconds at most, so ${beats.length} beats stop at ${clock(beats.length * share.ceiling)} even if every one ran the longest. ${clock(plan.runtime_seconds)} takes AT LEAST ${share.fewest} beats, and about ${share.comfortable} at the length most beats need. NOTHING WAS PUT ON THE BOARD. ${share.fewest > MOST_BEATS ? `That is more than the ${MOST_BEATS} beats one build takes. Say so plainly and offer a shorter piece.` : `Send build_board again in this same turn with at least ${share.fewest} beats — find the moments inside the beats you have rather than padding them. If they have agreed to a shorter piece, send \`runtime_seconds\` with that length instead.`}`);
            }
        }
        const hook = slug(args.hook) || beats[0].tag;
        const resolution = slug(args.resolution) || beats.at(-1).tag;
        const misplaced = [
            hook !== beats[0].tag && `- the hook "${hook}" is not beat 1 ("${beats[0].tag}"). The hook OPENS the film.`,
            resolution !== beats.at(-1).tag && `- the resolution "${resolution}" is not the last beat ("${beats.at(-1).tag}"). The resolution ENDS the film.`,
        ].filter(Boolean);
        if (misplaced.length) return fail(`NOTHING WAS BUILT. THE HOOK AND THE RESOLUTION ARE NOT WHERE THE FILM PLAYS THEM:\n${misplaced.join('\n')}\n\nSend build_board again in this same turn with the beats in playing order — the hook first, the resolution last. Keep every beat exactly as it was otherwise.`);

        // The rail first: every stage still owed goes down before a beat can be wired to it.
        const rail = t.stages.advance(plan, 'world', [], { withVoice: t.withSound });
        plan = rail.plan;
        if (rail.refused) return fail(`THE BOARD WOULD NOT TAKE THE REFERENCE CARDS, so nothing was built:\n- ${rail.reasons.join('\n- ')}`);
        const actions = [...rail.actions];

        // Cast only who each beat names (BeatCast): a ref the brief never names is dropped, and reported.
        const kinds = Object.fromEntries(Object.entries(plan.plates).map(([tag, p]) => [tag, p.kind]));
        const narrowed = [];
        for (const b of beats) {
            const kept = b.refs.filter((ref) => kinds[ref] === 'location' || mentions(b.brief, ref) || !plan.plates[ref]);
            const left = b.refs.filter((ref) => !kept.includes(ref));
            if (left.length) narrowed.push(`- ${b.tag}: left out ${left.join(', ')}`);
            b.refs = kept.slice(0, 6);
        }
        // A subject named in refs with no plate gets one, drafted from the briefs that name it (BuildGate).
        const unplated = [...new Set(beats.flatMap((b) => b.refs).filter((ref) => !plan.plates[ref]))];
        let invented = [];
        if (unplated.length) {
            const drafts = cleanPlates(unplated.map((ref) => {
                const said = beats.filter((b) => b.refs.includes(ref)).map((b) => b.brief).join(' ').split(/(?<=[.!?])\s+/).filter((s) => mentions(s, ref)).slice(0, 4).join(' ');
                const name = ref.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
                return { tag: ref, kind: beats.some((b) => b.staging?.landmark && b.refs[b.refs.length - 1] === ref) ? 'location' : 'cast', description: `${name}. ${said}`.trim() };
            }));
            try {
                const result = t.ops.apply(plan.space_id, railOps(drafts, Object.keys(plan.plates).length + 1, { withVoice: false }), { origin: t.stages.origin(plan), aspect: plan.aspect });
                plan = t.plans.update(plan.id, { plates: { ...plan.plates, ...railMap(drafts, result.refs) } });
                actions.push(...result.actions);
                invented = drafts;
            } catch (error) {
                if (!(error instanceof BoardOpsRejected)) throw error;
            }
        }
        const runtime = plan.runtime_seconds || beats.length * 6;
        const bed = t.stages.bed(plan, { music: args.music, lyrics: args.song_lyrics, seconds: runtime });
        const look = t.stages.look(plan, args.look);
        actions.push(...bed.actions, ...look.actions);
        t.plans.apply(plan.id, 'beats', {
            narration: Boolean(args.narration),
            voice_over: args.voice_over !== false,
            music: args.music ?? null,
            look: args.look ?? null,
            look_node_id: look.id,
            register: ['epic', 'intimate'].includes(args.register) ? args.register : null,
            poster: slug(args.poster) || null,
            hook,
            resolution,
            language: String(args.language ?? '').trim().slice(0, 40) || null,
            clip_family: t.clipFamily,
            edit_family: t.editFamily ?? null,
            lengths: t.lengths,
            with_sound: t.withSound,
        });

        // Lanes: a beat already on the board keeps its lane; new beats go after everything else.
        // The rail's lanes, then the bed's and the look's only when they went down (no empty rows in the block).
        const plateLanes = Object.keys(plan.plates).length;
        const bedLane = bed.made || t.spaces.board(plan.space_id).nodes.some((n) => n.type === 'audio' && /^(music bed|song)$/i.test(n.label ?? '')) ? plateLanes + 1 : 0;
        const lookLane = look.id ? plateLanes + 2 : 0;
        const taken = Math.max(plateLanes, bedLane, lookLane, ...[...existing.values()].map((b) => b.lane));
        let next = taken + 1;
        const rows = beats.map((b) => ({ ...b, lane: existing.get(b.tag)?.lane ?? next++ }));
        t.plans.saveBeats(plan.id, rows);
        for (const b of t.plans.beats(plan.id)) if (b.state !== 'written' && beats.some((x) => x.tag === b.tag)) t.plans.setBeat(b.id, { state: 'queued', error: null });
        t.plans.update(plan.id, { dispatched_at: new Date().toISOString(), built_at: null });
        t.runner.start(plan.id);

        t.ledger.planned([]);
        t.ledger.queued();
        if (actions.length) {
            t.ledger.record({ nodes: actions.filter((a) => a.kind === 'card').map((a) => ({ id: a.nodeId })), updated: [], connections: actions.filter((a) => a.kind === 'wire'), actions });
            t.emit('actions', { actions });
        }
        const parts = [];
        if (invented.length) parts.push(`THESE SUBJECTS HAD NO PLATE, SO THE BUILD LAID ONE FOR EACH:\n${invented.map((p) => `- ${p.kind}: ${p.tag}`).join('\n')}\n\nEach description was written from the beats that name it, so it is a DRAFT, not a design — say so in one sentence and offer to rewrite any of them.`);
        if (narrowed.length) parts.push(`CAST NARROWED TO WHO EACH BEAT NAMES. A beat's still and clip are wired with only the characters and props its own brief names, plus its place:\n${narrowed.join('\n')}\nIf one of those IS in that shot, name them in that beat's brief and send build_board again.`);
        const laid = rail.made + bed.made + look.made + invented.length * 3;
        if (laid) parts.push(`${laid} reference and rail cards went down just now — mention that in a clause, not as its own announcement.`);
        parts.push(`The beats are RUNNING and none of them is on the board at this instant — ${rows.length} are queued, each written by its own writer, and the cards appear over the next minute as they are made. Say it is ON ITS WAY, in the present continuous — "I am building ${rows.length} lanes now, they will appear as they land". DO NOT say the beats are on the board or that it is done. Do not list the beats. This was the LAST step — say so, so nobody waits for another. Nothing renders.`);
        return { ok: true, content: parts.join('\n\n') };
    },
};

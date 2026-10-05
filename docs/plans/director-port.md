# Director: port of bloop's Spaces Director — PLANNED

The Space Director in Bloop Studio becomes a faithful port of bloop's Spaces Director (bloop `main` @ 21e93e36d,
`modules/Spaces/`), adapted only where local models force it. Source of truth: bloop's code first, then
`docs/plans/spaces-director-agent.md` (read bottom-up: later sections override earlier ones).

The first Bloop Studio Director (add_card / connect / update_card, 2026-10-05) is replaced, not extended: it built
without asking, had no plan, no staged rail, no beat writers and a hand-rolled critic.

## What stays exactly as bloop has it

- **Conversation:** plan first (`plan_board` writes nothing, proposes everything, at most 2–3 questions, never about
  voice — dropped in code), the person answers, the rail goes down (`advance_build`: cast, then world, or `all`),
  the beats are built (`build_board`). Never re-ask: a second `plan_board` only applies corrections. An answer that
  does not answer = the Director decides and says why.
- **Ops contract:** one `propose_board_ops` call per turn with `note | node | wire | update | title`; refs or `@id`,
  `lane` (row) + `stage` (column), never coordinates; all or nothing in one transaction; refusals go back to the model
  as `BoardOpsRejected::forModel` text; the planFirst gate (≥ 2 new lanes on an empty, unplanned board = STOP).
- **Tools:** plan_board, advance_build, build_board, propose_board_ops, inspect_board, audit_board, with their
  descriptions, schemas and tool-result steering texts ported verbatim except for the adaptations below.
- **Turn loop:** up to 5 hops; tools removed on the last hop so the turn always ends in words; history = the last 24
  text rows (no tool calls replayed), so a provider switch never breaks a thread.
- **Closing logic:** provider error sentence → ops found in prose (OpsFromProse, applied once) → "None of that reached
  the board" when proposed and nothing landed → plan turn with no words prints the questions → silent turn →
  the ledger speaks ("I put N cards on the board.") when the board changed and the model said nothing.
- **Critic:** after the first successful apply of a turn, BoardAudit on the turn's own cards, returned inside the tool
  result ("CHECK YOUR OWN WORK — …"); `audit_board` for the whole board. Reports, never rewires.
- **Prompt composition order:** doctrine first (cache prefix), board state last (BuildStagesPrompt, BoardSnapshot).
  Persona, PlanFirst, BuildStages, BoardOpsContract, Cinematography, Brevity, StoryCraft, SoundCraft, VoiceCraft,
  LookCraft, StoryEnds, BeatCast, ClipLength, BoardRuntime ported from bloop's texts.
- **Snapshot:** bloop's format — `@id type "label" aspect=… duration=… text="…(clipped)" rendered|rendering-now|failed
  ← @feeds`, 24,000-char budget, clip 160 → 60 → 0.
- **Plan storage:** plan row (approach, questions, assumptions, aspect, runtime), stage rows (cast / world / beats,
  proposed → applied, payload = proposed plates or the build intent), beat rows (tag, lane, brief, refs, node ids).
- **Echo guard:** a reply pasted back is refused before the model ("That is my last reply, sent back…").
- **Spend rule:** the Director never renders. Creating cards is free; "generate" is a build word.

## Where Bloop Studio differs, and why

| bloop | Bloop Studio | Why |
|---|---|---|
| Every beat is a 2×2 storyboard grid feeding a multi-reference video model | A beat is **brief → still → clip**: the still is the clip's first frame | LTX, MiniMax-H3 and Wan use a picture as the literal FIRST FRAME; a grid would play as a grid |
| Plate PICTURES wired into grids and clips | Plate LOOK NOTES (words) wired into the still and clip; plate pictures stay on the rail as the reference sheet | Z-Image treats a wired picture as img2img (copies the sheet). Picture identity comes in phase 5 with an edit model |
| Fan-out on a Laravel queue (Bus::batch) | Beat writers run in the background run, 3 at a time, each its own model call | Same shape, no queue server in a desktop app |
| Voice cards + one `· script` card per beat, rendered by bloop TTS | `· script` card wired into the clip; LTX / MiniMax-H3 speak quoted lines themselves | No local TTS; local video models make their own sound |
| Music bed on bloop's audio models | Music bed = an Audio card (ACE-Step / MiniMax Music) with a style note and, for a song, a lyrics note on the Lyrics socket | Local music shipped 2026-10-05 |
| Credits, check_render, render_board, offer strip | Not ported (local renders cost no credits). The person presses Generate | Owner's rule: renders stay the person's |
| Persona "Say what to press" | Replies say what was built, never which buttons to press | Owner's request (2026-10-05) |
| Fight registers, location sheets, thumbnails, continue_board, recast | Later phases | Need multi-reference models or are secondary |
| Clip length menu from the person's sticky model, ≤ 15 s | Local menu from `src/shared/formats.js` (LTX / H3 up to 10 s at 480p) | The models' real limits |

## Board shape (local)

Lane = row, stage = column, `x = (stage − 1) × 380`, `y = (lane − 1) × pitch` (pitch from the tallest card, aspect-aware).

- **Rail** (lanes 1..n, one per plate): stage 1 `cast: <tag>` look note → stage 2 `cast: <tag>` image (a reference
  sheet: front, three-quarter, profile, back on plain white). Same for `location:` (an establishing view) and `prop:`.
- **Bed** (lane n+1): stage 1 `music bed` style note (+ stage 2 `song lyrics` note) → stage 3 audio card.
- **Look** (lane n+2): stage 1 `the look` note (palette + grade), wired into every still.
- **Beat lane:** stage 5 brief (`<tag>`), stage 6 `<tag> · still` (the still prompt), stage 7 image `<tag>`,
  stage 8 `<tag> · motion`, stage 9 `<tag> · sound`, stage 10 `<tag> · script`, stage 12 video `<tag>`.
  Wires: brief + still note + the beat's plate look notes + look → image; image → clip (first frame);
  motion + sound + script + the beat's cast look notes → clip.

## Camera: shots, angles, moves

Ported from bloop (CraftRolesPrompt, CinematographyPrompt, ChangeBudget, PlaceStaging, Blocking), adapted to one
still + one clip per beat (bloop's 2×2 storyboard sheet sentences are dropped):
- The crew: the writer owns the brief, the art director the still (six steps in order: subject, camera — angle, lens,
  depth of field — light with source, direction and colour temperature, composition, materials and texture, palette
  and background), the cinematographer the clip (what moves, the camera move, how the end differs; never the still again).
- THE SHOT LINE opens every still and clip prompt: `SHOT: size, angle, lens, light, 2–3 colours, the saved spot.
  Avoid: …`. The sizes, angles and moves vocabularies verbatim; ONE move per clip, set off by the action.
- How shots join: wide → medium → close for a feeling, never three of one size or angle in a row, screen direction and
  eyelines kept, cut on the action; neighbours change at most two of size, angle, move, light, pace (ChangeBudget note).
- Staging per beat (landmark, camera side, distance) chosen in build_board and kept across consecutive beats; blocking
  (who stands where, facing where; exit right → enter left).
- Orientation tails: tall boards (9:16, 4:5) put the subject in the upper third, one subject close, depth over width,
  vertical moves; wide boards use the space beside the subject.
- BeatWriter answers SHOT as `size | angle | lens | move | light | colour | avoid | cue`; the board writes it on top of
  the still and the clip, and the clip's move is tied to its first action.

## Voice: dialogue and VO

Ported from bloop unchanged:
- Voice is the Director's call, ON by default, never asked (questions about it are dropped in code); only the person's
  own words turn it off. `narration` (a narrator carries the film) and `voice_over` (dialogue, default true) on the build.
- One `<tag> · script` card per beat: `[VO] …` and `[@tag (direction)] …` lines in order; outfit tags speak as the person.
- Narration is positional: every lane when a narrator carries it, otherwise only the hook and the resolution may have one.
- Briefs never carry spoken words or the says/asks frame; they name the act ("admits to Aiko that…").
- Lines first, then SECONDS: about 2.5 words a second; never cut a line to fit; a longer exchange is the next beat.
- `language` on the build; the person's own lines kept word for word, in quotes, in the brief that says them.
- Speaking cast get a voice profile (timbre, register, accent, cadence, delivery, under pressure), in prose.
- ScriptRepeats (no exact line twice across beats); checks CAST_BUT_SILENT, DIALOGUE_THIN, LINE_UNNAMED.

Local rendering:
- On-camera lines: the script card and the speakers' voice profile cards are wired into the clip; LTX-2.3 and
  MiniMax-H3 voice them (they make their own sound). Wan is silent: its lanes get no script card.
- VO: OPEN. No local text to speech. Test first on this PC (a two-hander and a narrated beat, LTX and H3). If the
  video models cannot carry an off-screen narrator, VO renders on bloop's cloud voices when signed in: one Audio card
  per narrated beat fed by the `[VO]` lines.

## Phases

### Phase 1 — conversation core (this replaces the current Director)
- [ ] Tables: `director_plans`, `director_build_stages`, `director_plan_beats`; history = `director_log` text rows.
- [ ] `BoardOps` (ops, validator, wire legality from `node-types.js`, one transaction, refs/`@id`, lane/stage layout).
- [ ] Skills: plan_board, advance_build (rail), propose_board_ops (+ planFirst gate), inspect_board, audit_board.
- [ ] Turn loop: 5 hops, tools off on the last, ledger + closing logic + OpsFromProse, echo guard.
- [ ] Prompt composition: Persona (adapted), NodeVocabulary (local types), BoardOpsContract, PlanFirst,
      SpacesGuide (Bloop Studio's UI), BuildStages, snapshot.
- [ ] Tests: plan → answer → rail → ops; gate; refusals; closing branches; snapshot budget.

### Phase 2 — build_board and beat writers
- [ ] build_board (beats, refs narrowed to who the brief names, hook first / resolution last, runtime check,
      music, song_lyrics, look, narration / voice_over, language), lane allocation, background beat writers (3 at a time).
- [ ] BeatWriter with a local BeatForm: SECONDS (from the local menu), SHOT, STILL, CLIP, SOUND, VO, LINE, SPEAKERS;
      the craft doctrine blocks it composes.
- [ ] Bed and look cards; script card; build progress events.

### Phase 3 — the critic
- [ ] BoardAudit ported for local lanes: underfed, dangling, LANE_UNLINKED (a plate named but its look not wired),
      LANE_OVERCAST, failed / wedged / stale, knob drift against the local formats, short of plan, runtime off,
      cast but silent, unnamed lines, script repeats.

### Phase 4 — the panel
- [ ] Thinking tail, `Building — 2 of 6 lanes` progress, the lane worklist (queued / writing / written / failed),
      the "N cards" key that selects and zooms to them, per-turn Undo, Copy, Try again.
- [ ] Empty state with seed chips, first-run variant, Enter / Shift+Enter, pictures dropped into the chat.

### Phase 5 — identity by picture (later)
- [ ] An image edit preset (Qwen-Image-Edit 2511, up to 3 pictures) so plate pictures can be wired into stills;
      cloud models with references when signed in; then bloop's PLATE_PICTURE checks.

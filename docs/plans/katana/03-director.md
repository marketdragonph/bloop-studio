# Katana 03 — Director: stitch, smart editing, pack — PLANNED (phase P4)

Part of [../katana.md](../katana.md). Settled conflicts there win over this file.
The Director is the port of bloop's Spaces Director (`src/server/director/`): skills in `skills/index.js`, one
writer (`propose_board_ops` → `ops/board-ops.js`), a validator (`ops/validate.js`), a critic (`audit.js`), a turn
ledger (`turn/ledger.js`) and doctrine blocks (`prompts/doctrine-*.js`, put together in `prompts/compose.js`).

This phase adds 4 tools — `stitch_cut`, `propose_cut_ops`, `inspect_cut`, `pack_assets` — plus a cut critic and
one doctrine block, `EditCraft`.

**Owner rules, in every tool here:** the Director never renders on the GPU. It never exports; Export is the
person's press. It never tells the person which buttons to press.

## 1. What is ported and what is adapted

| Piece | From bloop | Here |
|---|---|---|
| `stitch_cut {mode}`, `CutDraft`, snapshot line, "Undo draft" | 01 §5, 02 §2: **verbatim** contract | Same names. bloop's `cut_updated` and `offer_cut_replace` signals become the `cut` SSE event on `BoardEvents` (`offer: 'replace'`). |
| Tool-result texts | 01 §5 | **Adapted.** bloop's "Offer the render queue (render_board)" and "point at ⚡ Generate" are dropped: no `render_board` here, and the owner forbids naming buttons. |
| Critic once per turn, refusals back to the model, all or nothing | `BoardOps`, `TurnLedger.claimAudit`, `forModel()` | Same pattern. |
| bloop's "no trims, no transitions, the agent cannot see a clip" | 02 §2 | **Replaced** by smart editing. The Director measures with `inspect_cut` and edits with those numbers. The edit lock (§4) keeps "never overwrite a person's edits". |
| Critic codes `GAP`, `STALE`, `RUNTIME_OFF`, `ORDER_GUESSED`, `TAKES`, `MIXED_ASPECT` | 02 §2 | Ported. `NOT_DURABLE` becomes `MISSING_FILE`. `UNMEASURED` stays (ffprobe can fail). |
| `pack_assets`, `inspect_cut`, `propose_cut_ops`, EditCraft | none | New: the owner's extension. |

## 2. `stitch_cut` (the faithful port)

```json
{ "name": "stitch_cut",
  "description": "Put the board's rendered clips together into the Cut, in beat order. Use it for \"stitch\", \"cut it together\", \"rough cut\", \"put the clips together\", \"make it one video\" — and \"make the video\" when clips are missing (the gaps are named, never rendered). It renders nothing and exports nothing.",
  "input_schema": { "type": "object", "properties": {
      "mode": { "type": "string", "enum": ["fill", "add_new"],
        "description": "fill: build the cut in beat order, ONLY into an empty cut. add_new: add rendered beats that are not in the cut yet; never moves, trims or removes the person's items." } },
    "required": ["mode"] } }
```

- **One service.** `src/server/cut/cut-draft.js` (`CutDraft`) is the only code that builds a draft. The dock's
  **Fill the cut** (`POST /spaces/:id/cut/draft`, CSRF) calls the same service; one test covers both callers.
  Order and clips come from `board-cut.js` (01-core.md §4). The music bed is set when there is exactly one audio
  card labelled `music bed` or `song`. Items get `placed_by: 'director'` and a short note ("Placed in beat order").
- **Guards:** revision check, at most 50 items, at most 600 s. Gaps never refuse. Zero playable clips: no write,
  no event.
- `fill` on a non-empty cut writes nothing and emits `cut` with `offer: 'replace'`; the dock shows the replace
  banner. Before a replace (the person's press), the old items go to `previous_items`: the one-step Undo draft.
- **Snapshot line** (verbatim), added in `prompts/compose.js` right after `boardSnapshot`:
  `Cut: 6 of 8 beats, 1:42, revision 12`. One budgeted line follows only when needed:
  `Locked (the person changed them since): s3-door, s5-run.`
- **Tool results:**
  - Done: `Added N clips in beat order. M beats have no video: <tags>. NOTHING WAS RENDERED. Say which beats are missing in one sentence. Do not say they are rendering, and do not name any buttons.`
  - Refused: `The cut already has the person's work in it, so nothing was written. A fresh draft is offered to them as a replacement. Say that in one sentence; it is their choice. Do not name any buttons.`
- **Ledger:** `drafted = false` counts as a refused turn, and `turn/closing.js` corrects the reply (as for ops).

## 3. `propose_cut_ops` (smart editing)

Mirrors `propose_board_ops`. Every op for a turn goes in ONE call, applied in order inside one transaction through
`CutEdits` (`src/server/cut/cut-edits.js`, the same path as the dock's `PUT`), all or none. Refusals go back as
`CutOpsRejected.forModel()`. A separate tool, not more `OPS`, for bloop's reason (02 §2): one refusal must never
roll back card writes and cut writes together.

```json
{ "name": "propose_cut_ops",
  "description": "Edit the Cut: place, trim, move or remove a beat's clip, set the join between two clips, the clip's own sound, J/L cuts, music ducking and levels. Use it for \"tighten it\", \"trim the dead bits\", \"cut on the beat\", \"duck the music\", \"make it punchier\", \"swap 3 and 4\". Read the numbers with inspect_cut first; never guess a time. Everything in ONE call, all of it or none of it. It changes the edit only — it renders nothing and exports nothing.",
  "input_schema": { "type": "object", "properties": { "ops": { "type": "array", "maxItems": 40, "items": {
    "type": "object", "required": ["op"], "properties": {
      "op":     { "type": "string", "enum": ["place", "trim", "move", "remove", "join", "sound", "duck", "level"] },
      "beat":   { "type": "string", "description": "The beat tag (s3-door), or @<id> of a clip card on a board with no plan." },
      "after":  { "type": "string", "description": "place/move: the beat it follows, or \"start\"." },
      "take":   { "type": "string", "description": "place: @<id> of an older take; default the newest." },
      "in_s":   { "type": "number", "description": "trim: where the clip starts, seconds into the clip, 0.1 steps." },
      "out_s":  { "type": "number", "description": "trim: where it ends." },
      "type":   { "type": "string", "enum": ["cut", "dissolve"], "description": "join: the join AFTER `beat`." },
      "ms":     { "type": "integer", "description": "join: dissolve length, 250-1000, at most half the shorter clip." },
      "audio_ms": { "type": "integer", "description": "join: J cut < 0 (next sound starts early), L cut > 0 (this sound runs on). |audio_ms| <= 1500." },
      "on":     { "type": "boolean", "description": "sound: the clip's own sound on or off." },
      "depth_db": { "type": "number", "description": "duck: how far music drops under spoken lines, -3 to -18." },
      "track":  { "type": "string", "enum": ["music", "voice", "clips"], "description": "level: which track." },
      "gain_db": { "type": "number", "description": "level: -24 to +6." },
      "target_lufs": { "type": "number", "enum": [-23, -16, -14], "description": "level: loudness the export aims for." } } } } },
    "required": ["ops"] } }
```

- **Shared rules** in `src/shared/cut-rules.js`: caps, dissolve limits, J/L limits, gain ranges, finding thresholds.
  J/L adds `join.audio_ms`; `duck` sets `sound.music.duck {depth_db, attack_ms: 120, release_ms: 400}`. Duck
  windows are computed from measured speech spans by `src/shared/cut-sound.js`, never stored.
- **Cut on the beat:** `trim`/`move` take times; the validator snaps an out point within 80 ms of an estimated
  downbeat onto it (from `cut-sound.js`), and says so in the result.
- **Files:** `src/server/director/cut/validate.js` (every reason, collected first, in bloop's wording style),
  `cut/cut-ops.js` (apply through `CutEdits`), `cut/lock.js` (§4), `cut/audit-cut.js` (§6) and
  `skills/cut.js` (the 4 tools). Each under 300 lines.
- **Refusal examples:** `op 2: s9-end is not a beat on this board. The beats are: s1-open … s8-close.` /
  `op 3: out_s 6.2 is past the end of s4-run (5.0 s). Read it with inspect_cut.` /
  `op 5: a dissolve of 900 ms is more than half of s2-cup (1.4 s).`
- **Done:** `Done — 6 trims, 1 move, 2 joins; the cut is now 1:31 (was 1:42), revision 14. It is in the Cut already: say what you changed and why in two sentences, in editing words. Nothing was rendered or exported.`
  The critic (§6) follows, once per turn.
- **Notes on clips:** each changed item gets a `note` of at most 40 characters (`Trimmed −0.6 s`, `Cut on action`,
  `Dissolve 0.5 s`), shown in sensor blue. The person's next edit to that item clears it.
- **One undo per turn:** before the turn's first cut write, `cut_turns` (in `007_cut_director.sql`) stores
  `{space_id, turn, before: items+sound, after_rev}`. The dock pushes one **Undo Director edit** command.
  `POST /spaces/:id/cut/undo-turn {turn, revision}` works only while the cut's revision is still `after_rev`.

## 4. The edit lock (owner Q2, recommended A)

Every item stores `placed_by` and `person_rev`, the last revision the person changed it in. The rule, in `cut/lock.js`:
1. The Director may edit an item it placed that the person has not touched since.
2. An item the person placed or changed is **locked**.
3. A locked item opens only when the person names it in words *this turn*: the beat tag, "beat/shot N", or a
   whole-cut phrase ("the whole cut", "everything", "all of it", "tighten the cut"). The server checks the request text.
4. `stitch_cut` keeps bloop's stricter rule: it never edits; it only fills or adds.

A change to a locked item refuses the whole call:
`s3-door was changed by the person after you placed it, so it is theirs. Leave it, or ask them in one sentence whether you may change it.`

## 5. `inspect_cut` (measure, never render)

```json
{ "name": "inspect_cut",
  "description": "Measure the clips in the Cut and the music bed: dead frames at the head and tail, silence, spoken lines, loudness, music beats. Use it before any trim, cut point, duck or level, and when asked whether the cut is tight. It reads only — it changes nothing.",
  "input_schema": { "type": "object", "properties": {
    "beats": { "type": "array", "items": { "type": "string" }, "maxItems": 50, "description": "Beat tags; leave out for the whole cut." } } } }
```

Per clip one compact line, plus one for the bed:

```
s2-cup @41 5.0 s, used 0.0–5.0 | still head 0.0–0.6 | still tail 4.4–5.0 | speech 1.2–3.4 "We open at six." | silence 3.4–5.0 | -19.8 LUFS, peak -3.1 dBTP | scene change 2.7
music @12 58.4 s | ~92 BPM (estimated) | downbeats 0.0 2.6 5.2 7.8 … | -14.2 LUFS | ends 58.4 s (cut is 61.0 s)
Not measured yet: s7-run (queued). Use only these numbers; do not guess the rest.
```

| Measure | How (bundled ffmpeg through the capped runner, CPU only) |
|---|---|
| Still head/tail, scene changes | `freezedetect`, `scdet` on a 10 fps, 64×36 grey scale-down |
| Silence | `silencedetect` (−45 dBFS, ≥ 0.3 s) |
| Speech spans | `highpass=300,lowpass=3400` then `silencedetect`; the words come from the beat's script card, the times are measured |
| Loudness | `ebur128` (integrated, true peak) |
| Music onsets, downbeats | decode to 11 kHz mono PCM (capped `-t`), spectral flux + tempo estimate in JS (`src/server/analysis/onsets.js`), always labelled "estimated" |

- `AnalyzeMediaJob` in `src/server/analysis/` with stages `probe → loudness → silence+speech → motion → onsets →
  peaks → store` (`handle(ctx, next)`), on the media-tools queue (`src/server/media/tools-queue.js`) behind exports
  and packs. ffmpeg runs as a child process, so the event loop never blocks. Every call is a capped `run()` with
  the null muxer and output `-t` = the media length (beds capped at 600 s), timeout max(30 s, 2 × length)
  (01-core.md §6). `peaks` stores the bed's waveform bars from the same PCM decode, so the dock never decodes a
  long bed itself.
- **When it runs (critic pass):** not on every take that lands. Only for media that is in a cut, is the space's
  bed, or that `inspect_cut` asks for. A board building 40 shots on the GPU should not also run 40 CPU analyses
  nobody asked for. Below-normal priority, one at a time, and an export or pack pressed by the person goes first.
- **No video tools** (ffmpeg missing, e.g. a quarantined install): `inspect_cut` answers `Not measured: the video
  tools are missing on this PC. Use no times.` `propose_cut_ops` then refuses `trim`, `join` with `audio_ms`,
  `duck` and `level target_lufs` with `op 1: s3-door is not measured, so no time can be set. Say the cut could not
  be measured on this PC in one sentence.` `place`, `move`, `remove`, `sound` and a plain `join` still work, and
  `stitch_cut` works (it uses the asked lengths, marked `UNMEASURED`).
- Cached in `media_analysis` (`007_cut_director.sql`), keyed by media path, size, mtime and `ANALYZER_VERSION`.
  `inspect_cut` waits at most 3 s for the cache, then answers with what it has.
- `GET /spaces/:id/cut` returns the speech spans, `ducks` and `beats_ms` from the same cache, so the dock shows
  the numbers the Director used.
- Activity labels: `stitch_cut` "Putting the cut together", `propose_cut_ops` "Editing the cut", `inspect_cut`
  "Measuring the clips", `pack_assets` "Packing the assets".

## 6. The cut critic

`src/server/director/cut/audit-cut.js`. It runs once per turn on the turn's changed items (new
`ledger.claimCutAudit()`) and is added to the tool result. `audit_board` gets a `THE CUT` section whenever a cut
exists, so there is no `audit_cut` tool. Like `audit.js` it reports and never edits. Thresholds in `src/shared/cut-rules.js`.
The dock shows the same findings as the mockup's "Check your cut · N".

| Code | Finding | Rule |
|---|---|---|
| `GAP` | a beat with no rendered clip | plan beats minus playable items |
| `OVER_RUNTIME` | the cut runs long | > 15 % over `runtime_seconds`, or over 600 s (`RUNTIME_OFF` covers short) |
| `LINE_CUT_OFF` | a trim, or a cut with no L, clips a spoken line | in/out falls > 0.15 s inside a speech span |
| `JUMP` | the same size and angle twice in a row | shot words parsed from each brief; a words heuristic, and it says so |
| `DEAD_AIR` | nothing moves and nothing sounds | ≥ 1.2 s of still frames with no speech, music or clip sound |
| `LOUDNESS_OFF` | the mix is too quiet or loud, or a clip jumps | > 2 LU from the target, or a clip > 6 LU from its neighbours |
| `MUSIC_ENDS_EARLY` | the bed stops before the picture | the bed ends > 1 s before the cut (a bed never loops, 01 §3) |
| `UNMEASURED`, `MISSING_FILE` | local | 01-core.md §4 |
| `STALE`, `TAKES`, `ORDER_GUESSED`, `MIXED_ASPECT` | ported unchanged | 02 §2 |

The header is bloop's, "CHECK YOUR OWN WORK", then `s4-run: …` lines, each with what to do. "What to do" is
always an edit the Director can make with `propose_cut_ops`, or a sentence to say. It never says render,
generate or export, and never names a control. `GAP`: `s4-flashback has no video. Name it in one sentence; do not
offer to render it, do not name any buttons.` `MISSING_FILE` and `STALE` likewise name the beat, not a fix the
person must press. A test greps every critic line and tool result for button words (whole words: `press`, `click`, `tap`,
`button`; case-sensitive control names: `Export`, `Generate`, `Render`, `Fill the cut`, `Pack assets`) and fails on
any hit outside a "Do not name any buttons" instruction.

## 7. `pack_assets`

```json
{ "name": "pack_assets",
  "description": "Pack everything this board made into one .zip in the media folder: clips, stills, sound, the words cards as text, the latest export, and a manifest with prompts, seeds and the cut. Only when the person asks to pack, collect, download or hand off the assets. It copies files; it renders and exports nothing.",
  "input_schema": { "type": "object", "properties": {} } }
```

- Queues the same Pack job as the dock's **Pack assets** (`POST /spaces/:id/cut/packs`, 01-core.md §8). One code
  path, one format. Progress and the end come as `cut_export` events with `kind: 'pack'`.
- Not rendering: a file copy that never leaves the machine.
- One pack per space at a time: a second call while one runs returns that pack's progress, not a new job. It is
  not an export: no ffmpeg, no new card, and the latest export is copied only if the person already made one.
- Low disk: the job refuses before copying (01-core.md §8), and the tool result says so in one sentence.
- Result: `Packing N files (1.2 GB) into "<name>.zip" in the media folder. It will say when it is done. Nothing was rendered or exported. Do not name any buttons.`

## 8. Doctrine: `EditCraft` (`prompts/doctrine-edit.js`)

A new block in bloop's doctrine style. In `compose.js` it goes after `STORY_CRAFT`, in the cache-stable half. It
is **not** added to `build/beat-writer.js`: the beat writer writes cards, not cuts.

```
THE EDITOR — owns the Cut.
You edit with numbers from inspect_cut, never by guess. Every trim and cut point names its reason.
CUT ON ACTION. Leave a clip mid-movement and enter the next one moving. A cut on a still frame shows.
  Weak: trim s3-door to 0.0–5.0.  Right: out at 3.9 s, as the door swings; s4 starts on the step through.
TRIM DEAD FRAMES. A generated clip settles at the head and freezes at the tail. Cut both unless the stillness is the point.
J AND L CUTS. Let a line start under the shot before it (J), or run on over the reaction (L). A hard cut on every line feels like a slideshow.
NEVER CUT A LINE. A trim inside a spoken line is a mistake, not a choice.
RHYTHM. Vary clip lengths. Faster toward the turn, a held shot after it. With music, cut on downbeats, not on every beat.
CUT IS THE DEFAULT JOIN. Dissolve only for a jump in time or place, and say so.
DUCK, DON'T FIGHT. Music sits under lines (about -10 dB), and comes back up in the gaps.
END ON THE RESOLUTION. The last clip is the answer, held long enough to land. The music finishes with the picture or before it, never after.
SAY IT IN EDITING WORDS. "Tightened the open, cut on the swing, let her line run over the reaction." Never list buttons.
```

## 9. Turn and routing changes

- `skills/index.js`: the 4 tools after `audit_board`, always listed (no flag). With no cut and no clips they refuse plainly.
- `turn/ledger.js`: new `drafted`, `cutEdits[]` and `claimCutAudit()`. `touched()` counts cut edits.
- Routing words go into the tool descriptions and the `PERSONA`/`GUIDE` blocks together (bloop's "reach every
  router" lesson, 02 §2). "Make the video" routes to `stitch_cut`, never to a build, never to Export.

## 10. Tests (`node --test`, temp SQLite, fake ComfyUI, fake spawn, fixture media)

- `tests/director-stitch-cut.test.js`: fill/add_new, no overwrite, replace offer, gaps named, zero clips sends no
  event, the dock Fill and the skill give the same draft, ComfyUI gets zero calls, the export queue gets zero jobs.
- `tests/director-cut-ops.test.js`: every refusal text, all or nothing, the revision check, the lock rule (placed,
  touched, named in words), beat snap, one undo per turn, undo refused once it is no longer on top.
- `tests/director-audit-cut.test.js`: each finding on a fixture cut, thresholds from `cut-rules.js`.
- `tests/analyze-media.test.js`: fake ffmpeg output lines parsed into spans; a real run on 3 short fixtures (a
  freeze at the tail, a tone with silence, a click track) within ±0.1 s, skipped when `vendor/ffmpeg` is missing;
  the cache hits on the second run.
- `tests/director-pack-assets.test.js`: queues one pack job, nothing written outside the media folder.
- `tests/director-compose.test.js`: the snapshot line is the exact string; EditCraft appears once; no tool result
  or critic line names a button (the word list in §6).
- `tests/director-cut-ops.test.js` also: with no ffmpeg, timed ops refuse and untimed ops apply; no Katana tool
  adds a row to `cut_exports` with `kind: 'export'`, and none calls the GPU worker or the bloop cloud client.

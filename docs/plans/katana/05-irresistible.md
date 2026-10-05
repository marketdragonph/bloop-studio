# Katana 05 — Irresistible: what makes people pick it and stay — PARTIAL (§2 first run built in P2b; §4.1 and §5 built in P3 and P6)

Part of [../katana.md](../katana.md); settled conflicts there win. The owner asked to "make it production grade,
irresistible, making us many users", and for the Director to help with how to use it when asked. Four lenses gave
44 ideas; a reviewer kept 25. Only the kept ideas are here, with the reviewer's fixes applied.

**House rules hold in every idea.** The Director never renders (GPU or cloud), never starts an export, and names
a control only when the person asks how. Nothing blocks the event loop or the GPU worker. Files stay under 500
lines. CSS variables only: orange = action/live, blue = in progress, seams grey, Orbitron for labels only. No
franchise names. Local-first and free; bloop cloud is optional. No telemetry.
Sizes: **S** ≈ under 150 new lines, **M** ≈ 150–400, **L** over 400. Tests in addition.
**Why we win.** Rival editors guess what a film is about. Descript Underlord and Kapwing Kai read a transcript,
Resolve IntelliScript needs a pasted script, CapCut AutoCut finds beats after the fact, OpusClip guesses the
hook. Our Director wrote the plan, so it knows the beats, their briefs, the lines and the bed. It runs on the
person's PC with their own key, with no credits and no minutes.

## 1. The one-sentence cut (hero feature)

### 1.1 Cut my film in one sentence — P4, S on top of the planned P4

**What the person sees.** They type "cut it together, keep it under a minute, punchy" in the Director panel.
In one turn the Director fills the cut (only if it is empty), measures it, and makes one edit call. Dead heads
and tails go. Joins follow the story: hard cuts in the chase, a 0.5 s dissolve into the flashback. The music
ducks under the lines. Each changed clip gets a blue note ("Trimmed −0.8 s", "Cut on action"). The reply is two
sentences in editing words: "1:42 down to 0:58. The reveal now lands after a held beat." No button names.
Export stays the person's press.

It is honest when it cannot hit the target: "0:34 without cutting a line. Dropping beat 6 gets 0:29. Want
that?" If the clips are still being measured after the 3 s wait, it applies only untimed edits (order, joins)
and says the clips are still being measured.
**Why it wins.** It cuts for story, not just to remove silence, because it planned which beat is the hook and
which is the close.
**Where it lands.**
- `build_board` takes an optional `role` per beat (`hook | setup | turn | climax | close`), stored in
  `director_plan_beats.staging` JSON. No migration. The cut snapshot line in `prompts/compose.js` prints it.
- A phrase table in `prompts/doctrine-edit.js` next to EditCraft (not `doctrine-craft.js`, already 320 lines).
  "Tighter" = drop still heads and tails, cut holds by 10–20 %, never inside a line, keep the last clip held.
  "Punchier" = shorter clips toward the turn. "Calmer" = dissolves only where time or place jumps. "End on the
  train" = move that beat last, hold it 2 s or more, fade the music with the picture. "Cut on the beat" = out
  points on downbeats, not every beat. "More room after her line" = an L cut or 0.6–1.0 s more.
- `fitPlan(items, analysis, target_s)` in `src/shared/cut-rules.js` (~60 lines, pure): can the target be
  reached, and by which trims. Never inside a speech span. `inspect_cut` prints `can lose X s` per clip.
- Test: `tests/cut-fit.test.js` (reachable, unreachable, never inside a line).

## 2. First run

Target presses from an empty board to a watchable cut with music. With a Director key: **5** (Send, answer,
Render missing beats, Play, Export). No key: **4** (Start from a starter, Render missing beats, Play, Export).
Own clips: **2** (drop the files, Export). Cloud only: **5**, with credits shown before the one render press.
The plan before this file needed about 20–25.

### 2.1 Live cut: the cut builds itself as clips land — P2b, M

**What the person sees.** On a planned board the folded rail reads "Cut · 1 of 7 beats · 0:06" when the first
beat clip lands. Each new clip drops into its slot in beat order by itself, noted "Placed in beat order". The
dock opens by itself once (the existing first-draft rule). Then: "All 7 beats are in · 0:47". After the
person's first edit, auto mode is off for good on that cut, and the live region says "You edited the cut. New
clips now wait for you." Later clips light **Add new clips** and never move the person's items.
**Why it wins.** A cut with zero presses, built while the GPU works, and the person is never overwritten.
**Where it lands.** `cuts.auto` (default 1) in `006_cuts.sql`. A listener on BoardEvents `node` done inside
`src/server/cut/` (after MeasureTake wrote `duration_ms`), not inside the generation stages. It runs `CutDraft
add_new` with `placed_by: 'auto'`, only on Spaces with a plan and only while `auto = 1`. The first person `PUT`
sets `auto = 0` in the same statement. On a 409 whose server copy differs only by auto-appended items, the client
rebases silently (keeps its edit, appends the new items), with no banner. Test: `tests/cut-auto.test.js`.

### 2.2 Render missing beats: one press for the whole plan — P2b, M

**What the person sees.** With gaps, the dock rail shows **Render 7 missing beats**; the board queue readout has
the same key. It opens a small sheet. Local: "11 cards · time depends on your graphics card · you can keep
working" (a time shows only when past job times for that model exist). Cloud: "11 cards · about 160 credits ·
you have 600 · renders on bloop". Keys: **Render 11 cards** (orange) and **Not now**. Jobs queue one at a time on
the existing GPU worker; gap slots turn into blue lights. One **Cancel all**. A beat whose reference card failed
is skipped with a plain reason.
**Why it wins.** It replaces about 11 Generate presses and the hunt across the board.
**Where it lands.** `POST /spaces/:id/render-plan` (CSRF) and a RenderPlan pipeline in `src/server/generation/`:
collect owed cards (plan `node_ids` never rendered or failed; done cards never re-queued), order by wires
(references, beats, bed), estimate (local from past job durations, cloud from `model.credits` in
`cloud-models.js`), enqueue on the per-card path. Rail key in `cut/rail.edge`, readout in
`public/js/board/generation.js`. Not in the Director panel; no Director tool calls it. Test: owed set, wire
order, skip on failed upstream, zero calls from Director tools.

### 2.3 Empty states that show the shape of the result — P1 (dock), P2b (board), S

The empty dock shows ghost lanes in seam grey with hatched slots "01 · Open  02 · Turn  03 · Close" over a ghost
waveform: "No clips yet. Render a beat's video card and it lands here." The empty board ("Empty bay") shows the
same ghost strip: "Make a short film. Clips land here in order, timed to music." Keys appear only when their
feature exists: **Ask the Director** (only with a key), **Start from a starter**, **Bring my clips**. A Music
lane with no bed: "No music yet. Wire an Audio card labelled music bed, or drop a song here." Ghosts are static
and every state is real text. **Where.** Ghost variants in `cut/tracks.edge` and `cut/item.edge`, the empty bay
in `editor.edge`, hatch from `color-mix` of seam tokens in `cut-tracks.css`, copy in the controls registry (§4).

### 2.4 Starter boards: a full plan with no key and no internet — P2b, M

**What the person sees.** **Start from a starter** opens an HTMX modal with 3 starters: "Night drive · 4 beats ·
0:20 · music", "Product turn · 3 beats · 0:12", "Postcard from the sea · 5 beats · 0:25 · voice + music". One
press lays out wired text, image, video and music-bed cards with beat tags and editable prompts. Render missing
beats, the live cut and the dock work unchanged. With a key, the Director can adapt it later.
**Why it wins.** The only way to a timed film with music for someone with no API key.
**Where it lands.** `src/shared/starters/*.json` (under 120 lines each). `src/server/spaces/apply-starter.js`
writes a `director_plans` row, `director_plan_beats` rows (tags, lanes, briefs, roles) and the cards through
`ops/board-ops.js`, so BoardCut, Render missing beats and the Director all see a normal plan.
`starter-modal.edge`, `POST /spaces/:id/starter`. Card models from `defaultSource()` (§2.6). Test: BoardCut
orders a starter without `ORDER_GUESSED`; no banned franchise term in any starter file.

### 2.5 Bring my clips: a cut with zero renders — P2b, M

**What the person sees.** They drop videos and one song on the empty board or dock, or press **Bring my clips**.
"Copying 6 files to your media folder · 3 of 6", then "Your clips are in the cut · 0:52 · with your song". The
dock opens with the cut built. No GPU, no cloud.
**Why it wins.** Their own clips cut to their own song in under a minute.
**Where it lands.** Upload cards and `POST /spaces/:id/nodes/:nodeId/upload`, fixed to **stream** to the media
folder instead of reading up to 500 MB into memory. One Upload card per file, in one row in drop order (so the
no-plan position order equals drop order). ffprobe on the tools queue measures each upload into a duration field.
BoardCut accepts an `audio/*` upload labelled "music bed" as the bed; the drop labels the single song that way.
Fill runs because the cut is empty and the person dropped the files. Drop handler in `public/js/board/cards.js`.

### 2.6 Cloud-only path with no engine wall — P2b (defaults), P3 (export copy), S

Signed in to bloop with no engine: new and starter cards default to the cloud models the plan offers, and Render
missing beats shows credits before the press. The export sheet says "Export runs on this PC. Free." With no
engine and no sign-in: "Nothing can render yet. Install the engine in Settings, or sign in to bloop to render in
the cloud." with **Open Settings** and **Sign in to bloop**. **Where.** `defaultSource({engineReady, signedIn,
offered})` in new `src/shared/card-source.js` (`model-sources.js` is the engine's model catalogue).

### 2.7 As built (P2b, 2026-10-05, katana-mini)

- [x] 2.1 Live cut: `src/server/cut/live-cut.js` listens to `node` done, waits for the measurer, then `CutDraft` (fill, else
  add_new with the bed) as `by: 'auto'`; `008_cut_auto.sql` lets `updated_by` be `'auto'`; the live cut never sets
  `previous_items`. Dock: `cut-auto.js` + `src/shared/cut-rebase.js` (silent rebase on a 409 or a cut event),
  "All 7 beats are in", the auto-off sentence, **Add new clips · n**. Test: `tests/cut-auto.test.js`.
- [x] 2.2 Render missing beats: `GET/POST/DELETE /spaces/:id/render-plan`; stages `collectOwed → orderByWires →
  estimate → checkCredits → enqueueOwed`; the voice bed is owed only on a bloop model the person picked. Dock sheet
  `cut/render-sheet.edge` + `cut-render.js`, the board's readout key (`cut:missing` / `cut:render-open`). Test:
  `tests/render-plan.test.js` (owed set, wire order, failed upstream skipped, time, credits short/unknown, no engine,
  Cancel all, CSRF, no Director file reaches it).
- [x] 2.3 Board empty bay (ghost strip, the three keys; Ask the Director only with a key, also in the empty dock).
- [x] 2.4 Starters: Night drive, Product turn (1:1, no music), Postcard from the sea; `POST /spaces/starters` (new space)
  and `POST /spaces/:id/starter` (empty board only). Test: `tests/starters.test.js`.
- [x] 2.5 Bring my clips: the upload body is the file (`X-File-Name`), streamed to a `.part` file and renamed; a clip or
  sound becomes a `preset 'upload'` take measured before the route answers. Test: `tests/bring-clips.test.js`.
- [x] 2.6 `defaultSource()` in `src/shared/card-source.js`, used by the Model list, Generate, Render missing beats and
  starters (a music bed only on a music model). Test: `tests/first-run-view.test.js`.

**Gate (real server, throwaway folders, the fetched LGPL ffprobe; script `scratchpad/p2bgate/real.mjs`).** Three real
clips and a song brought in over HTTP: measured 5167, 5160, 6000 and 75000 ms; Fill put them in drop order with the
song as the bed. A 304 MB upload in its own server process grew its memory by 73 MB at the peak (96 MB: 42 MB,
480 MB: 74 MB), so the growth levels off and does not follow the file size. Night drive laid out over the form
route; the sheet listed 4 beats, 9 cards. Live cut: beat 2 landed first (9960 ms, auto, "Placed in beat order"),
beat 1 went in front of it, the person trimmed beat 1 (auto off), beat 3 then waited for Add new clips. In the
browser pane: the empty bay, the starter modal, the laid-out board and the sheet opened from the board's key.

**Deferred at P2b (the first four sentences and Cancel all are done in P5, 02-dock.md §13).** Uploads Bring my clips makes are not in the board's undo history, and a failed upload leaves its
empty Upload card. With two or more songs none becomes the bed. Add new clips also counts a clip the person took
out of the cut. Render missing beats skips a beat whose picture failed BEFORE the press; one that fails during the
run makes its clip fail with "has no render yet". Cancel all stops every render of the board, also ones started
by Generate. The local time is the mean of past renders per model, whatever their length. Starter cards do not
take the person's sticky knob defaults. Dropping files was not driven in a real browser (the HTTP path and the
dock flow with fakes were).

## 3. Smart editing and how it shows

### 3.1 The Director's turn, shown in the dock — P4, M

**What the person sees.** After a Director turn, one blue strip on the rail: "Director · 14 edits · 1:42 → 1:31 ·
Undo turn · Show". **Show** lists one row per change: "s3-door  Trimmed −0.6 s · cut on action", "s4→s5
Dissolve 0.5 s", "Music  Ducked −10 dB under 3 lines". A row click selects the clip and moves the playhead.
Trimmed clips show their lost frames as a faint blue hatched ghost past the handles. Items the Director left
alone because the person owns them show a lock mark, "Yours, untouched". Changed clips ring blue for 2 s (static
under reduced motion). The strip shrinks into the undo history at the person's next edit.
**Why it wins.** Nothing is hidden and the whole turn undoes in one press. That trust is why people let the
agent edit again.
**Where it lands.** `cut/turn-strip.edge` (~60), `public/js/components/cut-turn.js` (~100, spread into
CutDock), ghosts in `cut-strip.js`, `public/css/cut.css`. `cut_turns.ops_summary` in `007_cut_director.sql` for
sound ops; other rows come from item notes. Data from the `cut` SSE event (`changed`, `turn`). No polling.
**As built (P4 dock UI, 2026-10-05, katana-mini).** [x] Turn strip (`cut/turn-strip.edge`, `cut-turn.js`), Show edits
rows (**Go to edit**, `cut.turnRow`) floating above the dock so the marked clips stay in view, Undo turn, trim ghosts,
"Yours, untouched", the reason as the note's tooltip and a "Why:" line in the details. [x] Snap to beats (§3.4) on
trims only: a drop cannot land on a beat in a sequence lane, so the registry and guide say "a dragged trim"; keyboard
nudges are never snapped. [x] Duck under lines (§3.5) in the Music popover; the preview samples `duckGain` at 20 Hz.
[x] Check your cut on the rail with its own sheet and timed lines (§3.6). [x] "Measuring 3 clips…". `--cut-label` grew
4.5 → 6 rem so "Snap to beats" and "Beats · estimated" fit. **The dock reads** from `GET /spaces/:id/cut`: `turn`
(CutTurns.view(): `turn`, `after_rev`, `before_total_ms`, `after_total_ms`, `edits`, `rows[{kind, item_id, node_id,
beat_tag, text, at_ms, why?, was?: {in_ms, out_ms}}]`, `sound_rows`, `changed` node ids, `undoable`, optional `reasons`
and `locked`), `beats_ms`, `downbeats_ms`, `ducks[{from_ms, to_ms}]`, `speech[{from_ms, to_ms, beat_tag, text}]` (export
ms), `analysis {state: idle | measuring | missing | done, pending}`, and `at_ms` on timed findings; a `cut` event may
carry `analysis` alone. Undo turn: `POST /cut/undo-turn {turn, revision}` → 200 `{cut}` | 409 `{cut}` | 422 `{error}`.
Tests: `tests/cut-turn-view.test.js`, `tests/cut-dock-view.test.js`. Not yet: the 2 s ring is static (no pulse); no
per-row undo in the list ("undo the dissolves" is words to the Director, §3.3). Gate: the strip shows tenths when
both lengths round to the same second ("0:25.6 → 0:25.1"); the preview column scrolls on a short window instead of its
details sliding under the player.

### 3.2 Why ledger: every cut point keeps its reason — P4, S

"Why did you cut there?" gets: "The door finishes its swing at 3.9 s and the frames after 4.4 s are frozen.
Cutting at 3.9 keeps the movement going into her step." If the person moved that cut since, the Director says
the cut point is theirs now. **Where.** `why` (≤ 120 chars) is required on `trim`, `move` and `join` in
`propose_cut_ops` ("op 3: say why, from the measured numbers."), stored in `cut_turns.reasons`. `inspect_cut`
prints `Last edits:` only for beats it is asked about. Files: `cut/validate.js`, `cut/cut-ops.js`, `skills/cut.js`.

### 3.3 "Undo that" and partial undo in words — P4, S

"Undo that" takes back the last turn through the same service as **Undo turn**, only while that turn is still on
top (else one plain sentence). "Keep the trims but undo the dissolves" restores just those before values from
`cut_turns.before` through `CutEdits`, respecting the lock. **Where.** `undo_turn` op in `cut/cut-ops.js`,
shared `undoTurn` in `src/server/cut/cut-edits.js`.

### 3.4 Snap to beats — P4, S

Sensor-blue beat ticks on the ruler (measured data is sensor; orange stays for the playhead), downbeats taller,
labelled "estimated", from measured onsets only
(`analysis/onsets.js`). No video tools: no ticks, "Not measured". A **Snap to beats** toggle in the open dock's
track header (not the 32 px rail) snaps trim handles and drops within 80 ms of a downbeat, through the same
`cut-sound.js` function the Director's validator uses. Drafts are never auto-snapped.

### 3.5 Music level and duck controls — P2 (level), P4 (duck), S

The dock had a music level readout and no control. The Music and Voice lane labels get a level key with a small
popover: **Music level** −24 to +6 dB in 1 dB steps (`role=slider`, arrow keys, `aria-valuetext` "Music −14
dB"). P4 adds **Duck under lines**, −3 to −18 dB, default −10 when a bed and measured speech exist. Limits from
`cut-rules.js`; saves through `CutEdits` like the Director's `level` and `duck` ops; preview gain follows at
once. **Where.** `cut/level.edge` (~40), `public/js/components/cut-level.js` (~80).

### 3.6 Check your cut: an honest checklist, not a virality guess — P3 (sheet), P4 (timed codes), S

**Check your cut · 3** on the rail and in the export sheet: "s3: Mira's line is cut off", "Music 4 dB loud under
s5", "2 beats not rendered", "58 s, planned 45 s". Each row has **Show me** (seek and select). **Ask the
Director** shows only with a key. A fix that needs a render shows **Go to card**, never a render. Nothing to fix:
"Ready" with a check mark, seam grey, never green. **Where.** Pure rules move to `src/server/cut/findings.js`;
BoardCut, the dock and `audit-cut.js` all call it, so it works with no key. P3: GAP, STALE, MISSING_FILE,
MIXED_ASPECT, RUNTIME_OFF, UNMEASURED. P4: LINE_CUT_OFF, LOUDNESS_OFF, DEAD_AIR, SHORT.

### 3.7 Too short? A longer take, never a silent render — P4, S

A clip that cannot cover its trim or target shows "Short by 1.2 s" (code `SHORT`, threshold in `cut-rules.js`).
Asked to "hold the wide shot longer", the Director says the clip runs out. Because the person asked, it sets that
beat's card duration through `propose_board_ops`, only to a length the card's clip menu offers (`clipLength` in
`doctrine-craft.js`), and says in one sentence that the beat needs a new take. It does not name Generate. The new
take then shows **Use new take** in the Cut.

### 3.8 My editing style, remembered locally — P4, S

Settings › Director gets an **Editing style** box (plain text, ≤ 600 chars): "No dissolves. Mix to −14 LUFS. Let
shots breathe." When the person says "I never want dissolves" and agrees in chat to remember it, the Director
saves it with `remember_edit_style`, and the result shows the saved text. Read on every cut turn as one budgeted
line after EditCraft (per install, so cache-stable). **Where.** `editStyle` in `src/main/settings-store.js`
DEFAULTS (there is no settings table), the Settings view, `skills/cut.js`, `prompts/compose.js`. **As built:** [x] the box
(`data-control="settings.editingStyle"`), the route, the tool and the prompt line; P4 SHIPPED.

## 4. The Director as guide (one source of truth)

When the person asks how to use Katana, the Director answers from the same guide it uses for the board ("HOW
BLOOP STUDIO WORKS", answered WHEN ASKED). It can never describe a control that does not exist.

### 4.1 One registry of controls, with tests that stop drift — P1, M, grows every phase

- **`src/shared/katana-controls.js`** (~150 lines at P1; from K1 the entries move to
  `src/shared/katana/controls/*.js`, one file per surface, and this file only merges them, 06 §8): one entry per control,
  `{id, surface: 'dock' | 'katana' | 'board' | 'settings', label, where, does, keys, phase}`, plus `KEYS`
  (`play: 'Space'`, `inPoint: '['`, `join: 'D'`, …) and the empty-state copy strings.
- **`src/shared/katana-phases.js`**: `SHIPPED = ['P0', 'P1', …]`, flipped as each phase lands.
- **`src/server/director/prompts/guide-katana.js`** (~80): `guideKatana()` renders §4.2 from shipped entries
  only, in a fixed order, byte-stable, so the provider cache holds. `doctrine-plan.js` (145 lines) appends it to
  `GUIDE` and keeps the WHEN ASKED framing.
- **Views** draw labels with an Edge global `controlLabel('cut.export')` and mark the element
  `data-control="cut.export"`. `cut-dock.js` imports `KEYS`, so shortcuts and guide cannot disagree.
- **State-aware, only when asked.** "How do I make my first cut?" gets the shortest path for that person from
  what the context already knows (key, engine, signed in, gaps): "Press Render 7 missing beats in the Cut, then
  Play. Export makes the file." Never unasked. Tool results stay button-free.
- **`tests/katana-guide.test.js`:** every shipped id has at least one `data-control` in `src/server/views/**`
  (Go to card repeats per gap, Export sits on the rail and in the sheet); every `data-control` has an entry; no
  unshipped label is in the rendered guide; keys equal what `cut-dock.js` binds; byte-stable and under 3,000
  chars; no banned franchise term, and no "CapCut" (or another editor's name) in views, the registry, the guide
  or starters. CapCut may appear in docs only.
- **`tests/fixtures/howto.json`**: model answers kept as tests, not prompt text ("How do I make it vertical?",
  "Why is beat 4 missing?", "How do I export?", "How do I make the music quieter?", "How do I undo what you
  did?", "Can I add titles?"). Every control an answer names must be in the registry and shipped.
- **Change to 03-director.md §6:** the button-word grep covers tool results and critic lines only. The GUIDE
  block is exempt; it exists to name controls.

### 4.2 The Katana guide text (generated; shown with everything through P6 and K6 shipped)

The tag is the entry's phase. `guideKatana()` drops the tags and every line whose phase has not shipped. The words
come from the registry, so renaming a button renames the answer. **Open in Katana** sits in the dock but ships
with K1, so its entry carries `phase: 'K1'`.

```
THE CUT AND KATANA. Explain these only WHEN ASKED. Only what is listed here exists.
[P1] The Cut is the dock at the bottom of a Space. Folded, it is one line: beats in the cut, length, saved
     or not. The fold key opens it. Open, it shows a preview on the left and three lanes: Video, Voice, Music.
[P1] Clips sit in beat order. A hatched slot is a beat with no video yet; Go to card takes you to that card.
[P2] Gaps never go into the export. As exported plays the cut without them. Space or Play plays.
[P2] Fill the cut puts every rendered beat in, in order.
[P2] Click a clip to select it, or Tab into the lane and use the arrow keys. Drag a clip or press Alt+arrow
     to move it. Drag its orange handles to trim; [ and ] set in and out at the playhead; Shift+arrow nudges
     0.1 s. On touch, tap a clip to open its sheet.
[P2] The chip between two clips switches cut and dissolve (or D). M turns a clip's own sound off. Delete
     takes a clip out of the cut, never off the board; Undo shows for 8 s.
[P2] Ctrl+Z and Ctrl+Shift+Z undo and redo inside the dock. Fit fits the cut to the lane.
[P2] The level key on the Music or Voice lane sets its level.
[P2] The cut saves by itself. If it changed in another window, choose Use the newer version or Keep mine.
     On a clip with a newer take, Use new take swaps it in.
[P2b] On a planned board the cut fills itself as clips land, until you edit it; then new clips wait for
     Add new clips.
[P2b] Render missing beats queues every card the plan still needs, one at a time, after a sheet that shows
     the count (and the credits on bloop). Nothing renders until you press it.
[P2b] On an empty board, Start from a starter lays out a ready plan. Bring my clips, or dropping files,
     puts your own videos and one song into the cut, in the order you dropped them.
[P3] Export opens a sheet: what goes in, what is skipped, length, size, Preset. Press Export there. Up to
     10 minutes at 1080p. The file goes to the media folder, named after the story, and onto the board as a
     new video card. Show in folder, Copy path and Show on board find it. Export runs on this PC, free.
[P3] Set as poster, in a selected clip's details, picks the cover frame.
[P3] Check your cut lists what needs work; Show me jumps to it.
[P3] Pack assets puts every file this board made into one zip in the media folder; Include prompts and
     seeds decides whether the prompts go too.
[P3] If the video tools are missing: Settings › Video tools, then Check again or Choose ffmpeg.exe.
[P4] Snap to beats, in the open dock, makes trims and drops land on the music's downbeats.
[P4] Duck under lines, under the Music level, sets how far music drops under spoken lines.
[P4] After I edit, a strip shows what I changed: Show lists each edit, Undo turn takes it all back.
[P4] Settings › Director › Editing style holds how you like to cut; I read it on every cut.
[P6] Shapes in the export sheet makes 16:9, 9:16 or 1:1 files, one per shape, with TikTok, Reels and
     Shorts presets. In 9:16 or 1:1 the preview shows a crop box per clip; drag it or use the arrow keys.
[P6] Captions burns the script's lines into the picture; an .srt file is written next to every export.
[P6] Preview GIF writes a 6 s GIF next to the file.
[K1] Open in Katana opens the cut in the full editor. Changes there do not come back to the Space.
     A blank project there imports your own files. Katana needs a wide window.
[K2] Katana's timeline has tracks: drag, trim, snap, zoom, split, ripple, multi-select and markers.
[K3] Its preview shows titles; drag the handles to move and size a clip.
[K4] The inspector holds the volume line, fades, ducking and loudness.
[K5] Export there makes an mp4 or a wav.
[K6] Transitions, motion, speed, reverse and colour are in the inspector too.
[P4] You can also just tell me: "tighter", "cut on the beat", "music down 4 dB", "undo that". I edit; I
     never render and I never export.
```

### 4.3 The reason for each gap, in the snapshot — P4, S

"Why is beat 4 missing?" gets one true sentence: "Beat 4, Flashback, has no video yet. Its card was never
rendered, so the cut skips it." It never offers to render. **Where.** BoardCut returns a reason per gap
(`never_rendered`, `failed`, `card_deleted`, `file_missing`). `compose.js` adds one budgeted line in the
board-state half (after `buildStages`, not the cache-stable doctrine): `Gaps: s4-flashback (never rendered),
s6-roof (render failed).` Test in `tests/director-compose.test.js`.

## 5. Share-ready exports

Every recipe stays in the capped runner (`-t` and `-fs` on every step, no `aloop`, `-stream_loop` or open `apad`)
and uses LGPL core filters and the `h264_mf`, `aac_mf` (native `aac` only when `aac_mf` is missing), `gif` and
`mjpeg` encoders only. No `drawtext`,
`subtitles`, `boxblur` or `eq`. Nothing is uploaded or posted, and no file carries a link or a code.

### 5.1 Platform presets with honest numbers — P3 (Master, YouTube), P6 (vertical), S

A **Preset** picker heads the export sheet. P3: **Master** (plan shape, −16 LUFS) and **YouTube** (16:9,
1920×1080, 30 fps, −14 LUFS). P6: **TikTok**, **Reels**, **Shorts** (9:16, 1080×1920, 30 fps, −14 LUFS, −1.5
dBTP) as toggles in the Shapes row. Plain numbers: "1080 × 1920 · 30 fps · about 38 MB · −14 LUFS". Changing a
field shows "Custom". Loudness only when measured, else "Loudness not set: the mix was not measured". Length
limits are hints with a `checked_on` date, never refusals. The 600 s cap still holds. **Where.**
`src/shared/export-presets.js` (~80), read by the sheet, the route validator, the export and the `level` op's
`target_lufs` enum. Last preset per space in `space_cuts.settings`. The P0 spike checks that `h264_mf` honours
`-b:v` and `-g 60`; if not, the line says "set by Windows' encoder". Test: `tests/export-presets.test.js`.

### 5.2 File names that carry the story — P3, S

Outputs are named `{story}-{preset}-r{rev}.mp4` (`night-market-youtube-r12.mp4`), with side files beside them
(`-poster.jpg`, later `.srt` and `-preview.gif`). Story = plan title, else the space name. The board card reads
"Cut · r12 · YouTube". The done sheet lists each file with its size, **Show in folder** and **Copy path**. Old
revisions keep their names. **Where.** `src/shared/safe-name.js` (~40, the Windows rule Pack already needs), used
by `store-result.js` and `pack/zip-writer.js`. Test: `tests/safe-name.test.js`.

### 5.3 Poster frame (P3) and preview GIF (P6) — S

**Set as poster** in the selected clip's details marks the playhead time; else the middle of the first clip. One
capped step writes it after the export (`-ss t -i final.mp4 -frames:v 1 -t 0.04 -fs 2M`, `mjpeg`) into the job
temp dir, then moves it. It becomes the exported card's thumbnail and goes into the Pack. P6 adds **Preview
GIF**: 6 s from the poster, 480 px, 12 fps, `palettegen` + `paletteuse`, `-t 6 -fs 8M`. **Where.**
`cut/export/extras.js` (~120), `space_cuts.settings.poster_ms`.

### 5.4 Shapes: 16:9, 9:16 and 1:1 from one cut — P6, M

The Shapes row (shared with the vertical presets) has 16:9, 9:16 and 1:1; the plan's aspect is on by default.
One Export press queues one `cut_exports` row per shape with a shared `group_id`, run one at a time on the tools
queue. In 9:16 or 1:1 the preview greys what is cut away and shows an orange crop box per clip: drag it, nudge
2 % with the arrow keys, Home re-centres. It starts centred; no guess, and the Director never moves it. When a crop
upscales more than 2× (720p 16:9 to 9:16), the sheet offers **Fit with soft bars**: the sharp fit over a blurred,
dimmed copy (`split`, `scale`, `gblur`, `colorchannelmixer`, `overlay`). **Export again** re-runs the whole
group. **Where.** `src/shared/cut-frame.js` (~90, crop maths for preview and export); item
`frame: {'9:16': {x}, '1:1': {x}}` (0–1) validated in `cut-rules.js`; `public/js/components/cut-reframe.js`
(~150); `--cut-crop-x` on `.cut-preview`; `cut_exports.variant` and `group_id` in a P6 migration (none in P3).
NormalizeClips fits by crop then scale, always from the sources. Tests: crop numbers match the preview at x = 0,
0.5, 1; a 3-shape group spawns 3 × N capped steps.

### 5.5 Burned-in captions from the script, plus an .srt every time — P6, M

A **Captions** row: Off / Burned in. It defaults on only when the line was spoken by a voice card made from that
script and its span is measured; otherwise off, and the sheet says why ("this clip makes its own sound; its words
may not match the script"). Lines are drawn in the page as PNGs: Inter 700 on a seam-grey plate with a 2 px
orange cut on the left, AA contrast, inside the platform safe area, never Orbitron. NormalizeClips overlays each
clip's 1–3 PNGs with `overlay=enable='between(t,a,b)'`. Every export writes `{name}.srt`. **Where.**
`public/js/cut/caption-render.js` (~160), `src/shared/cut-captions.js` (~90: split at 32 chars, timing, SRT).
PNGs go up with `POST /spaces/:id/cut/exports` (≤ 50 lines, ≤ 200 KB each). New runner rule in
`capped-ffmpeg.js`: `-loop 1` only on an image input followed by `-t`. 02-dock.md §7's "the export burns no
captions" line changes when P6 lands. Tests: `tests/cut-captions.test.js`, `tests/capped-ffmpeg.test.js`.

**Dock side, as built (P6 frontend).** Shape (under the preview, per viewer and space) frames each preview video
with `src/shared/cut-frame-edit.js` `previewFrame` on `cut-frame.js` `fitFor`/`cropBox` (CSS percentages, so any
preview size shows the export's pixels; a real 9:16 export frame matched the shared box at SSIM 0.98 / PSNR 39.9 dB,
a 7 px shifted box 0.50). Crop opens CutReframe (`public/js/components/cut-reframe.js`, `crop-box.edge`): the whole
clip with the greyed outside, drag anywhere, corner / pinch / wheel zoom 1–3×, arrows 2 % (Shift 10 %), Home centres,
Enter or Escape close; one undo step per drag, key or wheel run; a new selection moves the box, Play closes it. Soft
bars in the preview: the playing clip drawn on a 32 × 18 canvas, scaled up, CSS-blurred and dimmed. Captions: the
preview plate (Inter 700, `--media-scrim-deck`, orange cut, `CAPTION_SAFE` line, container units) and the PNGs
(`public/js/cut/caption-render.js`, 52 px at the 1080 px reference, one per server cue id, sent as
`captions: {mode, images: [{id, png, width, height}]}`). The sheet (`cut-outputs.js`, `export-outputs.edge`):
the five presets, the length hint, Shapes as checkboxes with one line per file, Fit with soft bars with the
server's measured blow-up (`/cut/preflight?shapes=`), Captions Off / Burned in, Preview GIF (on by default), and
one job per press ("File 2 of 3 · 9:16", then each file with Show in folder / Copy path). Tests:
`tests/cut-frame-edit.test.js`, `tests/cut-shape-view.test.js`.

**Backend, as built (P6).** Shared rules: `src/shared/cut-frame.js` (`cropBox`, `fitFor`: the cut's own shape
unframed keeps P3's fit; another shape crops centred; soft bars when `outputs.soft_bars` and a centred crop blows up
past 2×, or `frame[shape].fit = 'bars'`; `checkFrame`, `cleanFrame`), `src/shared/cut-captions.js` (script lines
without tags, 32-character wrap, two lines a cue, three a clip, 50 a cut, one line per measured span when they
match, else spread by length; `toSrt` CRLF; `placeCaption` from the 1080 px reference above `CAPTION_SAFE`),
`export-presets.js` (TikTok/Reels/Shorts, `outputsFor`: one file per shape, the preset's own first, any other shape
a Master of that shape; `lengthHint` with `LIMITS_CHECKED_ON`), `cut-rules.js` `checkOutputs` and the item's
`frame` (moving a box is not an edit for the lock). Server: `cut/captions-plan.js` (cues from script cards +
measured speech + `caption_text` fixes; default on only when the clip's script card and a voice card are both wired
into it), `cut/export/outputs.js` (press choices, caption PNG intake: one per cue, PNG, ≤ 200 KB, ≤ 2000 × 600,
written to `.cut-tmp/captions-<group>` and swept when the group's last row ends; the readout with the measured
blow-up), `frame-chain.js` (fit / `crop=w:h:x:y,scale` / soft bars `split`, quarter-size `scale`+`crop`,
`gblur=sigma=10`, `colorchannelmixer` ×0.55, `overlay`; caption PNGs as single-frame inputs held by `overlay` with
`enable='between(t,a,b)'`, so no `-loop`), `extras.js` (PrepareCaptions, SideFiles: `.srt` every time there are
lines, GIF `fps=12,scale` 480 long side, `palettegen`/`paletteuse`, `-fs 8M`, one 360 px / 10 fps retry, never fails
the export), `010_cut_export_shapes.sql` (`variant`, `group_id`), group cancel, idempotent press per shape and
choices. `video-tools.js` reports `outputs` (per-output readiness and the plain reason). New runner rule: an input
`-loop` only as `-loop 1` on an image with its own `-t`. `drawtext`, `subtitles`, `boxblur` and `eq` never appear
(the build has `drawtext` and `subtitles`; we still draw captions as PNGs for our look and no font files).
**Gate (real LGPL ffmpeg, 3 real clips 864×480 / 1344×768 / 720×1280 24 fps, one dissolve, 3 captions):** one
press made TikTok 9:16, Master 16:9 and Master 1:1 in 11.6 s (3.6–4.0 s each); every file 11,500 ms on an
11,500 ms clock, 345 frames, h264 yuv420p 30 fps, AAC 48 kHz; captions on at 1.5 s (plate edge RGB 251,115,45) and
off between lines; GIFs 270×480 / 480×270 / 480×480, 72 frames, 3.2–5.9 MB; `.srt` beside each; event loop max
24.7 ms; the same press again returned the same rows; soft bars (Reels) 3.3 s. **It caught a P3 bug:** the per-step
`-fs` cap was 2 MB a second, and a 0.5 s 1080p dissolve junction is ~1.4 MB, so `-fs` cut it at 1 MB with no
error and the 16:9 file came out 3 frames short (342). Every step cap now has a 16 MB floor. Tests:
`tests/cut-frame.test.js`, `tests/cut-captions.test.js`, `tests/export-presets.test.js`,
`tests/cut-export-shapes.test.js`, `tests/director-outputs.test.js`, `tests/capped-ffmpeg.test.js`.

**Joint gate (2026-10-05, the real dock in the browser pane, the real server on throwaway folders, the bundled LGPL
ffmpeg; 3 real clips 864×480 25 fps, 864×480 24 fps, 720×1280 24 fps, each with its script and voice cards wired
in, one dissolve).** Presses from the sheet: Reels + 16:9 with captions and GIF (one job, "File 1 of 2 · 9:16"),
then Master 1:1 with soft bars, then Reels 9:16 after moving clip 1's crop box to x = 0.2 with the arrow keys.
Every file: h264 yuv420p 30 fps, AAC 48 kHz stereo, 11,500 ms, 345 frames (1080×1920, 1920×1080, 1080×1080).
Captions: burned in at 1.5 s / 5.0 s / 8.3 s, absent between lines (3.8 s), in both shapes of the press; the
`.srt` holds the 3 cues (0.5–3.3 s, 4.3–6.9 s, 7.8–9.0 s). GIFs 270×480 / 480×270 / 480×480, 72 frames, 2.4–3.9 MB.
Soft bars: the sharp fit over the blurred, dimmed copy at 2.3× (the sheet said 2.3×). Preview against file: the live
preview video's on-screen box (crop 270×480 at x = 296.98 of 864) and a frame of the export scored SSIM 0.977 /
PSNR 43.1 dB, 7 source px off 0.75 / 0.71; with the moved box (x = 118.98, shared maths 118.8) 0.981 / 43.7 dB.
Same choices pressed again made byte-identical files. `.cut-tmp` empty after. **Loudness:** every file measured
−16.4 LUFS integrated, peak −1.5 dBFS: the Reels file asks −14 but the true-peak ceiling (−1.5 dBTP) caps the gain
(report `reached_lufs` −16.3, `capped: true`); gain only, no limiter, as P3 built it. **Fixed in the gate:**
Captions ignored the server's default (on when every captioned clip speaks its own script), so it always started
Off and the sheet never said why: `GET /spaces/:id/cut` now carries `captions {default_on, why_off}`, the dock
follows the person's choice else that default, the sheet shows `why_off` while Captions is off, and the "makes its
own sound" note shows only when it is true. A finished export kept the sheet on its done view forever, so after one
press the person could not reach the presets or shapes again: an ended export the person has seen now starts over
at the choices (its file stays on the board).

### 5.6 The Director sets up outputs when asked — P6, S

"Make this ready for TikTok" becomes an `outputs` op in `propose_cut_ops`: shapes, preset, captions on or off,
caption text fixes. When the source aspect differs it says in one sentence that the crop will be soft. It never
sets crop boxes and never queues an export. Validated by `export-presets.js`. Test: no `cut_exports` row added,
`frame` refused.

**As built (P6).** `outputs` op (`director/cut/validate.js`, `op-handlers.js`): `preset`, `shapes`, `captions`,
`caption_text` into `settings.outputs`; `frame`, `crop`, `export` or `start` in any op refuse the whole list in
words; a caption fix on a clip the person changed needs them to name it (the edit lock); `undo_turn kinds:
['outputs']` takes only the set-up back. The tool result adds "The clips are 16:9, so 9:16 crops into each one from
the middle and the picture gets softer: say that in one sentence. The person moves the crop boxes; you never do."
`inspect_cut` ends with the set-up line. Tested: no `cut_exports` row, no job, no pack, no button word.

### 5.7 Pack manifest v1 — P3, S

The manifest gets `format: 'bloop-studio-pack'`, `version: 1` and a board section (cards, wires, positions,
labels, plan, cut), so a future importer can open old packs. The Pack sheet gets **Include prompts and seeds**
(on by default; off for a client job). No importer yet (§7). **Where.** `cut/pack/manifest.js`, with
`cut/pack/board-section.js` split out to stay under 500 lines.

### 5.8 Licence-safe filter check — P3, S

`src/shared/export-recipes.js` (~60) lists every filter and encoder our exports use. The runner caches `-filters`
through `info()` next to `-encoders`. CheckCut drops only the output a missing filter affects, with a plain reason
("This build of the video tools has no palettegen, so the GIF is skipped"). A test greps
`src/server/cut/export/` and `src/server/katana/export/` for filters not on the list. Settings › Video tools shows
"Ready for: Export, Poster, Shapes, Captions, GIF". **It caught a real bug:** K6 planned "basic `eq` filters",
but `eq` is GPL-only and missing from our LGPL build. K6 now bakes every grade control into one LUT (`lut3d`,
06 §2 #4); no colour-filter chain. The full GPL-only list is in 06 §9.

## 6. Polish details

- Every estimate says "estimated"; every missing measure says "Not measured".
- Ghost lanes, trim ghosts and the turn ring are static under `prefers-reduced-motion`.
- Hatches use `color-mix` of seam or sensor tokens; no new colours. "Ready" is seam grey, never green.
- One orange key per place (Render missing beats, Export). Play is never a second accent.
- The level popover and the crop box are keyboard-first: `role=slider`, arrows, Home, the cut-control focus ring.

## 7. What was cut, and why

| Idea | Why it was cut |
|---|---|
| Trim by the script (Lines lane) | Line matching breaks on clips that make their own sound; Mini has no split; the voice bed is one item. L for an unreliable result. |
| Re-cut to any length (versions) | L. Breaks one cut per Space (`space_cuts.space_id` UNIQUE) across routes, lock and hand-off. `fitPlan` on a duplicated Space or Full Katana covers it. |
| Vertical by Director framing | The Director cannot see frames; "keep Mira left" would be a guess shown as a decision. The crop box lives in Shapes. |
| Beat ticks seeded from the plan's tempo | The plan has no tempo; the bed is a free-text note. Ticks come from measured onsets only. |
| Auto-snapping drafts to the music | Changes lengths nobody asked for; analysis lands after the draft. Only the default duck depth survived. |
| Cut recipes (shareable templates) | New file format and import for little gain; editing style plus `fitPlan` covers "cut it like my usual". |
| Smart centre guess for crops | An edge-energy centroid on a 64 px still is often wrong. Centred plus one drag is enough. |
| Title and end card ("Made with", opt-in) | A new item kind touches every core module. Titles belong to Full Katana (K3). |
| Teaser mp4 | Duplicates versions; `-c copy` at cut points is fragile. |
| Drag-out share card | Needs a new preload IPC on a sandboxed window. Show in folder and Copy path cover it. |
| Open a pack (importer, P7) | A zip reader for files from others is a security surface; demand unproven. Manifest v1 keeps the door open. |
| Older exports list | Export again is already planned; a Recycle Bin IPC is clutter. |
| Watch it now (accent Play) | Already planned; a second orange key next to Export breaks the palette rule. |
| 20-second first cut guide | A coach strip is clutter; empty states plus the when-asked guide teach the same. |
| First export celebration | Card and toast are planned; the plate, seam light and auto-pan are gimmicks. |
| Ask chips in the dock | Clutter, useless without a key; the empty state already has Ask the Director. |
| Play before (second preview source) | M for a compare Undo turn already gives. The trim ghost survived. |
| Eight model answers in the prompt | Kept as test fixtures only; prompt budget for little gain. |
| Hashtag drafting | The Director can already write post text in chat when asked. |

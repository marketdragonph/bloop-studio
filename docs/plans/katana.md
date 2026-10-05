# Katana: Mini Katana (the Cut in a Space) and Full Katana — PARTIAL (Mini Katana built on branch katana-mini, final gate 2026-10-05: P0–P4, P2b, P6 COMPLETE, P5 PARTIAL for the owner's clean-PC export run; Full Katana and Katana FX PLANNED)

Roadmap row 4. Planned 2026-10-05 by a team of four planners (core, dock UI, Director, Full Katana) and merged
here by the lead. The owner said build; Mini Katana (P0–P6, P2b) is built on `katana-mini`, not merged to `main`.

This file is the merged plan. The detail lives in eight section files, each under 500 lines:

| File | What it holds |
|---|---|
| [katana/01-core.md](katana/01-core.md) | Storage, routes, the BoardCut reader, the cut clock, the capped export, Pack assets, ffmpeg on the PC |
| [katana/02-dock.md](katana/02-dock.md) | The Cut dock in the board: layout, tracks, preview player, edit actions, autosave, states, accessibility |
| [katana/03-director.md](katana/03-director.md) | `stitch_cut`, `propose_cut_ops`, `inspect_cut`, `pack_assets`, the edit lock, the cut critic, `EditCraft` |
| [katana/04-full.md](katana/04-full.md) | Full Katana: survey of bloop's Creatives timeline editor, gap analysis, port plan, data, segment export with resume, phases K1–K9 with exit criteria |
| [katana/05-irresistible.md](katana/05-irresistible.md) | What makes people pick it and stay: the one-sentence cut, first run, the Director as guide, share-ready exports |
| [katana/05b-p6-as-built.md](katana/05b-p6-as-built.md) | P6 outputs as built: dock side, backend, the real-ffmpeg gate and the joint gate (moved out of 05 §5.5) |
| [katana/06-full-capcut.md](katana/06-full-capcut.md) | Full Katana with a CapCut feel: layout, magnetic main track and linkage, keys, feature table, beat-CapCut list, 2 h performance plan, port vs rebuild |
| [katana/07-fx.md](katana/07-fx.md) | Katana FX: one WebGL2 compositor for preview and export, plain/fx export paths, VRAM and ComfyUI, effect sets and their security, the v1 library with licences, the effects browser, the Director's FX ops, phases FX0–FX5. **Wins over 04 and 06 on pictures** |

## Irresistible (summary of [katana/05-irresistible.md](katana/05-irresistible.md))

Owner's ask: "production grade, irresistible, making us many users", and the Director helps with how to use it.
Four idea lenses gave 44 ideas; a reviewer kept 25 (with fixes) and cut the rest. The kept ideas:
- **Hero: cut my film in one sentence** (P4). "Cut it together, under a minute, punchy" gives a story-aware cut
  in one Director turn, because the Director planned each beat's role. Honest when a target cannot be reached.
- **First run in 2–5 presses** (P1, P2b): the cut builds itself as clips land, **Render missing beats** (one
  person press, cost shown first), 3 offline starters for people with no key, **Bring my clips** with a song,
  empty states that show the result's shape, and a cloud-only path with no engine wall.
- **Smart editing you can see** (P2–P4): the Director's turn strip with one-press undo, a why for every cut
  point, "undo that" in words, Snap to beats, music level and duck sliders, **Check your cut**, honest "too
  short" handling, and an editing style remembered on the PC.
- **The Director as guide** (P1 onward): one registry `src/shared/katana-controls.js` feeds the GUIDE block, the
  Edge labels and the dock keys; `tests/katana-guide.test.js` fails on any drift. Full guide text in 05 §4.2.
- **Share-ready exports** (P3, new P6): presets with honest numbers, story file names, poster, licence-safe
  filter check, Pack manifest v1; then 16:9 / 9:16 / 1:1 with a crop box per clip, burned-in captions plus .srt,
  a preview GIF, and the Director's `outputs` op. Nothing is uploaded or posted; no telemetry.
- Found and fixed on the way: K6's "basic `eq` filters" is GPL-only; K6 now bakes the grade into one LUT (`lut3d`).

The approved look is the mockup `cut-canvas/project/Main.dc.html` (session scratchpad, published as an artifact):
a dock at the bottom of the board, preview on the left, tracks Video / Voice / Music, an orange playhead, hatched
gap slots with **Go to card**, Director notes on clips in sensor blue, duck bands on the music, an **Export** accent
key and a **Pack assets** key.

## 1. What the owner asked for

1. **Mini Katana** = the "Cut" dock inside a Space. Rendered beat clips in beat order, trim, reorder, cut or
   dissolve, a music and voice bed, a browser preview and one capped export.
2. **Full Katana** = a standalone timeline editor at `/katana/:id`, a port of bloop's Creatives timeline editor.
   Mini Katana hands off to it with **Open in Katana**.
3. **Agentic.** The Director (`src/server/director/`, the port of bloop's Spaces Director) can stitch the cut,
   pack all the assets, and do smart editing: trim dead frames, cut on action, J and L cuts, duck the music under
   lines, cut on music beats, and set loudness.

## 2. Owner rules (they hold in every phase)

- The Director **never renders on the GPU**. No Katana tool queues a ComfyUI or bloop cloud job.
- The Director **never exports**. Export is the person's press.
- The Director **never tells the person which buttons to press**. It says what it changed, in editing words.
- Project rules: at most 500 lines per file, CSS variables only, one Alpine component per file, shared rules in
  `src/shared/`, RESTful routes with the CSRF header, jobs never block the event loop, `node --test` with a temp
  SQLite file and fake services (fake spawn, fake ComfyUI), never the GPU.

## 3. Source of truth, and what changes for local

We port bloop's **plan**, not code. bloop planned the mini timeline and never built it:
`C:\Users\MYPC\Projects\bloop\docs\plans\spaces-mini-timeline.md` and `spaces-mini-timeline/01-timeline.md`,
`02-board-agent-branches.md`, `03-ui-bugs-mecha.md`, `04-qa.md`. The bloop checkout is shared and read only.

**Ported verbatim** (names, numbers, behaviour):
- One cut per Space. `items` JSON with a pinned `node_id` and a snapshot, `previous_items` (one-step Undo draft),
  `revision` with a 409 that carries the server copy. Canvas saves never touch the cut.
- Caps: 50 items, 600 s, 1080p. Dissolve 250–1000 ms, default 500, at most half the shorter neighbour.
- Missing beats are skipped and named before export. The result is a new video card on the board.
- The CappedFfmpeg rule set (bloop 01 §4, 04 §5): output `-t` always, `-fs` always, no `aloop` / `-stream_loop` /
  open `apad`, two threads, a timeout per step, one export at a time, tries 1, a temp sweep.
- `stitch_cut {fill | add_new}`, `CutDraft`, the snapshot line, "never overwrite the person's edits".
- The dock: the 32/44 px rail, the edit actions table, the A/B preview with 150 ms drift fix, the gap slate,
  800 ms autosave + local draft + "adopt the server revision on 409", the 8 s remove undo, 50-step dock undo.
- Full Katana: bloop's `TimelineDTO`/`TrackDTO`/`ClipDTO` field names in ms, the revision lock, the junction
  transition model, the volume envelope, ducking merge, the loudness preset table.

**Adapted for local, and why:**
- **No durable-URL rule.** Every take is a file in the media folder (`MediaStore`,
  `src/server/generation/media-store.js`), also for bloop cloud renders. `NOT_DURABLE` becomes `MISSING_FILE`.
- **Items pin a take.** Studio has a `takes` table (`001_spaces.sql`); items keep `take_id` + `media_path`.
- **Lengths are measured** by ffprobe when a take lands (`takes.duration_ms`), not by a media-library job.
- **SSE, not polling.** Progress and cut changes ride `BoardEvents` (`src/server/generation/events.js`,
  `GET /spaces/:id/events`). No presence channel, no 3 s HTMX poll.
- **A local queue, not Horizon.** An in-process media-tools queue, concurrency 1, separate from the GPU worker
  (`src/server/generation/worker.js`). `nice -n 10` becomes Windows below-normal priority.
- **ffmpeg ships with the app** (Q1). bloop runs it on a server; here it runs on the person's PC.
- **The Director edits, not only stitches.** bloop's rule "no trims, the agent cannot see a clip" is replaced by
  the owner's smart editing. The Director measures clips first (`inspect_cut`), and the edit lock keeps bloop's
  promise not to overwrite the person.
- **Full Katana is rewritten small**: ~9,700 new lines against bloop's ~45,000, by dropping cloud, team and
  AI-vendor code, keeping one renderer, writing timing once in `src/shared/`, and skinning from tokens.

## 4. Settled conflicts between the sections

The four sections disagreed in places. The lead picked the safer and simpler option each time.

| # | Conflict | Settled | Why |
|---|---|---|---|
| 1 | Where the capped runner lives: `src/server/cut/capped-ffmpeg.js` (core, Full) vs P0's `src/server/media/capped-ffmpeg.js` | **`src/server/media/capped-ffmpeg.js`** (already built in P0, with `locateFfmpeg`) | It serves export, analysis, Pack and Full Katana, not only the Cut. One runner. |
| 2 | Migration numbers: core `006_cuts.sql`, Full `006_katana.sql` | `006_cuts.sql` (P1), `007_cut_director.sql` (P4: `media_analysis`, `cut_turns`), `008_katana.sql` (K1). As built: 007 and 008 went to P3/P2b, so P4 is `009_cut_director.sql` | Mini ships first. Renumber at build time if another migration lands first. |
| 3 | Pack assets: a ZIP job in `spaces/{id}/packs/` with our own store-only writer (core) vs a folder **or** zip with a zip library, a `cut.edl` and its own `pack_progress` / `pack_ready` events (Director) | **Core's ZIP job.** The Director's `pack_assets` queues the same job. No `zip` / `only` options in v1. `cut.edl` moves to Full Katana K7. | One code path, no new dependency, one event. A folder of copies is a second format to test. |
| 4 | Clip analysis engine: ffmpeg filters vs JS in a hidden window vs both | **Bundled ffmpeg filters** (`silencedetect`, `ebur128`, `freezedetect`, `scdet`) through the capped runner | Export already needs ffmpeg (Q1). The JS path is ~400 extra lines. Cloud-only users still get it: it ships in the installer. |
| 5 | Where analysis runs: a worker thread on a CPU queue vs the export queue | **One media-tools queue** (`src/server/media/tools-queue.js`), concurrency 1, child processes. Exports and packs jump ahead of analysis. | ffmpeg is a child process, so the event loop never blocks. One disk-heavy job at a time. |
| 6 | Dock save verb: `PATCH /spaces/:id/cut` (Director) vs `PUT` (core) | **`PUT` with `revision`**. Both the dock and `propose_cut_ops` go through one `CutEdits` service. | One write path; whole-items save is what the 409 test pins. |
| 7 | SSE event names: `cut` / `cut_export` (core), `cut` / `export` (dock), `cut_updated`, `offer_cut_replace`, `pack_progress`, `pack_ready` (Director) | **Two events: `cut` and `cut_export`.** `cut` carries `{revision, by, added, missing, changed, turn, offer}`; `offer: 'replace'` is bloop's `offer_cut_replace`. `cut_export` carries `kind: export \| pack`. | Fewer listeners in `GET /spaces/:id/events`. bloop's names survive as payload fields. |
| 8 | Who wrote an item: `by` + `note` ≤ 160 chars (core) vs `placed_by` + `person_rev` + `director_note` ≤ 40 (Director) | **`placed_by`, `person_rev`, `note` ≤ 40 chars** | The lock needs `person_rev`. A note sits on a clip chip; 40 chars fits. |
| 9 | Duck windows: stored `cut.music.ducks[]` (dock) vs only `sound.music.duck {depth_db, attack_ms, release_ms}` with spans measured (Director) | **Store only the duck settings.** `src/shared/cut-sound.js` turns settings + measured speech spans into windows. `GET /spaces/:id/cut` returns `ducks[]` and `beats_ms` so the dock draws and plays the same numbers the export uses. | One source; a re-trim moves the ducks with the lines. |
| 10 | `UNMEASURED` finding: kept (core) vs dropped (Director) | **Kept** in BoardCut and the critic | ffprobe can fail or be missing; the Director must not trust an asked length. |
| 11 | A feature flag for the Director's cut tools (Director) vs no flag (dock) | **No flag.** The tools ship with P4 and are listed always. | The app has no flag system; the tools refuse plainly when there is no cut. |
| 12 | Test folder `test/director/…` (Director) vs `tests/` | **`tests/`** | Where every test in the repo lives. |
| 13 | Director tool texts that point at buttons ("dock now offers to replace…", bloop's "point at ⚡ Generate") | Reworded to say what happened and that the choice is the person's. Never a button name. | Owner rule. |
| 14 | Full Katana export cap vs Mini's 600 s | The runner takes a cap from its caller, with a hard ceiling. Mini: 600 s. Full: 2 h 15 min (§8.3), `-fs` scaled to length. | Keeps `-t` and `-fs` on every step either way. |

Lower-stakes choices the lead made (no owner question needed):
- Gaps in the preview play a slate the size of the beat's planned length, as the mockup does. The readout shows
  both numbers ("0:47 to export · 0:55 with gaps"). The export skips gaps. Beds, ducks and beat ticks live in
  export time; a slate pauses the bed, and an **As exported** toggle plays exactly what the file will be
  (01-core.md §5, 02-dock.md §7).
- J/L cuts sit only on a cut join in v1, never on a dissolve, and need source sound outside the trim.
- Ducks are one shared envelope (preview samples it, export gets it as a `volume` expression), and loudness is
  one measured gain applied as `volume=<gain>dB`, capped under the true-peak ceiling, so the preview plays the
  same gain. Not `loudnorm`'s second pass, which turns dynamic when linear cannot reach the target (04-full.md §5).
- Analysis runs only for media in a cut, the bed, or what `inspect_cut` asks for, not for every take that lands.
- The dock is folded by default and opens by itself once, the first time a draft lands (Director or Fill), then
  remembers the person's choice per space.
- The Voice lane shows the voice bed card. Read-only dialogue spans appear once the Director's analysis records them.
- Full Katana allows a blank project from `/katana` with local file import into the media folder (~200 lines, K1).
- Captions in Full Katana: from the script first (K6b, no AI), then local whisper.cpp on the person's press (K7).
  The person's own OpenAI key stays an opt-in with a clear "audio is sent to OpenAI" note (06-full-capcut.md §9).

## 5. Phases (Mini first)

Sizes are new lines, about, tests in addition. Each phase updates this file (`[x]`, PLANNED → PARTIAL → COMPLETE),
`docs/features.md`, and adds one `CHANGELOG.md` line under `## Unreleased` when the person can see it.

### Mini Katana

| Phase | Scope | Size | Status |
|---|---|---|---|
| **P0** | Foundations: Range/206 on `GET /media/*`, the capped ffmpeg runner, the shared cut clock | ~580 | COMPLETE on katana-mini (fa366e0); the 8-clip ffmpeg spike moves to P3 |
| **P1** | Read-only dock: `006_cuts.sql`, `repositories/cuts.js`, `cut/board-cut.js`, `GET /spaces/:id/cut`, `MeasureTake` stage, the dock frame, rail, tracks and gap slots with **Go to card**. From 05: the controls registry + `guide-katana.js` + `tests/katana-guide.test.js` (M, §4.1), dock ghost empty states (S, §2.3) | ~1,400 | COMPLETE on katana-mini (e92d7a0). Deferred: browser duration fallback, measuring uploads, server waveform for beds over 10 min, Ask the Director only with a key |
| **P2** | Editing + preview: `PUT` with 409, `CutDraft` + **Fill the cut**, reorder, trim, joins, clip sound, undo/redo, autosave + local draft, the A/B preview player, music/voice sync. From 05: **Music level** slider (S, §3.5) | ~1,500 | COMPLETE on katana-mini (9935fd3). Deferred: J/L preview (P4), caption chip, filmstrip frames, long-press drag, narrow item sheet |
| **P2b** | First run (05 §2): live cut with `cuts.auto` and the silent rebase (M), **Render missing beats** (M), 3 starter boards (M), **Bring my clips** with streamed uploads (M), board empty bay (S), `card-source.js` cloud defaults (S) | ~1,400 | COMPLETE on katana-mini: `cut/live-cut.js` + `008_cut_auto.sql` (`updated_by 'auto'`) + `src/shared/cut-rebase.js`; Render missing beats (`generation/render-plan/`, `routes/render-plan.js`, `generation/enqueue.js`, the dock sheet, the board readout key, Cancel all); starters (`src/shared/starters/`, `spaces/apply-starter.js`, `routes/starters.js`, modal); Bring my clips (`routes/uploads.js` streamed body, `MediaStore.saveUploadStream`, uploads are measured `preset 'upload'` takes, `cut-bring.js`); the empty bay; `src/shared/card-source.js` + `generation/offered.js`; P2b controls SHIPPED. Gate notes in [katana/05-irresistible.md](katana/05-irresistible.md) §2.7. Deferred: see §2.7 |
| **P3** | Export + Pack assets: ffmpeg in the installer, the export pipeline, the media-tools queue, `cut_exports`, the export sheet, Pack ZIP job, **Show in folder**. From 05: Master/YouTube presets (S, §5.1), story file names + `safe-name.js` (S, §5.2), poster (S, §5.3), **Check your cut** untimed via `cut/findings.js` (S, §3.6), Pack manifest v1 (S, §5.7), licence-safe filter check (S, §5.8), "Export runs on this PC. Free." | ~1,850 | COMPLETE on katana-mini: spike (fetch-ffmpeg + installer resources + notice), the export pipeline and tools queue, Pack, Settings › Video tools, the export and pack sheets, poster, P3 controls SHIPPED; gate numbers in [katana/01-core.md](katana/01-core.md) §10b–§10c. `COPYING.GPLv3` shipped in P5. Deferred: a check of `resources/ffmpeg` in a packaged install (owner), Master at −16 LUFS per 05 §5.1 (owner may want −14), sources under 30 fps are converted up |
| **P4** | Director: `stitch_cut`, analysis job + `inspect_cut`, `propose_cut_ops` with the edit lock, ducking and beat snaps, the cut critic, `pack_assets`, `EditCraft`, one undo per turn. From 05: one-sentence cut (beat `role`, phrase table, `fitPlan`, S, §1.1), turn strip (M, §3.1), why ledger (S), undo in words (S), **Snap to beats** (S), **Duck under lines** (S), timed **Check your cut** codes + `SHORT` (S), editing style (S), gap reasons in the snapshot (S) | ~2,650 | COMPLETE on katana-mini: the dock UI (turn strip + Show edits + Undo turn, notes and reasons, trim ghosts, Snap to beats, Duck under lines, beat ticks, timed Check your cut on the rail, measuring line; 05 §3.1 as built), Settings › Director › Editing style, P4 controls SHIPPED; the backend (03-director.md §11): `009_cut_director.sql` (`media_analysis`, `cut_turns`), `src/server/analysis/` (AnalyzeMedia on the tools queue, `CutAnalysis`), `cut/findings.js` + `cut/cut-check.js`, `cut/cut-turns.js` (`POST /cut/undo-turn`), `src/shared/cut-ducks.js`, `fitPlan` + `CRITIC`, `director/cut/` (lock, validate, op handlers, CutOps, critic, inspect text, cut state), `skills/cut.js` (`stitch_cut`, `propose_cut_ops`, `inspect_cut`, `pack_assets`, `remember_edit_style`), `doctrine-edit.js`, beat `role`, snapshot/lock/gaps/roles lines. Gates: real ffmpeg, every fixture within ±0.1 s, ~0.2 s per 8–10 s clip, 0.5 s for a 75 s bed, a 5-minute bed in 2.5 s with event-loop max 36 ms; end to end with a fake model over the real Claude provider code (03 §11 "Gate"). Deferred: a live turn with a real key (owner), "speech" on clips with steady ambient sound, the mix-vs-target `LOUDNESS_OFF` rule, per-clip gain (`level track: clips`), 05 §3.7 by the existing board op |
| **P5** | Dress + QA: mockup polish, narrow-screen sheet, reduced motion, AA contrast check, the 300-card perf check, bloop 04-qa.md cases, a clean-PC export run | ~500 | PARTIAL on katana-mini: everything is built; the one item left is the clean-PC export run (owner, needs a second PC): the P2b follow-ups (Cancel all scoped by `jobs.origin`, `settings.left_out`, Bring my clips failure / undo / song choice, takes kept on undo of a delete, the playing tag, the CSP error from Phase 1a), `COPYING.GPLv3` + dev `vendor/ffmpeg`, AA contrast from tokens in both themes (22 of 74 pairs failed before, 80 of 80 pass after), the narrow sheet + item sheet + 44 px targets + reduced motion, the 300-card perf check (0 long tasks from the dock in 5 runs, was up to 4 per run at 54–74 ms), bloop 04-qa.md cases as `tests/katana-qa.test.js` and a scripted look check (two clean runs, 4 views). Numbers in [katana/02-dock.md](katana/02-dock.md) §13. P5 controls SHIPPED |
| **P6** | Outputs (05 §5): Shapes 16:9 / 9:16 / 1:1 with a crop box per clip and soft bars (M), TikTok/Reels/Shorts presets (S), burned-in captions + .srt (M), preview GIF (S), the Director's `outputs` op (S) | ~1,000 | COMPLETE on katana-mini (joint gate 2026-10-05, 05b "Joint gate"): the dock side is built (Shape under the preview framed by the export's crop maths, Crop with the crop box, soft bars and captions in the preview, caption PNGs, the sheet's presets / Shapes / soft bars / Captions / GIF rows, one job per press, P6 controls SHIPPED, guide under 3,000 characters; 05b "Dock side, as built"). The backend half is built too: `cut-frame.js` / `cut-captions.js` / presets / `checkOutputs`, `captions-plan.js`, the frame chain (fit, crop, soft bars with `gblur`), caption PNG overlays, `.srt`, GIF, one row per shape (`010_cut_export_shapes.sql`), group cancel, the Director's `outputs` op; real-ffmpeg gate 3 shapes in 11.6 s, every file on the clock to the frame (05b "Backend, as built"); it also fixed a P3 `-fs` cap that cut 1080p dissolves 3 frames short. The joint gate exported one cut through the real dock (Reels 9:16 with captions, Master 16:9, Master 1:1 with soft bars, GIFs): every file 345 frames on the 11,500 ms clock; the live preview's crop matched the exported frame at SSIM 0.977–0.981; it fixed Captions ignoring the server's default and a done sheet that never went back to the choices |

Each phase also adds its controls to `katana-controls.js` and flips `SHIPPED` in `katana-phases.js`, so the
Director's guide (05 §4.2) grows with the app and never names a control that is not there.

### Mini Katana final gate (2026-10-05, katana-mini)

- **Tests.** Katana set 300/300 (15.5 s). Whole suite (`node --test "tests/*.test.js"`, 67 files) 418 of 419: the one
  failure is env-only, `app-update.test.js` "third-party notices" reads `node_modules` from the worktree root, which a
  worktree does not have; the same assertions pass against the main checkout's `node_modules` (56 packages).
- **Real flow in the browser pane** (real server on throwaway folders, GPU worker off, the real Claude provider code on
  the P4 fake model, the bundled LGPL ffmpeg; 1600×960 light and dark, 390×844 light and dark): empty Space → Night
  drive starter → the Render missing beats sheet (9 cards, not pressed) → a second empty Space → Bring my clips with 4
  real clips + a song (cut 0:36 with the song under it) → trim (8.0 → 6.1 s by mouse), drag-reorder, dissolve → Play
  (counter, both videos and the music in step at 6.6 s) → Director "cut it together, under a minute, punchy": 2 edits
  0:33 → 0:27, the two clips the person trimmed / joined left alone ("Yours, untouched"), a fresh fill offered, not
  forced → Undo turn back to 33,641 ms exactly → Reels 9:16 + burned-in captions + GIF: 1080×1920, 30 fps, 1009 frames
  (33.633 s for a 33.641 s cut), h264 + AAC 48 kHz, 31.3 MB, .srt cue 17.5–23.3 s, poster → Show on board → Pack: 12
  files + manifest v1.
- **Found and fixed:** the gap slate and "No clips yet" on top of each other (02-dock.md §14); Export off screen at
  390 px (02-dock.md §14); the Director panel stuck on "Working" with an empty second bubble when a fast turn streamed
  and finished before its POST answered (a race in `public/js/board/director.js` from the Director port, so main has
  it too; `tests/director-panel-race.test.js`). 05-irresistible.md was 528 lines: the P6 as-built record moved to
  [katana/05b-p6-as-built.md](katana/05b-p6-as-built.md).
- **Checks:** every file in src, public, tests, scripts and docs is ≤ 500 lines (`cut-dock.js` 497); no hex, rgb or
  `!important` in the Katana CSS (two `rgb(0 0 0 / …)` shadows in `board.css` and `director.css` predate the branch);
  no inline `style=` in views; all 17 mutating Katana routes answer 403 without the CSRF header; the bundled ffmpeg is
  `--enable-version3` with no `--enable-gpl`, `COPYING.GPLv3` matches its pinned sha256, `export-recipes.js` refuses
  GPL-only and text filters; the Director's cut tools and doctrine name no control (every "button" in them is a "do
  not name any buttons" line), and the guide is "only WHEN ASKED".
- **Before a release (owner):** the clean-PC export run and a check of `resources/ffmpeg` in a packaged install; a live
  Director turn with a real key; merge `katana-mini` to `main` (`011_job_origin.sql` may need a new number then).

P0 checklist (branch work, see [katana/01-core.md](katana/01-core.md) §5–§7):
- [x] `src/server/media/byte-range.js` + Range/206/416 in `src/server/routes/generation.js`, `tests/media-range.test.js`
- [x] `src/server/media/capped-ffmpeg.js` (refusals, `-fs`, timeout, below-normal priority, `locateFfmpeg`), `tests/capped-ffmpeg.test.js`
- [x] `src/shared/cut-clock.js`, `tests/cut-clock.test.js`
- [x] The 8-clip spike: time, peak memory, AAC drift at seams, size, encoder quality (feeds Q1); run in P3, numbers in [katana/01-core.md](katana/01-core.md) §10b
- [ ] Merge to `main`

### Full Katana (after P6; K8 after P4). Target: CapCut feel, better than CapCut ([katana/06-full-capcut.md](katana/06-full-capcut.md))

| Phase | Scope | Size | Status |
|---|---|---|---|
| K1 | Projects and the shell: `008_katana.sql` (projects, exports, segments, versions), repository, routes, schema + round trip, hand-off with chapters and clip `source`, project list, blank project + import, the four-zone page, bin MEDIA / BOARD with hover scrub | ~1,400 | PLANNED |
| K2 | Editing model: raw store, pure ops with inverses, magnetic main track, overlay tracks, linkage, snap, split rules, Q/W, ripple, markers, I/O, group, op-patch history, CapCut keymap, autosave queue + 409 merge | ~2,400 | PLANNED |
| K2b | Timeline at 2 hours: virtual lanes, filmstrip tiles, minimap, zoom, story spine, versions, **Re-take this shot** + Swap | ~1,700 | PLANNED |
| K3 | Preview: shared clock, decoder pool, rebuilt canvas renderer, text renderer shared with export, handles, preview axis, proxies | ~2,100 | PLANNED |
| K4 | Sound: waveforms, three buses with meters, volume keyframes, fades, ducking, LUFS, beat ticks + snap, record voice-over | ~1,400 | PLANNED |
| K5 | Export for 2 h films: ~60 s segments with resume (the person's press), windowed mix, scaled caps, export sheet, chapter metadata, `.srt`, static shapes | ~1,800 | PLANNED |
| K6 | Look and motion: transitions, animations, text templates, keyframes, speed, freeze, reverse, one-LUT grade (LGPL `lut3d`, never `eq`), looks, match to board still, moving crops | ~2,600 | PLANNED |
| K6b | Script and captions with no AI: SCRIPT tab, **Caption all lines**, caption editor, **Delete line** | ~900 | PLANNED |
| K7 | Speech model (local whisper.cpp, downloaded on the person's press) and Line check | ~800 | PLANNED |
| K8 | Ask bar (Ctrl+K): the Director proposes shared `ops/` with the edit lock, one undo per turn, **Cut to the music**. Never renders, never exports | ~1,200 | PLANNED |
| K9 | By request: speed curves, chroma key, masks, HSL and wheels, noise reduction, compound clips, webm/mov/gif, `cut.edl`, AI cutout via a trusted ComfyUI workflow | — | PLANNED |

### Katana FX (effects, transitions, text animations; [katana/07-fx.md](katana/07-fx.md))

| Phase | Scope | Size | Lands with | Status |
|---|---|---|---|---|
| FX0 | Spike: hidden window + ffmpeg I420 feed + compositor + `h264_mf` encode of 60 s 1080p; frame-index fixtures (16–60 fps, VFR, speed), fps, VRAM, parity, context loss, a Wan render alongside | ~600 (kept) | Before K3 | PLANNED |
| FX1 | Engine + golden-frame parity: compositor (preview half), plain/fx routing, fx-host, export window, GPU gate (export half), effect set format, lint, licence gate | ~4,000 (−2,250 replaced) | K3 + K5 | PLANNED |
| FX2 | 30 transitions, flash limiter, effects browser (TRANSITIONS tab, hover preview, Apply to all joins) | ~1,500 + content | K6 | PLANNED |
| FX3 | 15 effects, 8 looks, EFFECTS tab and E1 lane; SDF text, 14 text animations, 8 titles, 14 fonts | ~2,300 + content | K6, K6b | PLANNED |
| FX4 | Beat effects; the Director's 4 FX ops, catalogue, doctrine, critic codes | ~1,100 | After K4; with K8 | PLANNED |
| FXm | Mini: join menu, one look per cut, FX join parts through the compositor; the dissolve stays `xfade` | ~550 | After FX2 | PLANNED |
| FX5 | Later: data-only user sets, then signed shader sets; WebCodecs decode; preview cache | ~900+ | On request | PLANNED |

Exit criteria per phase are in [katana/04-full.md](katana/04-full.md) §7 and 07-fx §9. Each K phase adds its controls to the
registry (`surface: 'katana'`), so guide lines appear only as they ship. K5 and K6 exports join the licence-safe
grep (05 §5.8).

Total: Mini P0–P6 ~10,900 lines (was ~6,500; the 05 ideas add ~4,400, of which P6 is ~1,000 and P2b ~1,400),
Full K1–K8 ~16,300 lines (was K1–K6 ~9,900 + K8 ~800; the CapCut model, the 2 h scale and the story features
add ~5,600). Katana FX adds ~6,650 net to Full (≈ 23,000) and ~550 to Mini (≈ 11,450), plus ~4,000 lines of
shader and JSON content and ~1.2 MB of fonts.

## 6. How the pieces fit

- **One reader.** `src/server/cut/board-cut.js` works out each beat's clip (newest video card labelled with the
  beat tag, `build/lane.js`, preferring the beat's `node_ids`; a wired lip-sync card wins). The dock, `CutDraft`,
  the export preflight and the Director all call it. The client never guesses.
- **One clock.** `src/shared/cut-clock.js` gives item starts, dissolve overlap and the total. Preview, export and
  the Director use it. The export test asserts the file length equals the clock total ± 34 ms.
- **One rule file.** `src/shared/cut-rules.js` holds caps, dissolve and J/L limits, gain ranges and critic
  thresholds. The dock, the route validator, `propose_cut_ops` and the export read it.
- **One write path.** `CutEdits` (`src/server/cut/cut-edits.js`) validates and saves with the revision check.
  The `PUT` route, `CutDraft` and `propose_cut_ops` call it.
- **One runner, one queue.** Every ffmpeg/ffprobe call goes through `src/server/media/capped-ffmpeg.js`. Every
  export, pack and analysis job goes through `src/server/media/tools-queue.js`. A test fails the build if any other
  file under `src/server/` spawns ffmpeg.
- **One stream.** The board's single EventSource (`public/js/board/generation.js`) feeds the dock: `node` events
  update slots, `cut` events reload or show the banner, `cut_export` drives export and pack states.

## 7. Risks

| Risk | What we do |
|---|---|
| A runaway ffmpeg fills the disk (bloop once wrote 523 GB) | Capped runner refuses any call without output `-t`; `-fs` on every step; free-disk preflight 3 × estimate; temp dir on the media volume, swept on start. Tested with a fake spawn. |
| Installer grows by the ffmpeg binaries | Measure in P0; LGPL build only (Q1). |
| `h264_mf` quality or a Windows N edition without the Media Feature Pack | P0 spike checks quality; the preflight names the missing encoder and links Settings; fall back per Q1. |
| The dock slows the board | No watcher on `nodes`; the playhead is one CSS variable; frames captured on idle; folded dock holds no media; 300-card perf check in P5. |
| Keys leak to the board (Ctrl+Z, Delete) | `onKeyDown` in `public/js/board/cards.js` returns early inside `.cut-dock`; a test pins it. |
| Lost work on 409 loops (bloop's full editor) | The client adopts the server revision in the same step; a test pins "the save after a conflict succeeds". |
| The Director overwrites the person | Edit lock (`placed_by`, `person_rev`); one undo per turn; all-or-nothing ops. |
| Analysis is wrong (beats, speech) | Every estimate is labelled "estimated"; `inspect_cut` lists what is not measured; the critic flags `LINE_CUT_OFF`. |
| Preview and export disagree | One clock, one rule file, one sound function; the export test checks the total ± 34 ms. |
| Full Katana scope creep | Phases K1–K8 fixed with exit criteria; K9 only by request; the feature table (06 §5) marks every CapCut feature must / should / later / skip. |
| An app close mid-export | Rows left running become failed with a plain message; the temp dir is swept on start. |
| ffmpeg missing on a PC (antivirus quarantine, a cloud-only person, a Windows N edition) | Preview and editing still work; Export, Pack and analysis say why and link **Settings › Video tools** (Check again, Choose ffmpeg.exe…). The Director refuses only timed ops and says the cut could not be measured. |
| A runner call with no output file (ffprobe, `-encoders`, analysis to the null muxer) slips past the `-t` rule | `info()` is a separate entry with no lavfi input, a 10–20 s timeout and a 1 MB stdout cap; analysis still needs output `-t`. |
| The exported cut card becomes a clip in the next draft | BoardCut never takes a card whose take is `preset 'cut'`; a test pins it. |
| Full Katana: `reverse` holds a whole clip in memory | Reversed source capped at 20 s in its own segment (04-full.md §5). Transitions no longer need an `xfade` match: the compositor draws them in preview and export (07-fx). |
| FX: `h264_mf` software encode is the export bottleneck (est. 60–90 fps); a 2 h all-effects film takes ~60–90 min on a 6–8-core desktop, ~2–3 h on a 4-core laptop, ~4–12 h in software WebGL | FX0 measures it before K3; the sheet shows a measured "estimated" time; plain segments skip the GPU; Resume per segment. |
| FX: export frames differ from the preview by a source frame (VFR phone clips, 16/24/25 fps sources, off-grid in-points) | FX0 exit: a burned-in frame-number fixture matches `timing.js` in export and in the paused preview; VFR gets a CFR intermediate if it drifts (07-fx §1.1). |
| FX: a hung shader trips Windows' 2 s GPU reset (TDR), which can kill ComfyUI's CUDA context mid-render | First-party shaders only; GLSL lint (constant loops ≤ 64); 4K cost test; heavy items in scissor tiles; 250 ms export watchdog. |
| FX: VRAM contention on 12 GB cards | Caps 256 MB export / 192 MB preview; FX segments wait and free textures while a local render runs; preview drops to ½ and skips heavy items; a ComfyUI on another PC never gates. |
| FX: per-file licences in gl-transitions are self-declared; Shadertoy defaults to CC BY-NC-SA | Per-file licence gate; headers of all 30 used files checked at `902218a` (MIT, Page curl BSD-3); a file citing Shadertoy or an unlicensed page is out even if it says MIT; trivial items written by us; a grep fails the build on `shadertoy`. |
| FX: scope grows Full by ~6,650 net lines and ~4,000 lines of content | Phased with K3–K8; FX5 only by request. |
| Analysis competes with ComfyUI for CPU | Only on demand, below-normal priority, one at a time, behind the person's exports. |

## 8. Owner decisions (2026-10-05)

1. **ffmpeg: A.** Bundle an LGPL win64 build in the installer (`extraResources`, pinned sha256). Encode video with
   Windows' `h264_mf` **and audio with Windows' `aac_mf`**, so both encoders are Microsoft's licensed ones. ffmpeg's
   native `aac` is only the fallback when `aac_mf` is missing (Windows N). GPL (`libx264`) is out.
2. **Edit lock: A.** Items the person changed are locked unless they name the item, or the whole cut, in words this
   turn. One undo per Director turn.
3. **Export caps.** Mini Katana: 600 s, 50 items (the Director's beat cap). **Full Katana: 2 h 15 min at 1080p**
   (films up to 2 h, plus titles and credits). Safety comes from caps that scale with length, not a low ceiling:
   `-t` and `-fs` on every step (final file ≈ length × 10 Mbit/s, ~9 GB for 2 h), a disk preflight of 3 × the
   estimate (~27 GB free for 2 h, refused in plain words otherwise), per-segment rendering joined by the concat
   demuxer (flat memory), and **resume from the last finished segment** after a failure.
4. **Patents: no counsel to start.** Encoding goes through Windows' licensed encoders; ffmpeg's H.264 decoder ships
   the way VLC, OBS and HandBrake ship it. Counsel review before 100k installs a year or before selling the app.
5. **Director in Full Katana: an Ask bar, not a standing panel** (owner: "feel like CapCut"). Ctrl+K or a toolbar
   Director key slides it in; it closes when done. Same tools, edit lock and one undo per turn as the dock.
6. **Build order: A** (owner: follow the recommendations). P2b after P2, P6 after P5, both before K1.
7. **Render missing beats on bloop cloud: A** (owner: follow the recommendations). The sheet always shows the credit
   estimate and balance first and refuses plainly when short. The press is the person's; the Director never starts it.

**Critic pass (2026-10-05):** GPL filter list, preview/export parity, 2 h segment and mix sizes, key clashes with
Electron's default menu, contrast and file splits fixed in 04 and 06; two owner questions in 06-full-capcut.md §10.

**Full Katana target (owner, 2026-10-05): feel like CapCut, better than bloop's Creatives editor.** A CapCut teardown
and a Full Katana mockup come before K1 (04-full.md).

## 9. Open questions (2026-10-05, Katana FX; detail in [katana/07-fx.md](katana/07-fx.md))

The lead decided the rest of Katana FX: one compositor, ffmpeg I420 feeds, first-party effects only in v1,
and **exports with effects wait while a local ComfyUI render runs** (opt-in to share the graphics card).

A. **Bin tab EFFECTS instead of LOOKS.** Full Katana's bin keeps seven tabs; LOOKS becomes EFFECTS with Looks as
   its first category. This changes 06 §2 #3 ("no effects tab"). An eighth tab would be ~45 px wide, too tight
   for a stencil label. **Recommendation: yes.**
B. **Software WebGL fallback.** Add `enable-unsafe-swiftshader`, so PCs whose GPU Chromium blocklists still get
   effects (slower, in software) instead of none. It is safe here only because the app loads nothing but its own
   127.0.0.1 pages; it is a security-relevant switch, so it needs your yes. Honest cost: a 2 h film with effects
   would export in ~4–12 h in software (vs ~1–1.5 h on a GPU). **Recommendation: yes**, with the Settings › Video
   tools line "Effects run in software on this PC; export is much slower" and the measured time on the sheet.

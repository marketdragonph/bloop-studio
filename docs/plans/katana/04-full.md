# Katana 04 — Full Katana (standalone editor) — PLANNED

Part of [../katana.md](../katana.md). Settled conflicts there win over this file.
Full Katana opens at `/katana/:id`, a page of its own. It ports the logic of bloop's Creatives timeline editor and
rebuilds the rest to **feel like CapCut, better than CapCut** (owner, 2026-10-05). Mini Katana hands a cut to it
with **Open in Katana**. The layout, editing model, keys, feature table and performance plan are in
[06-full-capcut.md](06-full-capcut.md); where this file and 06 differ, 06 wins. **The renderer, export pictures,
transitions, effects, looks and text animations follow [07-fx.md](07-fx.md) (Katana FX: one WebGL2 compositor for
preview and export); where 07 differs from this file or 06, 07 wins.**

## 1. What bloop has today (read, not guessed)

bloop's copy is read only (`C:\Users\MYPC\Projects\bloop`). Paths below are in that checkout.
**Size:** about 45,000 lines.

| Layer | Files | Lines |
|---|---|---|
| Client JS: `resources/js/VideoEditor.js` (395) + `resources/js/video-editor/**` | 1 + 60 | 23,272 |
| CSS: `resources/css/design-system/video-editor.css` (3,627) + `video-editor/*.css` | 8 | 11,483 |
| Blade: `timeline-editor.blade.php`, `timeline-editor-shell.blade.php` (439), `partials/timeline*` | 27 | 6,890 |
| PHP: `FFmpegRenderService.php` 4,715 · `FFmpegService.php` 482 · `TimelineService.php` 367 · `ExportVideoJob.php` 175 · DTOs 352 | 7 | 6,091 |

**Front-end libraries:** none besides Alpine. Vanilla JS, Canvas 2D, `<video>`/`<audio>`, Web Audio.
`collaboration.js` and `audio-effects.js` use Laravel Echo. `video-editor-entry.js` registers one Alpine component,
`VideoEditor`, which spreads about 50 mixins into one object, so no mixin can be used alone.

**Client files** (`resources/js/video-editor/`, lines):
- Core: `state.js` 662, `timeline.js` 565 (zoom, snap, time), `clips.js` **1272**, `selection.js` 208,
  `tracks.js` 327, `history.js` 87, `utils.js` 267, `ripple-edit.js` 165, `grouping.js` 323, `box-select.js` 189,
  `markers.js` 304, `minimap.js` 129, `contextmenu.js` 267 (also the clipboard), `keyboard.js` 431.
- Playback: `playback-core.js` 188, `sync.js` 369, `volume.js` 264, `media-elements.js` 397, `reverse-buffer.js` 203.
- Preview: `preview.js` **1473** (DOM preview + handles), `canvas/canvas-renderer.js` 961, `canvas/text-renderer.js` 555,
  `canvas/clip-effects.js` 341, `canvas/pixel-effects.js` 393, `canvas/hit-region.js` 178,
  `canvas/interaction-layer.js` 59, `canvas/preview-bridge.js` 182 (Canvas/DOM switch), `canvas/tools/*` 542,
  `split-screen.js` 265, `auto-reframe.js` 261.
- Text and motion: `text-core.js` 229, `text-animation.js` 376, `animation-presets.js` 296,
  `motion-keyframes.js` **1088**, `keyframe-controls.js` 283, `keyframe-markers.js` 320, `speed-ramp.js` 807.
- Look: `effects.js` **1038**, `effects/oblique-blur.js` 93, `color-curves.js` 566, `color-wheels.js` 298,
  `mask.js` 712, `mask-handles.js` 557, `mask-keyframes.js` 254, `pen-tool.js` 481.
- Sound: `waveform.js` 188 (server-stored peaks), `audio-effects.js` 343.
- Assets and IO: `drag-assets.js` 484, `drag-trim.js` 232, `asset-durations.js` 120, `import-capture.js` 183,
  `persistence.js` 506 (1.5 s debounced save; 409 reloads), `property-tabs.js` 114.
- Cloud and AI: `captions.js` 649 (OpenAI Whisper), `ai-generate.js` 503, `remove-bg.js` 330 (Replicate RVM),
  `collaboration.js` 395.

**Features:** video/audio/text tracks with lock, hide, mute; trim, split, ripple, groups, snap, minimap, clip
markers (0..1); titles and text animations; junction transitions (left OUT + right IN: fade, dissolve, wipe, slide,
flip, glitch); motion keyframes and In/Out/Combo animations; constant speed, ramps, reverse; filters, blend modes,
curves, wheels, masks, pen; volume keyframes, fades, ducking, noise reduction; loudness presets (`loudnorm`);
captions; exports mp4, webm, mov (ProRes 4444), gif, mp3, wav, png.

**PHP side:**
- `TimelineService.php` parses, validates and edits; `CreativeController::saveTimeline` returns **409** on a stale `revision`.
- DTOs: `TimelineDTO` (version, duration, width, height, fps, tracks, revision), `TrackDTO` (id, type, name, locked,
  visible, muted, clips), `ClipDTO` (~35 fields, times in ms: `startTime`, `endTime`, `trimStart`, `trimEnd`, speed,
  volume, `volumeKeyframes`, `speedKeyframes`, markers, fades, animations, content, style, filters, transitions,
  curves, zIndex, ducking, reversed …). The save still drops fields: `TimelineDTO::toArray()` has no `groups`,
  and `ClipDTO` has no `filterPreset` or `originalAssetId` (the fix at `video-editor-release-schedule.md:339`
  was partial).
- `ExportVideoJob`: tries 2, timeout 3600, progress in Cache, file to S3 or local disk.
- `FFmpegRenderService::render` builds **one `filter_complex` with every clip as a live input** (`:737`), then
  `amix` + `loudnorm` + `apad`, with **no output `-t` and no `-fs`**. `FFmpegService::concat` (`:196`) uses
  `-c copy` on mixed codecs with no `-t`. A stitch on this code family once wrote **523 GB**
  (`docs/plans/spaces-mini-timeline.md:26`).

bloop's own plan never ports this renderer; it only hands off to it. Full Katana brings the editor itself local.

**Gap analysis (2026-10-05), what changes the plan:**
- `canvas/**` (3,211 lines) never shipped: nothing imports it, the live preview is the DOM path in `preview.js`.
  `text-renderer.js` never ran for a user either. We rebuild the renderer; `canvas/*` is a reference only.
- bloop's own speed work (release schedule "Phase N", P0) is unshipped: full-JSON history snapshots, one `<video>`
  per clip, every clip rendered with `x-for`, a new Set per frame, a linear snap scan. It cannot hold a 2 h film.
- Ramps, In/Out animations, text animations and outline show in preview and are ignored by the export; an
  animated zoom crashes it. Root cause: no shared clock or timing module.
- The export uses GPL `eq` (16×), `boxblur`, `perspective` and `libx264`. No look or transition string ports as is.
- Autosave drops a save asked for during a save, never flushes on close, and a 409 reloads over local edits.
- Split copies every field to both halves; markers and volume points (0..1 of the clip) drift on every trim.
- `magneticMode` is only a snap flag; there is no main track and no linkage. Q/W exists and works.

## 1b. Target (owner, 2026-10-05)

"The full katana I want to make it feel like CapCut … better than that." Films up to 2 h (export cap 2 h 15 min,
segments, resume). The Director is an Ask bar (Ctrl+K), not a standing panel. See 06 §1–§6.

## 2. What we port, adapt and drop

**Ported (logic, rewritten as pure functions):** the `TimelineDTO`/`TrackDTO`/`ClipDTO` shape and names, times in
ms; the `revision` lock (stale save → 409, adopt the server revision); 1.5 s debounced autosave; `history[0]`
protection; ripple delta, snap and zoom math; split source-point maths and Q/W; the trim clamps; the junction
transition model; the volume envelope; `mergeOverlappingDuckRegions`; the loudness preset table; the
`animation-presets` definitions as JSON. Full list in 06 §8.

**Changed from the first draft of this file:** the keyboard map is CapCut's (06 §4.4), not bloop's; markers,
volume points and keyframes are stored in **source ms**, not 0..1 of the clip (hand-off converts once); history
stores op patches, not snapshots.

**Adapted for local, and why:**
- **PHP to Node, one source of truth.** bloop keeps envelope, timing and ops twice (JS and PHP). We write them
  once as pure functions in `src/shared/katana/`; the page, the server and the Director import the same code.
- **One mega-object becomes several components.** One Alpine component per file, ≤ 500 lines. Timeline state in
  `Alpine.store('katana')`; logic in pure modules `node --test` can test.
- **One compositor, rebuilt (07-fx).** One WebGL2 compositor on one clock with a pool of 8 decoders draws the
  preview and, in a hidden window, every fx export segment. bloop's `canvas/*` is an untested reference; the DOM
  path in `preview.js` and the bridge drop.
- **Schema, not a whitelist.** zod schema in `src/shared/katana/schema.js` (zod is already a dependency). A
  round-trip test keeps every field.
- **Export in capped segments, never one giant graph** (§5): ffmpeg on a desktop and the known runaway bugs.
- **Media.** Clips point at `MediaStore` files through `GET /media/*` with Range/206 (P0). Peaks from
  `reduceTrack()` in `public/js/components/audio-player.js` at a finer resolution, cached.
- **CSS.** Not bloop's 11.5k lines: re-skinned with `public/css/tokens.css` and `mecha.css`. Orange = playhead,
  live, Export. Blue = in progress and Director notes. Everything else seam grey.

**Dropped:** teams and company scoping, `can:access` / `limit:creatives`, Creatives as a list; `collaboration.js`;
S3, signed URLs, `batch-urls`, thumbnail uploads; credits; `remove-bg.js`, the `ai-generate.js` panel (people
generate on the board) and platform publishing; the `video_animations` seeder (JSON instead).
**Deferred, not refused (K9):** chroma key, masks, pen, HSL and wheels, speed curves, adjustment layer, split-screen.
**Dropped for licence or scope:** auto-reframe, stabilise (`vidstab`), heart / star / spin (taste). The old
licence drops (oblique blur, flip, glitch, page curl) are lifted: they are shaders in the compositor now, gated by
the per-file licence check and the golden-frame test (07-fx §5–§6).

## 3. Data model: `src/server/db/migrations/008_katana.sql` (K1)

```sql
CREATE TABLE katana_projects (
    id             INTEGER PRIMARY KEY,
    name           TEXT    NOT NULL,
    space_id       INTEGER REFERENCES spaces(id) ON DELETE SET NULL,
    source_cut_rev INTEGER,             -- cut revision it was made from
    timeline       TEXT    NOT NULL,    -- TimelineDTO-shaped JSON
    revision       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE katana_exports (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES katana_projects(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, step TEXT,
    media_path TEXT, error TEXT, cancel_requested_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), finished_at TEXT
) STRICT;
CREATE TABLE katana_export_segments (       -- resume (K5)
    export_id INTEGER NOT NULL REFERENCES katana_exports(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL, hash TEXT NOT NULL, path TEXT, status TEXT NOT NULL,
    PRIMARY KEY (export_id, idx)
) STRICT;
CREATE TABLE katana_versions (              -- versions sheet (K2b)
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES katana_projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                     -- auto_turn | auto_export | auto_open | named
    name TEXT, timeline_gz BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
ALTER TABLE space_cuts ADD COLUMN katana_project_id INTEGER REFERENCES katana_projects(id) ON DELETE SET NULL;
```

- `katana_exports` also gets `preset`, `shape`, `group_id` (one row per shape) and `resumed_from`.
- The timeline JSON gains `chapters[] {id, name, role, startMs}`, and per clip `linkedTo`, `linkOffsetMs`,
  `enabled`, `source {spaceId, nodeId, takeId}`, `groups`, `filterPreset`, `grade`, `frame` (crop per shape).
- Versions: keep the newest 50 automatic ones; named ones are unlimited. Restore saves the current state first.

- One project per cut. Repository `src/server/repositories/katana-projects.js`; save is
  `UPDATE … WHERE id=? AND revision=?`, 0 rows = 409.
- `katana_exports` makes an export safe to press twice: the same revision with a finished export returns that file.

## 4. Routes and hand-off (`src/server/routes/katana.js`, 127.0.0.1, CSRF on mutations)

| Method | Path | What it does |
|---|---|---|
| GET | `/katana` | Project list (Edge view) |
| POST | `/katana` | Blank project (with optional file import into the media folder) |
| GET | `/katana/:id` | The editor page |
| GET | `/katana/:id/timeline` | JSON and `revision` |
| PUT | `/katana/:id/timeline` | `{ revision, timeline }` → 200 `{revision}` or 409 |
| POST | `/spaces/:id/cut/katana` | Hand-off: makes or reopens the cut's project, then redirects |
| POST | `/katana/:id/exports` | Queues an export (the person's press) |
| GET | `/katana/:id/exports/:exportId` | Status; download through `/media/*` |
| DELETE | `/katana/:id/exports/:exportId` | Cancel |
| GET | `/katana/:id/events` | SSE progress, the `BoardEvents` pattern with a project key |

**Hand-off** (`src/server/katana/handoff.js`, bloop's `SpaceCutTimeline::open` shape, adapted):
- **V1** holds the cut items end to end: `in_ms`/`out_ms` become `trimStart`/`trimEnd`; a dissolve becomes the
  junction transition (left `transitions.out`, right `transitions.in`); a J/L offset becomes the audio clip's
  offset on A1 (linked to its V1 clip); Director notes become clip markers (sensor blue, in source ms); clips
  point at `/media/…`, `assetId` null, and carry `source {spaceId, nodeId, takeId}` for **Re-take this shot**.
- **Chapters** come from the plan's beat roles (`director_plan_beats.staging.role`): one chapter per beat,
  "04 TURN · The door". A blank project starts with none; **Add chapter** (Shift+M) makes them.
- **A1** holds clip sound split out where J/L is used, plus the voice bed. **A2** holds the music bed, with the
  Cut's duck windows as `clip.ducking`.
- If the cut changed since the project was made (`cut.revision > source_cut_rev`), an HTMX modal offers
  **Open existing project** or **Start a new project from this cut**.
- The key and the modal say: "Changes in Katana do not come back to the Space."
- Test: hand-off → save → load keeps every field.

**Blank project** (lead's default, ~200 lines in K1): import local files by copying them into the media folder
through `MediaStore`, so Full Katana is a real standalone editor. Each import is probed with the capped `info()`
call; a file the page cannot play (HEVC, ProRes, 10-bit) imports, shows "Preview cannot play this file; the export
can" until K3, then gets a proxy by itself (06 §7). A file ffprobe cannot read is refused.

**Narrow and touch:** Full Katana is a desktop editor. Under 64rem the page shows the timeline full width with
the inspector as a sheet; under 40rem it shows a plain notice "Katana needs a wider window" with **Back to the
Space**, rather than a broken layout. Coarse pointers get 44 px handles, as the dock.

## 5. Export: Mini Katana's capped runner and queue, in segments (K5)

No second ffmpeg runner. Every call goes through `src/server/media/capped-ffmpeg.js`, every job through
`src/server/media/tools-queue.js` (one export slot shared with Mini Katana). Cap per owner decision 3: **2 h 15 min
at 1080p**. The runner's `FINAL_CAP_BYTES` (1.5 GB on the P0 branch) becomes a cap the caller passes, scaled to
length (≈ length × 10 Mbit/s, ~9 GB for 2 h) under a hard ceiling; each segment gets its own `-t` and `-fs`.
Disk preflight 3 × the estimate. The sheet says "2:04:31 · 1080p · about 9.1 GB · needs 27 GB free".

Stages (`handle(ctx, next)`, `src/server/katana/export/`):
1. **CheckProject** — load the saved revision, schema check. Refuse: no playable items, over the cap, free disk
   < 3 × estimate, no ffmpeg.
2. **ResolveSources** — paths from `MediaStore`; a missing file is a plain refusal.
3. **ProbeSources** — `ffprobe`, clamp trims to the real length.
4. **PlanSegments** — `src/shared/katana/segments.js` (pure): segments of about 60 s, cut at the V1 join nearest
   the target, never inside a transition, a reversed clip or a freeze. A segment closes early at 24 inputs. Not at
   every layer change: captions alone switch every 2–4 s and would make ~3,000 segments, each a fresh encoder
   and keyframe. A 2 h film plans ~120.
5. **RenderSegments** — one segment at a time, on one of two paths (07-fx §2–§3, which wins): **plain** (V1 hard
   cuts only, no overlay, text, grade, effect or transition: ffmpeg `concat`, no GPU) or **fx** (the compositor in
   a hidden window reads ffmpeg I420 feeds and pipes raw frames to the capped `h264_mf` encoder through the
   `fx-host` utility process). FX segments wait while a local ComfyUI render runs; plain ones continue. No
   `xfade`, `overlay`, title PNGs, `sendcmd`, `blend` or `lut3d` in Full Katana's export any more. Both paths
   share one encode recipe: H.264 yuv420p at the project fps with `-t seglen`. Each finished segment writes a
   `katana_export_segments` row with a hash (timeline slice + source mtimes + recipe version + compositor version
   + each used effect's manifest and GLSL hash + font hashes). **Resume** reuses
   every segment whose hash still matches; the sheet shows "Segment 41 of 120" and **Resume from segment 41**.
   Resume is the person's press; an export never restarts by itself after a crash or a restart.
6. **JoinSegments** — concat demuxer `-c copy`, safe because step 5 encoded every segment the same way.
7. **MixSound** — **in windows** (never one `amix` with every clip): a window is a chapter, split at 5 min and at
   32 inputs, so a blank project with no chapters still mixes in small steps. Per clip `atrim`, the envelope from
   `src/shared/katana/envelope.js` (fades included, linear, as the preview), ducking, `amix duration=first
   normalize=0` into a PCM wav with `-t`. Window wavs join with the concat demuxer (PCM joins are sample-exact).
   Loudness: pass one measures the whole film (`loudnorm` print / `ebur128`); the final gain is one
   `volume=<gain>dB` from `loudness.js`, capped so the true peak stays under −1.5 dBTP, `-t total`, `-fs`. Not
   `loudnorm`'s second pass: when linear mode cannot reach the target under the peak it silently switches to
   dynamic mode, and the preview's single gain no longer matches. When the cap lowers the target the sheet says
   so ("−14 LUFS needs clipping; mixed to −15.2 LUFS").
   Chapters also go in as mp4 chapter metadata (ffmetadata, mux only) and a `-chapters.txt` beside the file.
8. **MuxAndStore** — into the media folder; temp cleanup in `finally`.

Formats in K5: mp4 (H.264 + AAC via `aac_mf`) and wav, plus `.srt` and `-chapters.txt` beside every export.
Quality Lower / Recommended / Higher maps to `h264_mf` `-b:v`; fps 24 / 25 / 30; up to 1080p; shapes 16:9 /
9:16 / 1:1 as one row each. webm, mov, gif and `cut.edl` in K9 if asked. Progress per segment over SSE.

Preview and export must agree (critic pass; **pictures superseded by 07-fx**):
- **Pictures (07-fx wins):** transitions, effects, motion keyframes, opacity, blend, the LUT grade and text are
  drawn by the one compositor in both preview and export, so the `xfade`-match rule, the `transitions.js` canvas/
  `xfade` list test, `sendcmd`, `overlay` on `gbrap`, `blend` on `gbrp`, title PNG frames and `lut3d` are
  **replaced** by 07-fx §10's golden-frame parity test. Kept from the old bullets: `keyframes.js` as the one
  per-frame table, the five blend modes, the probed colour matrix and range (now applied in the compositor's
  source pass), bundled fonts only. Mini Katana keeps `xfade` fade for its dissolve; a test pins that the
  compositor's Dissolve matches it.
- **Transitions (old rule, Mini only now):** Dissolve = `xfade` `fade`, never `xfade`'s noise `dissolve`.
- **Speed and reverse:** timing from `src/shared/katana/timing.js` on both sides (`setpts=PTS/<speed>`, `atempo`
  chained in 0.5–2.0 steps; pitch off = `asetrate` + `aresample` and `preservesPitch = false`). ffmpeg's
  `reverse`/`areverse` hold the whole input in memory, so a reversed clip is capped at 20 s of source and
  reversed in its own segment; longer reversals refuse in the inspector with the reason. A `<video>` cannot play
  backwards, so the preview plays a reversed 540p proxy that pressing Reverse queues on the tools queue (CPU,
  seconds for 20 s); until it lands the clip shows a blue level and "Reversing".
- **Motion keyframes and opacity:** `src/shared/katana/keyframes.js` turns keys and easing (linear, ease in,
  ease out, ease in-out, hold) into one per-frame table; the compositor samples it in preview and export.
- **Blend:** Normal, Multiply, Screen, Darken, Lighten only (`blend.js`), computed in the compositor's shader.
- **Colour:** one 33³ LUT from `grade.js` as a 3D texture, applied last, in preview and export. ProbeSources
  records each file's matrix and range (untagged: BT.709 at 720p and up, else BT.601); the fx source pass uses
  them; segments and proxies are tagged BT.709 limited. The parity test covers a tagged and an untagged clip.
- **Text:** SDF glyphs drawn by the compositor (07-fx §1.3), bundled fonts only, in preview and export.
- **Envelope and ducking:** one `volume` expression from `envelope.js`, the same breakpoints the preview samples
  (as Mini's `duckExpr()`, 01-core.md §5).
- A test exports a 3-segment fixture with the fake runner and checks every segment `-t` sums to the timeline
  length from `timing.js`; the real run (skipped without `vendor/ffmpeg`) checks the file within ± 34 ms.
- The golden-frame parity test (07-fx §10) replaces the old 9-frame test: 12 frames, preview path vs export path
  vs checked-in SwiftShader goldens, and the encoded segment decoded back, within set tolerances.

## 6. Client layout (every file ≤ 500 lines)

The full file split is in 06 §8. In short:
- **`src/shared/katana/`:** schema, clock, timing, segments, envelope, ducking, loudness, transitions, grade, snap,
  chapters, proxy rule, beat-fit, align, findings; `ops/*` — each `(timeline, args)` → `{timeline, inverse}`,
  with `ops/link.js` resolving linked followers for every op. Replaces most of `clips.js` and `TimelineService.php`.
- **`public/js/katana/`** (pure, no Alpine): history (op patches), keymap (CapCut map from `KEYS`), media pool
  (8 decoders), virtual lanes, tiles, peaks, hover scrub; `render/{handles,hit}.js`; the compositor in
  `public/js/katana/fx/` (07-fx §1–§3).
- **`public/js/components/`** (one Alpine component per file, sharing `Alpine.store('katana')` with raw timeline
  data): store, timeline, tracks, trim, spine, minimap, preview, transport, inspector, keyframes, bin, script,
  versions, export, ask, status.
- **Views:** `src/server/views/katana/` page + partials (topbar, one bin partial per tab, viewer, one inspector
  partial per tab, timeline toolbar / spine / ruler / tracks / minimap, status, ask bar, export and versions sheets).
- **CSS:** `public/css/katana/{layout,bin,viewer,inspector,timeline,clips,spine,ask}.css`. Tokens only,
  `prefers-reduced-motion` on playhead easing, the Ask bar slide and the Director ring.

## 7. Phases (new lines, about; tests in addition)

| Phase | Scope | Size | Status |
|---|---|---|---|
| K0 | Prerequisites from Mini Katana: bundled ffmpeg, capped runner, Range/206, the tools queue | — | P0 PARTIAL, P3 PLANNED |
| K1 | **Projects and the shell.** `008_katana.sql` (§3), repository, routes, zod schema with every field + round trip, hand-off with chapters and clip `source`, project list, blank project + import. The four-zone page from 06 §3 (top bar, bin, viewer, inspector, timeline zone, status strip, splitter, narrow-window rules) with static content; bin MEDIA and BOARD tabs with hover-scrub sprites | ~1,400 | PLANNED |
| K2 | **Editing model.** Store with raw timeline, pure `ops/` returning inverses, magnetic V1, free overlay tracks with auto new track, linkage (Alt to free), snap index, split rules, Q/W and `[` `]`, ripple, trim clamps, multi-select, group, enable/disable, markers, I/O, copy/paste, op-patch history, CapCut keymap (06 §4.4), autosave queue + flush on close + 409 merge | ~2,400 | PLANNED |
| K2b | **Timeline at 2 hours.** Virtual lanes, filmstrip tiles and cache, minimap, log zoom + Fit, toolbar toggles, story spine with chapter moves, versions sheet (auto + Ctrl+S), **Re-take this shot** with the take bridge and **Swap** | ~1,700 | PLANNED |
| K3 | **Preview.** Shared clock, decoder pool of 8, the **Katana FX compositor** (07-fx FX1 preview half; FX0 spike first), transform handles and guides, preview axis (S), preview quality, proxies that build themselves, **As exported** | ~2,100 (+FX1) | PLANNED |
| K4 | **Sound.** Peaks and waveforms, buses A1 Dialogue / A2 Music / A3 FX with meters and solo, volume keyframes, fades, ducking under measured lines, LUFS target and readout, beat ticks + **Beats** snap, **Extract audio**, **Record voice-over** | ~1,400 | PLANNED |
| K5 | **Export for 2-hour films.** Segment pipeline (§5) with resume, plain/fx routing, fx-host + hidden export window + GPU gate (07-fx FX1 export half), windowed mix, length-scaled caps, disk preflight, export sheet (preset, quality, fps, size), chapter metadata, `.srt`, static shapes 16:9 / 9:16 / 1:1 | ~1,800 (+FX1) | PLANNED |
| K6 | **Look and motion.** Transitions (07-fx FX2: 30 shaders, effects browser), effects, looks and text animations + titles (FX3), motion keyframes, constant speed, freeze frame, reverse ≤ 20 s, mirror / rotate / crop, one-LUT grade with curves, **Apply the look**, **Match to the board still**, .cube import, moving crops | ~2,600 (+FX2, FX3) | PLANNED |
| K6b | **Script and captions (no AI).** SCRIPT tab, **Caption all lines** with speaker chips, caption list editor, **Delete line** (text cut), timing from measured speech spans, burn-in through the compositor's text pass (07-fx) | ~900 | PLANNED |
| K7 | **Speech model and line check.** whisper.cpp on request (download in Settings, CPU only, capped runner), word times and alignment to the script, transcription for footage with no script, Line check codes in **Check your film**; OpenAI as an opt-in with its notice | ~800 | PLANNED |
| K8 | **Ask bar (after P4).** Ctrl+K bar (06 §3.7), scope chip, suggestions from `inspect_cut`, `propose_cut_ops` as shared `ops/` with the edit lock per clip and one undo per turn, turn strip, **Cut to the music** (`beat-fit.js`). Never renders, never exports | ~1,200 | PLANNED |
| K9 | **By request:** speed curves, chroma key, masks, HSL and wheels, adjustment layer, noise reduction, compound clips, bilingual captions, transcript cut, webm / mov / gif, `cut.edl`, AI cutout via a trusted ComfyUI workflow (the effects set moved to 07-fx) | — | PLANNED |

**Exit criteria** (each phase also adds its controls to `katana-controls.js` and flips `SHIPPED`):
- **K1:** Open in Katana on a 7-beat cut opens `/katana/:id` with V1, A1, A2 and one chapter per beat; save →
  reload keeps every field (round-trip test); a blank project imports 3 files into the media folder; the layout
  matches 06 §3 at 1600 × 960 and collapses at 64rem and 40rem; hovering a bin tile scrubs it.
- **K2:** with the magnet on, no op can leave a gap on V1 (property test over random ops); moving a V1 clip moves
  its linked title and sound; every op undoes to the identical timeline; a drag is one undo step; Ctrl+B, Q / W, P,
  N, ` and Delete behave as 06 §4; Ctrl+R, Ctrl+− and Ctrl+W no longer reach Electron's menu (06 §4.4); a save asked during a save runs after it; closing the window flushes it; a 409
  never discards local edits.
- **K2b:** a generated 2 h, 1,800-clip project opens in ≤ 2 s and scrolls, zooms and plays at 60 fps with no long
  task over 50 ms; no more than ~80 clip nodes and ≤ 1,500 elements exist; beat ticks and markers are canvas; tiles load only for the visible range; dragging a spine plate
  moves the whole chapter in one undo step; Restore of a version saves the current state first; Re-take opens the
  card and **Swap** keeps the in-point and length (or refuses "Short by 0.6 s").
- **K3:** FX0 met its exit (07-fx §9); a paused frame shows the same source frame the export uses (frame-number
  fixtures at 16–60 fps, 07-fx §10); playback stays within 1 frame of the clock over 10 min; a reversed clip previews from its reversed proxy; the golden-frame test passes on title,
  transform and overlay frames; an HEVC import builds a proxy, plays it, and the export reads the original;
  preview axis shows the hovered frame without moving the playhead.
- **K4:** the preview gain equals the export's `volume` expression at 20 sample points; ducking follows measured
  lines; the LUFS readout matches a measured `ebur128` within 0.5 LU; beat ticks say "estimated" and snap works.
- **K5:** a 2 h fixture plans ~120 segments, each call has `-t` and `-fs`; killing the export at segment 37 and
  pressing **Resume** re-renders from 37 only (nothing resumes without the press); a 2 h blank project with no
  chapters mixes in ≤ 5 min windows; segment frame counts (`clock.js` frame bounds) sum to the film's frames
  exactly and the file length equals the clock total ± 34 ms; the sheet shows a measured "estimated" time; it refuses
  plainly below 3 × the estimate free; `.srt` and `-chapters.txt` land beside the mp4.
- **K6:** every shipped transition and effect passes the licence gate, the GLSL lint, the 4K cost test and the
  12-frame golden parity test (07-fx §10); the LUT test matches 10 colours on decoded frames;
  speed, freeze and reverse match the clock; the licence grep finds no GPL filter.
- **K6b:** **Caption all lines** on a voiced board gives exact words and speaker names with no key and no model;
  **Delete line** removes the span from picture and sound in one undo step.
- **K7:** no download happens without the person's press; whisper runs below-normal on the tools queue and never
  during an export; a changed word shows `LINE_CHANGED` with **Show me**.
- **K8:** Ctrl+K opens, Esc closes, a turn is one undo; locked clips are untouched; no tool queues a render or an
  export (test); the scope chip limits what is sent.

K1–K8 ≈ 16,300 lines (was K1–K6 ≈ 9,900 + K8 800). The extra ~5,600 buy the CapCut model (magnet, linkage,
keys), the 2 h scale (virtual lanes, proxies, resume, windowed mix) and the story features (spine, script
captions, line check, Re-take, versions, one-LUT look). Still about a third of bloop's ≈ 45,000. Katana FX
(07-fx §9) adds ~6,650 net lines on top (~8,900 minus ~2,250 of K3/K5/K6 picture work it replaces), plus ~4,000
lines of shader and JSON content, for ≈ 23,000 in Full Katana.
05's guide tags ([K1]–[K6], 05 §4.2) follow this table: [K3] preview, [K4] sound, [K5] export, [K6] look; new
lines for K2b, K6b, K7 and K8 are added to the registry when those ship.

## 8. Tests (`node --test`, temp SQLite, fake services)

- Schema round trip: every field survives.
- Each op is pure: the input timeline is unchanged.
- `segments.js` cuts at every boundary and junction.
- The envelope matches tabled bloop values.
- A stale save returns 409; the save after adopting the revision succeeds.
- Pressing the hand-off twice opens the same project.
- The export uses a fake ffmpeg that records args: every call has `-t` and `-fs`, never `-stream_loop`, `aloop`
  or an open `apad`.
- A failed stage still cleans its temp files.
- Magnet: random op sequences never leave a gap on V1. Linkage: ripple and move carry followers.
- Split divides transitions, animations, markers and volume points by rule (06 §4.3).
- History: every op's inverse restores the identical timeline.
- Autosave: a queued save runs after the in-flight one; a 409 merges by replay or asks, never reloads silently.
- Virtual lanes: the visible-range maths on a 1,800-clip fixture.
- Resume: a killed export reuses every segment whose hash matches and re-renders the rest.
- `grade.js` LUT on 10 colours; the golden-frame parity test and the FX tests in 07-fx §10.
- `capped-whisper.js` with a fake spawn: timeout, stdout cap, below-normal priority, never during an export.

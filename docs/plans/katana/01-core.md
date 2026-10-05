# Katana 01 — Mini Katana core: storage, routes, reader, clock, export, Pack — PLANNED

Part of [../katana.md](../katana.md). Settled conflicts there win over this file.
Source ported: bloop `docs/plans/spaces-mini-timeline.md` (owner decisions A ×5), `01-timeline.md` §4–§6,
`02-board-agent-branches.md` §2–§3, `04-qa.md` §5. bloop never built it. We port the plan, not code.

## 1. Verbatim vs adapted

| bloop rule | Here | Why |
|---|---|---|
| One cut per Space, `items` JSON, pinned `node_id` + snapshot, `previous_items`, `revision` + 409 with the server copy | **Verbatim** | Same lost-work risks (02 G6, G7; the full editor's silent 409 loop). |
| Caps: 50 items, 600 s, 1080p, dissolve 250–1000 ms (default 500, at most half the shorter neighbour) | **Verbatim** | Owner decision 3 in bloop. Same numbers keep preview, export and the Director honest. |
| Missing beats skipped and named before export; result = new video card | **Verbatim** (decisions 1, 2) | "Asset library" becomes the media folder. |
| CappedFfmpeg guards, step list, one export at a time, tries 1, temp sweep | **Verbatim**, adapted to Windows | `nice -n 10` becomes below-normal priority; Horizon becomes an in-process queue. |
| Durable URL rule (G2, G3), vendor URLs, `NOT_DURABLE` | **Dropped** | Every take is a file in the media folder (`MediaStore.saveTake`, also for cloud renders in `cloud-stages.js`). New check: `MISSING_FILE`. |
| `url` in items | **Adapted**: `media_path` + `take_id` | Studio has a `takes` table (`001_spaces.sql`), so we pin the exact take. |
| Measured duration from `PrepareTimelineMediaJob` | **Adapted**: `takes.duration_ms` by ffprobe when a take lands | No media library here. |
| Export progress by a 3 s HTMX poll | **Adapted**: SSE on the board stream | `BoardEvents` + `GET /spaces/:id/events` exist. |
| `space_exports` with cut columns | **Adapted**: own `cut_exports` table | Studio has no exports table; one table serves Export and Pack (`kind`). |

## 2. Storage: `src/server/db/migrations/006_cuts.sql` (P1)

```sql
CREATE TABLE space_cuts (
    id             INTEGER PRIMARY KEY,
    space_id       INTEGER NOT NULL UNIQUE REFERENCES spaces(id) ON DELETE CASCADE,
    items          TEXT    NOT NULL DEFAULT '[]', -- array order = cut order
    sound          TEXT,   -- {music:{node_id,take_id,media_path,gain_db,fade_out_ms,duck?}, voice:{...,start_ms}}
    settings       TEXT    NOT NULL DEFAULT '{"resolution":1080,"fps":30}', -- + aspect from the plan
    previous_items TEXT,   -- one-step "Undo draft"
    revision       INTEGER NOT NULL DEFAULT 0,
    updated_by     TEXT    NOT NULL DEFAULT 'person' CHECK (updated_by IN ('person', 'director')),
    updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE cut_exports (
    id                  INTEGER PRIMARY KEY,
    space_id            INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    kind                TEXT    NOT NULL CHECK (kind IN ('export', 'pack')),
    cut_revision        INTEGER,
    status              TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
    progress            REAL    NOT NULL DEFAULT 0,
    step                TEXT,
    error               TEXT,
    error_beat          TEXT,     -- the beat tag a failed export stopped at (for "Remove it and export again")
    media_path          TEXT,     -- the finished mp4 or zip, relative to the media folder
    bytes               INTEGER,
    node_id             INTEGER REFERENCES space_nodes(id) ON DELETE SET NULL, -- result card
    cancel_requested_at TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at         TEXT
) STRICT;
CREATE INDEX cut_exports_space ON cut_exports(space_id, id);
ALTER TABLE takes ADD COLUMN duration_ms INTEGER; -- measured, never the asked length
```

Full Katana (K1, `008_katana.sql`) adds `space_cuts.katana_project_id`.

**Item shape** (validated in `src/shared/cut-rules.js`, used by `CutEdits`, the dock and the Director):
`{id, node_id, take_id|null, beat_tag, media_path, seconds_ms, in_ms, out_ms, sound: bool,
join: {type: 'cut'|'dissolve', ms, audio_ms?}, placed_by: 'person'|'director', person_rev, note?}`.
- `media_path` + `seconds_ms` are the snapshot for a deleted card.
- `note` is at most 40 chars (the Director's clip note, sensor blue). A person's edit clears it.
- `join.audio_ms` is the J/L offset (P4): < 0 J cut, > 0 L cut, `|audio_ms| ≤ 1500`.
- `sound.music.duck = {depth_db, attack_ms: 120, release_ms: 400}` (P4). Windows are derived, not stored.
- Rules: `0 ≤ in < out ≤ seconds_ms + 50`; at most 50 items; total ≤ 600 000 ms; the node belongs to the space and
  is a `video` card or an `upload` with `video/*`.
- J/L needs source sound to borrow (critic pass): a J cut of `|audio_ms|` needs `next.in_ms ≥ |audio_ms|`; an L cut
  needs `seconds_ms − out_ms ≥ audio_ms`. Both clips must have sound on. In v1 J/L sits only on a `cut` join, never
  on a dissolve: a dissolve already crossfades the sound, and two overlaps on one junction is where preview and
  export would drift. `cut-rules.js` refuses the rest with a plain reason.

**Repository** `src/server/repositories/cuts.js`. The save is one statement:
`UPDATE space_cuts SET items=?, sound=?, settings=?, revision=revision+1 … WHERE space_id=? AND revision=?`.
0 rows changed = 409. Canvas saves never touch this table (bloop 02 §3).

**Write path** `src/server/cut/cut-edits.js` (`CutEdits`): validate with `cut-rules.js`, stamp `placed_by` and
`person_rev`, save, emit the `cut` SSE event. The `PUT` route, `CutDraft` and `propose_cut_ops` all call it.

## 3. Routes: `src/server/routes/cut.js` (mounted at `/`, CSRF on every mutation)

| Verb | Path | Does |
|---|---|---|
| GET | `/spaces/:id/cut` | `{cut, slots, total_ms, gaps_ms, ducks, beats_ms, findings}` for the dock (slots from BoardCut) |
| PUT | `/spaces/:id/cut` | Save with `revision`. Stale: **409** `{error, cut: serverCopy}`. The client adopts the new revision in the same step. |
| POST | `/spaces/:id/cut/draft` | `{mode: fill \| replace \| add_new}` via `CutDraft` (the service `stitch_cut` calls) |
| POST | `/spaces/:id/cut/undo-turn` | `{turn, revision}`: undo one Director turn (P4, see 03-director.md) |
| GET | `/spaces/:id/cut/export` | HTMX modal (`hx-target="#modal"`): preflight readout, Export key |
| POST | `/spaces/:id/cut/exports` | 202 `{id}`. Idempotent: same revision done or running returns that row. |
| GET | `/spaces/:id/cut/exports/:exportId` | Status partial (reload-safe; live updates come over SSE) |
| DELETE | `/spaces/:id/cut/exports/:exportId` | Cancel: sets `cancel_requested_at`, aborts the running child |
| POST | `/spaces/:id/cut/packs` | 202 `{id}`: Pack assets job (§8) |
| POST | `/spaces/:id/cut/katana` | Hand-off to Full Katana (K1, see 04-full.md) |
| PUT | `/spaces/:id/takes/:takeId/duration` | Browser fallback: writes only `duration_ms` (bloop G4: never the whole settings blob) |

**SSE.** `BoardEvents` (`src/server/generation/events.js`) gets two events:
- `cut` `{spaceId, revision, by, added, missing[], changed[], turn, offer}`; `offer: 'replace'` is bloop's
  `offer_cut_replace`.
- `cut_export` `{spaceId, exportId, kind, status, progress, step, error, nodeId, bytes}`.
The events route adds both listeners with the same `spaceId` filter and `onAbort` cleanup as `node`. Progress is
throttled to 4 frames a second.

## 4. The one reader: `src/server/cut/board-cut.js` (port of bloop `BoardCut`)

Read-only. No probe, no job, no write. The dock, `CutDraft`, the export preflight and the Director call it.
1. Plan: latest `director_plans` row; beats from `director_plan_beats` ordered by `lane`, then `id` (`005_director_plans.sql`).
2. Clip per beat: the newest `video` card whose label equals the beat `tag` (`build/lane.js`), preferring ids in
   the beat's `node_ids` so a renamed label still matches. A video card wired downstream (lip-sync) wins, as
   bloop's wired lipsync rule. Check against `tests/lip-sync-audio.test.js`.
3. Take: the card's newest `takes` row. An item pins `take_id`; a newer take shows **Use new take** (the person's press).
4. Length: `takes.duration_ms` (measured), else `settings.duration` × 1000 marked `UNMEASURED`.
5. No plan: order by `position_y`, then `position_x`, finding `ORDER_GUESSED`.
   **Never a cut of the cut:** cards whose newest take has `preset 'cut'` (our own exports, `Cut · r12`) and
   Full Katana exports are never clips, in either mode. Without this, the next `add_new` on a hand-built board
   would put last week's export into this week's cut.
6. Bed: the `audio` card labelled `music bed` or `song` (`plan/stages.js` `bed()`), newest done take.
7. Findings (never refusals): `GAP`, `STALE`, `TAKES`, `UNMEASURED`, `ORDER_GUESSED`, `MIXED_ASPECT`,
   `RUNTIME_OFF` (±15 % of `runtime_seconds`), `MISSING_FILE` (new, local).

**Measuring.** A stage `MeasureTake` (`src/server/generation/measure-take.js`) runs after the save in
`GENERATION_STAGES` and `CLOUD_STAGES`. It runs ffprobe through the capped runner (20 s timeout) and writes
`takes.duration_ms`. If ffprobe is missing or fails it logs and moves on; the browser fallback fills it.

## 5. Shared timing: `src/shared/cut-clock.js` (P0, built)

Pure functions, no DOM, no Node APIs. Served at `/shared/cut-clock.js` and imported by the export.
Built on the P0 branch: `DISSOLVE_DEFAULT_MS`, `DISSOLVE_MIN_MS`, `DISSOLVE_MAX_MS`, `dissolveMs()`, `cutClock()`,
`itemAt()`. Item length = `out_ms − in_ms`; a dissolve is clamped to 250–1000 ms and at most half the shorter
neighbour; total = Σ lengths − Σ overlaps. P2 adds `bedWindow(sound, total)` (plays once, never loops) and
`fadeStart(total, bedLen) = min(total, bedLen) − 1500`. P4 adds `src/shared/cut-sound.js` (duck windows from
settings + speech spans, beat snaps). `tests/cut-clock.test.js` pins fixture numbers.

Rules that keep preview and export on the same numbers (critic pass):
- **Two time maps, one function.** `cutClock(items, {gaps})` returns export time (gaps skipped) and, with
  `gaps: [{after, ms}]`, board time (each gap as a slate of its planned length). Beds, ducks, beat ticks and
  fades are always placed in **export time**. In board time a slate holds the bed clock still (the bed pauses).
  `toExport(boardMs)` and `toBoard(exportMs)` convert. A fixture pins both maps.
- **Ducks are an envelope, not steps.** `cut-sound.js` `duckGain(t)` is piecewise linear (attack 120 ms, hold,
  release 400 ms). The preview samples it every 50 ms; the export turns the same breakpoints into one `volume`
  expression (`volume='<piecewise>':eval=frame`) built by `cut-sound.js` `duckExpr()`. Not
  `enable='between(…)'`, which jumps where the preview ramps.
- **Loudness is two-pass and linear.** The export uses the measured `ebur128` numbers from the analysis cache in
  `loudnorm=I=<t>:TP=-1.5:LRA=11:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:linear=true`, then
  `aresample=48000` (loudnorm resamples to 192 kHz). Linear mode is one gain, so the preview applies the same
  `gainDb = target − measured` to the master and sounds the same. Critic: when `measured_TP + gain` passes the
  TP ceiling, `loudnorm` silently switches to dynamic mode and the preview no longer matches; cap the gain first
  (or apply it as `volume=<gain>dB`, as Full Katana does, 04-full.md §5) and say the lower target on the sheet. No measurement: no loudnorm, and the export
  sheet says "Loudness not set: the mix was not measured".

## 6. Export pipeline: `src/server/cut/export/` (P3, `handle(ctx, next)` stages via `runPipeline`)

**Queue** `src/server/media/tools-queue.js`: in-process, concurrency 1, **separate from the GPU worker**
(`generation/worker.js`), so an export never waits on a render and never blocks one. Exports and packs run ahead of
analysis jobs. On app start, rows left `running`/`queued` become `failed` with "The app closed during the export.
Nothing was saved." (tries 1), and `<media>/.cut-tmp/` is swept.
**Temp dir** `<media folder>/.cut-tmp/{exportId}/` (same volume, so the final move is a rename). Deleted in `finally`.

| Stage | Work | Guards |
|---|---|---|
| `CheckCut` | Load the saved revision, run BoardCut + cut-clock. Refuse: no playable items, > 50 items, > 600 s, a missing file, free disk (`statfsSync`) < 3 × estimate, no ffmpeg, the chosen encoder missing (from the cached `-encoders` check, §9). List skipped beats. The job holds this revision's items in `ctx`; later edits never change a running export. | Plain refusal, 0 processes |
| `ProbeSources` | ffprobe each source; clamp trims to the real length; note "has audio" | 20 s timeout per file |
| `NormalizeClips` | One item at a time. Writes `head`/`body`/`tail` parts when a dissolve touches the item. | `-t`, `-fs`, timeout max(60 s, 4 × len) |
| `JoinClips` | `xfade` + `acrossfade` only on each short junction, then concat demuxer `-c copy` | `-t` = junction or total |
| `MixSound` | Music and voice under the clip sound, duck windows, J/L offsets. Skipped with no bed. | `-t total`; no `aloop`, `-stream_loop`, open `apad` |
| `StoreResult` | Rename into `spaces/{id}/cuts/{stamp}-cut-r{rev}.mp4` (new `MediaStore.saveCut`). New `video` card right of the right-most card on the first lane, label `Cut · r{rev}`, plus a `takes` row (`preset 'cut'`). Emit `node` + `cut_export done`. | — |

**The runner** `src/server/media/capped-ffmpeg.js` (P0, built) is the only file that spawns ffmpeg/ffprobe. It
refuses, starting nothing, when there is no output `-t` after the last `-i`; `-t` ≤ 0, NaN or over the caller's cap;
any `aloop` or `-stream_loop`; `apad` without `whole_dur`/`pad_dur`; an `-f lavfi` source with no output `-t`. P3 adds:
the output path must sit under the job's temp dir. It always adds `-nostdin -hide_banner -loglevel error
-progress pipe:1 -threads 2` and `-fs` (`capForSeconds`: 2 × seconds × 1 MB/s per step, `FINAL_CAP_BYTES` 1.5 GB).
It spawns with `windowsHide: true`, no shell, then below-normal priority. Timeout or abort kills the child. stderr
goes to the log only, never to the page. `spawn` is injected so tests use a fake. `locateFfmpeg()` looks in
Settings, then `BLOOP_FFMPEG`, then `resources/ffmpeg`, then `PATH`.

**Exact commands.** `W×H` from settings and the plan aspect (16:9 1920×1080, 9:16 1080×1920, 1:1 1080×1080; 720
variants). `VENC` = `-c:v h264_mf -b:v 8M -g 60` (LGPL path, owner decision 1). No `libx264` fallback: it is GPL and not in
the build; a PC without `h264_mf` gets a plain refusal that names the Media Feature Pack.

```text
# ProbeSources
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate -of json <src>

# NormalizeClips, item with its own sound (part = head | body | tail)
ffmpeg <guards> -ss <in+off> -i <src> -map 0:v:0 -map 0:a:0
  -vf "scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p"
  -af "aresample=48000,aformat=channel_layouts=stereo" VENC -c:a aac -b:a 192k -ar 48000 -ac 2
  -t <len> -fs <cap> -y .cut-tmp/<id>/03-body.mp4

# NormalizeClips, sound off or no audio stream (silence is capped twice)
ffmpeg <guards> -ss <in+off> -i <src> -f lavfi -t <len> -i anullsrc=r=48000:cl=stereo -map 0:v:0 -map 1:a:0
  -vf "<same>" VENC -c:a aac -b:a 192k -ar 48000 -ac 2 -t <len> -fs <cap> -y .cut-tmp/<id>/03-body.mp4

# JoinClips, one dissolve junction of d seconds
ffmpeg <guards> -i 02-tail.mp4 -i 03-head.mp4
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=<d>:offset=0,format=yuv420p[v];[0:a][1:a]acrossfade=d=<d>[a]"
  -map "[v]" -map "[a]" VENC -c:a aac -b:a 192k -ar 48000 -t <d> -fs <cap> -y .cut-tmp/<id>/02-03-join.mp4

# JoinClips, concat (list.txt: 01-body, 01-02-join, 02-body, … ; file paths only)
ffmpeg <guards> -f concat -safe 0 -i list.txt -c copy -t <total> -fs <cap> -movflags +faststart -y .cut-tmp/<id>/joined.mp4

# MixSound (voice input only when a voice is set)
ffmpeg <guards> -i joined.mp4 -i <music> -i <voice> -filter_complex
  "[1:a]atrim=0:<musicLen>,asetpts=PTS-STARTPTS,volume=<gain>dB,afade=t=out:st=<fadeStart>:d=1.5[m];
   [2:a]atrim=0:<voiceLen>,asetpts=PTS-STARTPTS,adelay=<startMs>:all=1,volume=<vgain>dB[vo];
   [0:a][m][vo]amix=inputs=3:duration=first:dropout_transition=0:normalize=0[a]"
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -ar 48000 -t <total> -fs 1500M -movflags +faststart -y .cut-tmp/<id>/final.mp4
```

- Timing: body = len − dissolve in − dissolve out, so Σ parts = the clock total. `amix duration=first` ends the bed
  with the cut; a short bed plays once and stops.
- Ducks (P4) become one `volume='<duckExpr>':eval=frame` in `[m]` (§5). J/L offsets (P4) shift the clip audio in
  the junction parts, borrowing source sound outside the trim (§2 rules). Loudness (P4) adds the linear two-pass
  `loudnorm` + `aresample=48000` (§5). None adds a loop or pad.
- **Analysis calls** (03-director.md §5) write no file: `-f null NUL`. The runner accepts the null muxer as the
  output instead of a temp-dir path, still needs output `-t` (the clip length, or the bed length capped at 600 s),
  and still sets a timeout of max(30 s, 2 × length). The PCM decode for onsets writes to `pipe:1` with `-t` and a
  byte cap enforced by the reader (11 025 × 2 × length + 1 MB), then kills the child.
- **Info calls** (`ffprobe …`, `ffmpeg -hide_banner -encoders`, `-version`) have no output, so the `-t` rule does not
  apply. The runner has an explicit `info()` entry for them: no `-i` to a lavfi source allowed, 10 s timeout
  (20 s for ffprobe), stdout capped at 1 MB. Every other call goes through `run()` with all guards.
- **End states** (bloop 01 §4, ported): done; failed at one clip ("The export stopped at 04 · Flashback. That clip
  could not be read.", `error_beat` in the row so the sheet offers **Remove it and export again** / Go to card /
  Try again); failed on limits (Close, edit the cut); timed out ("took too long and was stopped. Nothing was
  saved."); stale (the done row's `cut_revision` < the cut's revision: "This export is from an older version of
  the cut", **Export again**). The space deleted mid-export: the job sees the row gone, kills the child, sweeps.
- **Export flushes first.** The Export key flushes the dock's pending save and waits for it. If the save fails,
  the sheet says "The latest changes are not saved yet" and offers Retry; it never exports an older revision
  without saying which.
- Timeouts: junction 60 s, concat max(60 s, total / 2), mix max(120 s, total).
- Progress: `out_time_us` from `-progress pipe:1`, weighted by each step's seconds, as "Joining clip 4 of 8".
- **P0 spike:** 8 real local clips (mixed sound, 9:16 + 16:9). Log every command; record time, peak memory, AAC
  drift at the concat seams, size. Bar: total ± 34 ms, one H.264 yuv420p 30 fps stream, one AAC 48 kHz stereo stream.

## 7. Range / 206 on `/media/*` (P0, built)

Before P0, `GET /media/*` in `src/server/routes/generation.js` read the whole file into memory and answered 200.
The preview seeks with `currentTime = in`, which Chromium cannot do without ranges. P0 adds
`src/server/media/byte-range.js` (`parseByteRange`) and streams with `createReadStream(full, {start, end})`:
`accept-ranges: bytes`, `206` + `content-range` for one range, `416` + `content-range: bytes */size` out of bounds,
a full 200 stream without a Range header. `?download=` keeps working. No multi-range (Chromium never asks).
Test: `tests/media-range.test.js` (first bytes, `bytes=100-`, `bytes=-500`, 416, path escape still 404).

## 8. Pack assets: `src/server/cut/pack/` (P3, a `kind: 'pack'` job on the tools queue)

No ffmpeg, no GPU. A job, not `GET /cut/assets.zip`, because a multi-GB response gives no progress, no cancel and a
second copy in Downloads. It writes once into the media folder and offers **Show in folder** (`POST /media/reveal`).
The Director's `pack_assets` tool queues this same job (03-director.md §7).
- One pack per space at a time; pressing again (or `pack_assets`) while one runs returns that row.
- Output: `spaces/{id}/packs/{space-name}-{stamp}.zip`, the name made safe for Windows (no `<>:"/\|?*`, no
  reserved names like `CON`, no trailing dot or space, ≤ 80 chars). Paths inside the zip get the same rule. Store-only (video does not compress), ZIP64 for files over
  4 GB. Writer `src/server/cut/pack/zip-writer.js` streams each file, CRC via `zlib.crc32` (Node 22.2+, in
  Electron's Node). No new dependency, so `THIRD-PARTY-NOTICES` does not change for Pack.
- Layout: `beats/<lane>-<tag>/<card>-take<id>-seed<seed>.<ext>`, `stills/`, `sound/`, `cut/` (latest done export),
  `notes/` (the beat's words cards as `.md`), `manifest.json`.
- Manifest: app version, space, plan (approach, aspect, runtime), per beat: tag, lane, brief, cards; per take:
  file, model (`takes.preset`, `params.model`), seed, the prompt sent (`params.prompt`, saved by `stages.js` and
  `cloud-stages.js`), sizes and knobs, `duration_ms`, created_at, and whether it is in the cut with its in/out.
  Then the cut itself (items, joins, sound, revision). Keys matching `key|token|secret|authorization` are dropped.
- Caps: free disk ≥ 1.1 × the bytes to copy; progress by bytes; cancel between files and between chunks.

## 9. ffmpeg on the PC (P3; owner Q1)

Facts: `package.json` `build.files` takes `src/**`, `public/**`, `workflows/**`; no `extraResources` yet;
`extraFiles` ships `build/THIRD-PARTY-NOTICES.txt`. `scripts/third-party-notices.mjs` only lists npm packages.
The engine installer already downloads with resume and a sha256 check (`engine-install/download.js`).
Recommended plan:
- `scripts/fetch-ffmpeg.mjs`: a pinned LGPL win64 build URL + sha256 into `vendor/ffmpeg/` (git-ignored), with
  `ffmpeg.exe`, `ffprobe.exe`, `LICENSE` and a `manifest.json` (version, license, source tag URL, configure line).
  `npm run vendor` calls it and skips when the hash matches.
- `package.json` `build.extraResources: [{ "from": "vendor/ffmpeg", "to": "ffmpeg" }]`, outside the asar, which
  matches `locateFfmpeg()`'s `resources/ffmpeg` lookup.
- Missing: Export and analysis say "The video tools are missing. Reinstall Bloop Studio." Preview still works.
- **Settings › Video tools** (new row in `src/server/routes/settings.js` + its view; `locateFfmpeg()` already reads
  a Settings path): shows the found ffmpeg, its version and licence line, and the encoder in use. Ways forward:
  **Check again** and **Choose ffmpeg.exe…** (a file picker; the path must hold both `ffmpeg.exe` and
  `ffprobe.exe`, and the `-version` info call must succeed). This is where every "video tools are missing"
  message links. It is the way forward for a cloud-only person whose install lost the folder (antivirus
  quarantine is the usual cause), and for a Windows N edition without `h264_mf` (the row says "Install the Media
  Feature Pack from Windows Settings", owner Q1 fallback).
- **Encoder check:** on start (and on Check again) one `info()` call `-encoders` is cached; `CheckCut` reads it.
- **Cloud-only people** (no ComfyUI) get the same bundled ffmpeg: it ships in the installer, not with the engine.
  Nothing in Mini Katana needs ComfyUI. A test pins that `locateFfmpeg()` never looks inside the engine folder.
- **LGPL hygiene:** `fetch-ffmpeg.mjs` refuses a build whose configure line has `--enable-gpl` or
  `--enable-nonfree` (so no `libx264`, no `libfdk_aac` by accident); the notice and an "Open source and
  licences" link in Settings › Video tools point at the exact source tag; the exes stay unmodified, separate
  files the person can replace (the Choose key). Patent questions for H.264/AAC are an owner item (Q4).
- Notices: `third-party-notices.mjs` gets `nativeComponents()` reading `vendor/ffmpeg/manifest.json` + `LICENSE`,
  listed as "FFmpeg <version> – LGPL-2.1-or-later, source: <tag URL>, run as a separate program".
  `tests/build-installer.test.js` asserts the block is present.
- Size: measure both exes in P0 and note the installer growth in ../katana.md.

## 10. Files (each under 500 lines) and tests

Server: `routes/cut.js`, `repositories/cuts.js`, `cut/board-cut.js`, `cut/cut-edits.js`, `cut/cut-draft.js`,
`cut/preflight.js`, `cut/export/{check-cut,probe-sources,normalize-clips,join-clips,mix-sound,store-result,index}.js`,
`cut/pack/{collect,manifest,zip-writer,index}.js`, `generation/measure-take.js`, `media/tools-queue.js`,
`media/capped-ffmpeg.js` and `media/byte-range.js` (P0). Shared: `src/shared/cut-clock.js`, `src/shared/cut-rules.js`.

Tests (`node --test`, temp SQLite, fake spawn, never the GPU), run one file at a time:
- `cut-clock`, `cut-rules`
- `cuts-repository`: 409, then the save with the new revision succeeds
- `board-cut`: plan order, renamed label, lip-sync wins, newest take, no plan, measured vs asked length, deleted
  card, missing file
- `cut-draft`: fill only an empty cut, add_new never moves/trims/removes, one-step undo
- `capped-ffmpeg`: bloop 04 §5 cases 1–10; case 11 real run skipped when `vendor/ffmpeg` is missing; `info()`
  refuses a lavfi input and caps stdout; the null muxer still needs `-t`
- `board-cut`: an exported `Cut · r12` card is never a clip (plan and no-plan modes)
- `cut-clock`: board time ↔ export time round trip; `duckExpr()` and `duckGain()` agree at 50 ms samples
- `cut-uses-capped-ffmpeg`: no `spawn`/`execFile`/`ffmpeg` under `src/server/` outside `media/capped-ffmpeg.js`
- `cut-export`: fake ffmpeg writes files + progress lines; done, cancel kills the child, broken clip, limits refuse
  with 0 spawns, temp dir gone, restart marks failed, file length = clock total ± 34 ms (real run only)
- `media-range`
- `cut-pack`: layout, manifest has prompts/seeds/models and no keys, ZIP readable by Windows `tar.exe -tf`

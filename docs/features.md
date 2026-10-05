# Bloop Studio — features

What the app does today. Update this file with every feature or fix (see CLAUDE.md).

## Spaces (the board)

- **Spaces list**: create, rename and delete boards; the app opens on this list.
- **Cards**: Upload, Text, Note, Image and Video. Drag to move, drag the board to pan, zoom, undo/redo, Tidy layout.
- **Wires and sockets** (one source of truth in `src/shared/node-types.js`):
  - Image card: **Words** (any number of text cards) and **Picture** (one reference image).
  - Video card: **Words**, **First frame** and **Last frame** (one picture each).
  - Words are folded in order: the shot text first, then `Cast · …` cards, then `Location · …` cards.
- **Upload cards** take a PNG, JPEG or WebP picture or an MP4 or WebM clip (up to 500 MB) to wire onward:
  drop a file on the card, or click it to choose one.
- **Media**: full-screen viewer, download under the card's name, and *Show in folder* (File Explorer).

- **Players** (2026-10-05, ported from bloop's media deck and audio player): clips play in the hangar deck
  (centre key, scrubber, time, volume level shared by every player and remembered, fullscreen = the viewer;
  keys ← → seek, ↑ ↓ volume, space, m, f), on cards, uploads and in the viewer. Sound plays in the audio
  instrument: play key, a waveform that is the seek bar (decoded once from the local file), time, a VOICE sensor,
  a level gauge and the share of the track with speech. Cards take the real shape of their clip or picture once it
  loads (an older take, a cloud model or an upload can differ from the Aspect knob), as bloop's noteClipShape. No browser control bars left. `public/js/components/
  media-player.js`, `audio-player.js`, `public/css/player.css`.

- **Mini Katana: the Cut** (2026-10-05, branch `katana-mini`, plan `docs/plans/katana.md`): a dock along the bottom
  of the board. It folds to a rail ("3 of 4 beats · 0:09") and opens to a preview on the left and Video, Voice and
  Music tracks with an orange playhead. One reader (`src/server/cut/board-cut.js`) puts each beat's newest clip in
  plan order (board order without a plan); beats with no video show as hatched slots with **Go to card**. Takes
  are measured with ffprobe when ffmpeg is present. Editing: **Fill the cut**, reorder (drag, Alt+arrows, Move
  left/right), trim (handles, `[` `]`, Shift+arrows), remove with an 8 s Undo, cut or dissolve joins (D), clip
  sound (M), newer take swap, music and voice levels, 50-step undo in the dock. Autosave with a local draft and
  "changed in another window" recovery (409). The preview plays the cut on two stacked players with dissolves,
  gap slates, music and voice in sync, and an "As exported" toggle. Nothing in the dock renders.
  **Export (P3)**: the accent key on the rail opens a sheet above it: length, picture, size, the beats skipped by
  name, **Check your cut** with **Show me**, the **Preset** (Master, YouTube; `src/shared/export-presets.js`) and
  "Export runs on this PC. Free." Export saves pending edits first ("The latest changes are not saved yet" /
  Retry otherwise), then shows the step ("Joining clip 4 of 6") on a sensor-blue level with **Cancel**, live from
  the board's one event stream (`cut_export`, no polling). End states: done (**Show in folder**, **Copy path**,
  **Download**, **Show on board**), stale (**Export again**), stopped at a clip (**Remove it and export again**,
  Go to card, **Try again**), cancelled or failed (**Try again**), video tools missing (link to Settings ›
  Video tools). **Pack assets** has its own sheet (**Include prompts and seeds**), a small level and **Show in
  folder**. **Set as poster** in a clip's details. `public/js/components/cut-export.js`,
  `src/server/views/pages/spaces/cut/export-sheet.edge`, `pack-sheet.edge`, `public/css/cut-export.css`.
  **Settings › Video tools** (`partials/video-tools.edge`): the ffmpeg in use, version, licence, encoders,
  **Check again**, **Choose ffmpeg.exe…**.
  The export runs on this PC with the LGPL ffmpeg that ships with the app (`resources/ffmpeg`, `vendor/ffmpeg` in
  dev; never a GPL build or filter): a media-tools queue separate from the GPU worker (`media/tools-queue.js`), the
  stages in `src/server/cut/export/` (check, probe, normalize, join with dissolves, music + voice with ducking,
  loudness to the preset capped at −1.5 dBTP, one AAC encode with `aac_mf`, H.264 with `h264_mf`), a story-named file
  (`night-market-youtube-r12.mp4`) with a poster beside it and a new `Cut · r{rev} · {Preset}` card. Cancel, a
  deleted space or a closed app leave no temp files. Pack writes `spaces/{id}/packs/*.zip` with manifest v1, no keys,
  ZIP64 when needed (`src/server/cut/pack/`). Routes in `routes/cut-exports.js` and `routes/video-tools.js`.
  Media is served with byte ranges, so long clips seek without loading the whole file.
  **First run (P2b, 05-irresistible.md §2)**: the **live cut** (`src/server/cut/live-cut.js`): on a planned board,
  while `space_cuts.auto` = 1, every clip that lands (worker `node` done, then its ffprobe length) goes into its
  beat slot through `CutDraft` as `placed_by: 'auto'` ("Placed in beat order"), and a music bed that lands goes
  under it; the person's first save turns it off for good ("You edited the cut. New clips now wait for you."), and
  later clips light **Add new clips**. The dock adopts auto placements silently and rebases an unsaved edit over
  them (`src/shared/cut-rebase.js`), never a "changed in another window" banner. **Render missing beats** on the
  rail and the board's render readout opens a sheet (`GET/POST/DELETE /spaces/:id/render-plan`, pipeline in
  `src/server/generation/render-plan/`): the owed cards in wire order (pictures, clips, the bed), each with its
  model, a time only from past renders, on bloop the credits and the balance first, refused plainly when short;
  a beat whose picture failed is skipped with a reason; **Cancel all**. Queued through the per-card path
  (`generation/enqueue.js`); no Director tool can reach it. **Start from a starter** (`src/shared/starters/*.json`,
  `src/server/spaces/apply-starter.js`, `routes/starters.js`, an HTMX modal): Night drive, Product turn, Postcard
  from the sea, laid out as a normal finished plan. **Bring my clips** (`public/js/components/cut-bring.js`): Upload
  cards in one row in drop order, uploads streamed as the request body to the media folder (`routes/uploads.js`,
  `MediaStore.saveUploadStream`), each clip or sound a measured take, the one song labelled music bed, then Fill.
  The empty board shows the ghost strip with **Ask the Director** (only with a key), **Start from a starter** and
  **Bring my clips**. Where an untouched card renders is one rule, `src/shared/card-source.js` (engine first;
  bloop first with no engine; "Nothing can render yet…" with neither).
  **The Director in the dock (P4 UI, 05-irresistible.md §3)**: after a Director turn a sensor-blue strip under the
  rail reads "Director · 14 edits · 1:42 → 1:31" (`cut/turn-strip.edge`, `public/js/components/cut-turn.js`, from
  the GET's `turn`): **Show edits** lists one row per change with its stored reason, marks the changed clips,
  selects the first and scrolls to it; **Go to edit** on a row selects that clip and moves the playhead; **Undo
  turn** posts `/cut/undo-turn {turn, revision}` (one press, one dock undo step; refused once later edits came).
  Trimmed-off frames show as a blue ghost, the person's own clips as "Yours, untouched"; the strip folds into Ctrl+Z
  at the person's next edit. Clip notes stay sensor blue, the reason is the note's tooltip and a "Why:" line in the
  clip's details. `public/js/components/cut-measure.js`: "Measuring 3 clips…" on the rail; beat ticks only from
  measured `beats_ms` (downbeats taller, "Beats · estimated", "Not measured" without video tools); **Snap to beats**
  (track header, remembered per viewer) lands a dragged trim's cut point on a downbeat within 80 ms through
  `snapToBeat` in `src/shared/cut-sound.js`, never on drafts or keyboard nudges; **Duck under lines** in the Music
  level popover (−18..−3 dB, one undo step), duck bands and measured spoken lines from the server's `ducks` and
  `speech`; the preview ducks on the export's envelope at 20 Hz. `public/js/components/cut-check.js`: **Check your
  cut · N** on the rail with its own sheet; timed lines first with their time, **Show me** seeks there, a fix
  that needs a new take shows **Go to card**, warn marks on the ruler. `public/css/cut-director.css`.
  **Settings › Director › Editing style** (≤ 600 characters) holds how the person likes to cut; the Director reads
  it on every turn. P4 controls are in the guide (`SHIPPED`).
  **Outputs (P6, the dock side)**: **Shape** under the preview (16:9 / 9:16 / 1:1, remembered per viewer and space)
  shows each clip exactly as the export frames it: `src/shared/cut-frame-edit.js` places each preview video from
  `cut-frame.js` `fitFor`/`cropBox` (the export's maths; a 9:16 export frame matched the shared box at SSIM 0.98,
  a 7 px shift drops to 0.50). **Crop** opens the orange **Crop box** on the selected clip (CutReframe,
  `public/js/components/cut-reframe.js`: drag, corner or pinch zoom 1–3×, wheel, arrows 2 % / Shift 10 %, Home
  centres, one undo step per drag or key; `item.frame`). Soft bars draw a blurred copy of the playing clip behind a
  fitted one. **Captions** (preview and sheet) shows the cues of `src/shared/cut-captions.js` in the burned-in look;
  `public/js/cut/caption-render.js` draws each cue as a PNG (Inter 700, dark plate, orange cut) for the export. The
  export sheet (`cut-outputs.js`, `export-outputs.edge`): TikTok/Reels/Shorts presets with the length hint,
  **Shapes** (one file per shape, one job on the sheet: "File 2 of 3 · 9:16", then every file with **Show in
  folder** / **Copy path**), **Fit with soft bars** with the measured blow-up, Captions Off / Burned in with the
  honest note and ".srt beside every export", **Preview GIF**. All choices in `settings.outputs`. Captions start
  on when every captioned clip speaks its own script (`GET /spaces/:id/cut` `captions {default_on, why_off}`), else
  off with the reason in the sheet. After the person has seen a finished export, the sheet opens on the choices again.
  `public/css/cut-shape.css`. P6 controls are in the guide (`SHIPPED`).
  **Outputs (P6, the export side)**: one press makes one `cut_exports` row per shape (`variant`, `group_id`), run
  one at a time on the tools queue; Cancel stops the whole group. Each part is fitted, cropped from the person's box
  or set on soft bars (`gblur`, never `boxblur`) by `src/server/cut/export/frame-chain.js`, with the page's caption
  PNGs overlaid while each line is spoken; `extras.js` writes the `.srt` and the 6 s preview GIF (`palettegen`,
  ≤ 8 MB). Files are named per shape (`night-market-master-9x16-r12.mp4`) with the `.srt` and `-preview.gif` beside
  them, and Pack takes them along. The Director's `outputs` op sets up preset, shapes and captions (and fixes caption
  words) but never moves a crop box or starts an export.

## Rendering

- **Generate** on an Image or Video card queues a job; one GPU worker renders on the local ComfyUI.
- **Queue**: renders wait for wired-in renders, prefer the model already loaded, and survive an app restart
  (interrupted jobs are re-queued; their orphaned ComfyUI prompts are cancelled).
- **Live progress** over one event stream per board: step, percentage, time left, then the phase after the
  sampler (*Decoding video*, *Saving*). Cancel at any time.
- **Takes**: every render is kept per card with its seed, settings and the workflow variant that made it.
- **Seed lock** per card; otherwise every render gets a new seed.
- **Card knobs**: model family, aspect (16:9, 9:16, 1:1, 4:5, 21:9), resolution, duration and quality.
  The last choices per card type become the defaults for new cards.
- **Families**

  | Card | Family | What it makes |
  |---|---|---|
  | Image | Z-Image Turbo | Still from words; from words + a reference picture |
  | Video | MiniMax-H3 Turbo | Clip with sound from words; from a first frame; first → last frame |
  | Video | LTX-2.3 Distilled | Clip with sound from words; from a first frame; first → last frame |
  | Video | Wan 2.2 5B | Silent draft clip from words; from a first frame |

## Engine auto-detect (per machine)

- Each workflow can ship several **variants** (e.g. bf16 for a 24 GB card, int8 for 12 GB).
- The app reads ComfyUI's `/object_info` and `/system_stats` and picks, per workflow, the first variant whose
  nodes and model files are all installed. Families with no runnable variant are hidden from cards.
- **Settings → Engine → Workflows on this PC** shows the GPU, VRAM, backend (CUDA/ROCm), ComfyUI version,
  the variant each workflow uses, and the exact missing files for the others. *Re-detect models* refreshes it.
- **The card's memory counts too** (2026-10-05): every variant states `minVramGb` (scripts/set-min-vram.mjs:
  full precision 20, int8/fp8 11, Z-Image int8 and Wan 5B 8). A variant bigger than the card is skipped even
  with all its files there; Settings shows *Hidden · too big for this card* and the reason.
- New model files need no ComfyUI restart (tried: a file added to models/vae appears in /object_info at
  once). After an install, Download missing models or a Repair the app re-runs this check itself.
- A wired picture the chosen workflow cannot use (e.g. a last frame on Wan) stops the render with a clear message.
- **Lip sync** (2026-10-05): a Video card's **Voice / audio** socket takes a voice or song (Upload or Audio
  card). With a First frame it renders `workflows/ltx-ia2v.json` (built from ltx-i2v by
  `scripts/build-ltx-ia2v.mjs`): the audio is trimmed to the clip (`seconds` knob input) and frozen
  (noise mask 0), so LTX animates the picture to it. A wired voice picks LTX whatever the card's model, on
  this PC even for a cloud pick. Tried on the RTX 3080 Ti: 4 s at 480p in 65–80 s.
- **Audio card** (2026-10-05): voices, sound effects and music from its words on bloop's audio models
  (`kind=audio`, bloop's StudioAudioModels); a **Voice** knob reads `voice` / `voice_id` / `speaker`.
  Signed out it renders music locally (below); voices (text to speech) stay on bloop.
- **Local music** (2026-10-05): Audio cards render songs on this PC with ACE-Step 1.5 Turbo
  (`workflows/acestep-t2a.json`, default, 8 GB) or MiniMax Music 3 int8 (`music3-t2a.json`, 11 GB). Words is
  the style (tags / caption), the new **Lyrics** socket the sung words (`LyricsPrompt`; none → instrumental),
  **Duration** 15 s–3 min (formats.js `acestep` / `music3`, 30 s default). On 12 GB a 30 s song took 10 s
  (ACE-Step) and 75 s (MiniMax Music 3). Lyrics on a bloop cloud model are refused, not dropped. Both are
  in the engine installer (NVIDIA, offered unticked; Apache-2.0).
- **Install offline engine** (Settings → Engine, and *Download missing models* under Workflows on this PC):
  reads the graphics card from the registry and the free disk per drive, suggests the model families the card
  can run (`engine-install/plan.js`), and downloads ComfyUI portable v0.38.0 plus the picked model files from
  their publishers (`src/shared/model-sources.js`: URL, size, SHA-256, license). Resumable, checksum-checked,
  unpacked with Windows' own tar, then started by the launcher. *Add to my ComfyUI* puts the same models into
  an existing install. Licenses are linked and accepted per install. Files over 256 MB come in 6 parallel
  ranges. Models kept elsewhere through ComfyUI's `extra_model_paths.yaml` are found and never fetched twice.
  Settings → Engine shows disk used, **Repair** (checksum of every known model file, broken ones fetched again)
  and **Remove** (only an engine the app installed).
- **Cloud only:** no ComfyUI answering, none on this PC to start, and signed in to bloop: the engine light
  says *Cloud only* (blue), a card's Model list puts bloop's models first, and an untouched card renders on
  the first one (`routes/generation.js` → `offered()`). A ComfyUI that is only switched off keeps local first.
- **ComfyUI launcher:** a ComfyUI on this PC (portable build, or git install with a venv; common folders,
  or the folder set in Settings) is started by the app with the flags of its own `run_*.bat`, hidden, UTF-8.
  Top bar: *Engine off · Start*, *Engine starting…*, *Engine online · Stop* (Stop only for one the app
  started). Settings → Engine → ComfyUI on this PC: folder, *Start ComfyUI when Bloop Studio opens*,
  Start / Stop / *Free GPU memory* / *Find again*, and the engine log when it fails. Stopped on quit.

## Director

A port of bloop's Spaces Director (docs/plans/director-port.md), adapted to local models.
- **Plan first** (plan_board): on a new board it pitches the approach, names the cast, places and props, says
  the shape back ("TikTok, so 9:16") and asks at most two questions (questions about voice are dropped in
  code). It writes nothing to the board on a plan turn; a second plan only applies corrections.
- **Staged rail** (advance_build): each plate is a look note + a reference-sheet note → a picture, plus a voice
  note for a speaking person; cast first, then places and props, or all at once when told to get on with it.
- **The beats** (build_board): every guard bloop has (runtime reachable, hook first, resolution last, only who
  each brief names, drafted plates for unknown subjects), the music bed and the look card, then the beats are
  written in the background, three writers at a time (director/build/). A lane: brief + still words (SHOT line,
  image locks) → still, drawn FROM the cast/prop/place sheet pictures on Qwen-Image-Edit; motion + sound +
  script (`[@tag (how)] line`, `[VO]`) + voice card → clip on LTX-2.3, sized to its words.
- **Changes** through propose_board_ops (one op list, all or nothing, lane/stage, refs or @id), with the critic
  on its own work; inspect_board and audit_board read. Plan-first gate on empty boards; ops written as text
  are recovered once; a turn that changed nothing says so; a pasted-back reply is refused.
- Runs in the background (director/runs.js); the panel shows what it is doing, the build lanes as they land,
  replies as markdown (escaped first), and bloop's example asks. It never renders and never tells you which
  buttons to press.

- **The Director edits the Cut** (Katana P4 backend, docs/plans/katana/03-director.md): five tools after
  `audit_board`, always listed. `stitch_cut {fill | add_new}` puts the rendered beats in through `CutDraft`
  (gaps named, nothing rendered; a cut with the person's work gets a replace offer, never a write).
  `inspect_cut` measures before any time is set: one line per clip (still head/tail, spoken lines with the
  script's words, silence, loudness, scene changes, "can lose X s" from `fitPlan`) and one for the bed (BPM and
  downbeats, "estimated"); it waits at most 3 s and names what is not measured yet, and with no video tools says
  "Use no times." `propose_cut_ops` (place, trim, move, remove, join with J/L, sound, duck, level, snap, poster,
  undo_turn) checks the whole list first and saves it in one write through `CutEdits`, all or nothing, with every
  refusal back to the model as text; `why` is required on trims, moves and joins and kept (the why ledger); an
  out point within 80 ms of a downbeat lands on it; clips the person placed or changed are locked unless the
  person's own words this turn name the beat, "beat N" or the whole cut. One `cut_turns` row per turn holds the
  cut as it was: Undo turn (`POST /spaces/:id/cut/undo-turn`) or "undo that" puts it back with every stamp, only
  while nothing was saved after it; "keep the trims, undo the dissolves" takes back only some kinds. The cut
  critic runs once per turn as "CHECK YOUR CUT" (GAP, LINE_CUT_OFF, DEAD_AIR, LOUDNESS_OFF, MUSIC_ENDS_EARLY,
  OVER_RUNTIME, SHORT, JUMP and the untimed codes); `audit_board` adds THE CUT. `pack_assets` starts the same
  Pack job only when the person asked in words. `remember_edit_style` saves Settings' `editStyle` when asked to
  remember. No tool result names a control; no Director file reaches a render, an export, the job queue or the
  bloop cloud (tests grep both). EditCraft and the phrase table (`prompts/doctrine-edit.js`) follow STORY_CRAFT;
  the board state ends with `Cut: 6 of 8 beats, 1:42, revision 12` and, when needed, the locked beats, the gaps
  with their reasons and the beats' roles (`build_board` takes a `role` per beat, kept in the beat's staging).
- **Clip analysis** (`src/server/analysis/`): `AnalyzeMedia` measures a file once on the media-tools queue,
  behind every export and pack, with the bundled ffmpeg (`silencedetect`, voice-band `silencedetect` for spoken
  lines, `ebur128`, `freezedetect` and `scdet` on a 10 fps 64×36 grey scale-down, an 11 kHz PCM decode for the
  bed's onsets, tempo, downbeats and waveform bars; a grid counts only when at least half its beats land on an onset,
  so a beatless bed shows no ticks). Only what a cut holds, its beds, or what `inspect_cut` asks
  for is measured (`CutAnalysis` listens to `cut` events and tells the dock "measuring" / "done"). Cached in
  `media_analysis` by path, size, mtime and analyzer version. `GET /spaces/:id/cut` returns the duck windows
  (under the voice bed and every measured line, J/L aware, `src/shared/cut-ducks.js`), beat ticks, spoken lines,
  waveform bars, the analysis state, the timed findings and the newest Director `turn`; the export ducks on the same
  windows and aims at `settings.target_lufs` when the Director set one.

## Bloop account (optional)

- **Launch screen:** signed out, the app opens on it every time: *Sign in with bloop* or *Continue
  without an account* (plus the engine status and the four latest boards); signed in, it opens
  straight on Spaces. Signing out from the top-bar menu goes straight to it. Full screen on the
  MarketDragon hangar art
  (`public/img/launch-hangar.jpg`, always dark, a slight pointer drift unless reduced motion is on).
- **Top-bar account menu** (right end): *Sign in* when signed out; signed in, a chip with initials, plan
  and credits that opens name, email, plan badge, credits, *See plans* (free plan), settings and *Sign out*.
- **Sign in** through the browser (any bloop login: Google, TikTok, Facebook, email); the app never
  sees a password. Always at https://marketdragon.ph (no address to set; `BLOOP_URL` in development).
  Settings → Bloop account shows the same account with *Refresh* and *Sign out*.
- Signed in, bloop's curated cloud models join every card's Model list after the local ones, marked
  "bloop cloud · from N credits", each with only the knobs it takes (bloop decides what a plan sees).
  Renders run on bloop with the person's credits and come back as ordinary takes; a failed one says
  whether the credits came back.
- **Searchable lists:** a list of 9 or more options (the Model list) gets a search box that matches the
  name and the description ("kling", "cloud", "credits").
- Plan: [docs/plans/bloop-account.md](plans/bloop-account.md).

## Settings

- ComfyUI address with *Test connection*, media folder, Director provider, model names and API keys
  (encrypted with Windows; only ever sent to their provider), Bloop account, light/dark/system theme.

## App

- Electron desktop app; the server listens on 127.0.0.1 only, on a random port, with a CSRF token on every change.
- Opens maximized; the top bar is the title bar (drag it to move the window) with Windows' own minimize /
  maximize / close at its right end, coloured for the theme. F11 toggles true full screen (remembered).
  Windows installer via `npm run dist` with automatic date versions.
- **Self-update** from public GitHub Releases (`marketdragonph/bloop-studio-releases`): checks on launch and
  every 4 hours, downloads in the background, **Restart to update** in the top bar; Settings → App shows the
  version and *Check for updates*. Releases are built by the GitHub Actions *Release* workflow.
- `THIRD-PARTY-NOTICES.txt` with every shipped open-source package and its license, generated each build.

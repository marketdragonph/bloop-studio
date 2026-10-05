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

- A chat panel per board that builds the board for you with Claude or OpenAI (your own key): cast cards and
  character sheets, locations, then shots left to right, all wired. It never renders; you press Generate.
- **Runs as a background job** (2026-10-05, `director/runs.js`, table `director_runs`): a request returns at
  once; the turn keeps going when the panel closes or the page reloads, and its words and board changes
  arrive on the board's event stream (`event: director`). One run per board; Stop ends it, the cards it
  added stay. Up to 30 model rounds (the last one can only answer); out of steps, stopped with work done,
  or cut off by a closed app, the reply offers **Continue**.
- **Checks its own work** (ported from bloop's BoardAudit, `director/audit.js`): after every round that
  changes the board the model gets a board check (render cards with nothing in Words, a cast or location
  named in a shot but not wired into it, unused text, a last frame or voice without a first frame, failed
  renders) and fixes it before replying. Tools: `add_card` (incl. audio), `connect` (optional socket:
  lyrics, audio, reference, last_frame), `update_card` (text, label, aspect, duration), `inspect_cards`,
  `audit_board`. The board snapshot shows each card's render state and aspect / duration.

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

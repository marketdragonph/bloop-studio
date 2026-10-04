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
- A wired picture the chosen workflow cannot use (e.g. a last frame on Wan) stops the render with a clear message.
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

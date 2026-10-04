# Engine setup: Bloop Studio installs and runs ComfyUI for you — PLANNED

**Why this matters most.** Bloop Studio exists so people can make their stories without learning
ComfyUI. Today they still have to install ComfyUI, find the right model files, put them in the right
folders and start it from a `.bat`. Most give up there. This plan removes every one of those steps:
the person presses one button and ends with a working engine sized to their GPU.

Decided 2026-10-04 with the owner: this is priority 2 of the roadmap ([roadmap.md](roadmap.md)),
after the small cloud-only polish, and before the editor ports.

## What the person sees

1. **Launch screen / Settings → Engine:** "No engine on this PC yet." Two buttons:
   **Set up my GPU** (recommended when a capable GPU is found) and **Use bloop cloud only**.
2. **Set up my GPU** opens a wizard (an HTMX modal, steps as partials):
   1. **Your PC** — GPU name, VRAM, free disk space, NVIDIA/AMD. A plain verdict: "Ready for images
      and video", "Images only (8 GB)", or "Too small for local renders — use bloop cloud".
   2. **What to install** — model families with sizes, preselected for the card (e.g. 12 GB: Z-Image
      int8 + LTX-2.3 distilled-fp8 ≈ 40 GB). Each shows its license and source; one consent tick.
   3. **Folder** — default `%LOCALAPPDATA%\Bloop Studio\engine` (or another drive with room).
   4. **Installing** — one progress bar per download (MB/s, time left), resumable, survives a restart
      of the app. ComfyUI first, then models; a card family unlocks as soon as its files are in.
   5. **Done** — the engine starts, Settings → Workflows on this PC turns green, "Make your first
      render" opens a sample board.
3. From then on Bloop Studio **starts ComfyUI with itself and stops it on quit**. The top bar light
   reads Engine starting → online. Nobody opens ComfyUI or runs a `.bat`.
4. **Repair / add more:** Settings → Engine lists installed families, *Add a family*, *Repair* (re-check
   files and fetch what is missing), *Remove*, and the disk space used.

## How it works

- **ComfyUI:** the official portable build for Windows (embedded Python, no system Python needed),
  pinned to a tested release (0.38.x today). NVIDIA: the CUDA portable build. AMD: the ROCm build
  where available — **risk**: AMD on Windows is less mature; ship NVIDIA first, AMD behind "beta".
- **Archive:** portable builds are `.7z`; bundle a small extractor (`7zr.exe`, LGPL — add to
  THIRD-PARTY-NOTICES) rather than asking for 7-Zip.
- **Custom nodes** the workflows need (e.g. GGUF loader for the 24 GB H3 variant): fetched as pinned
  zip archives (commit SHA) into `custom_nodes/`, with their Python requirements installed by the
  embedded pip. Only nodes our shipped workflows use.
- **Model manifest** `src/shared/model-sources.js`: for every model file a workflow variant can need —
  folder (`diffusion_models`, `text_encoders`, `vae`, `loras`, `checkpoints`), size, SHA-256, license
  name + link, and the **official download URL** (Hugging Face: Comfy-Org, Lightricks, …). We never
  host model files: the person downloads from the publisher, under the publisher's license.
  A test checks that every file any workflow variant names has a manifest entry.
- **What to fetch** comes from the existing engine check (`engine-check.js` / `EngineProfile`): the
  variant chosen for this GPU tells which files are missing. No second list of requirements.
- **Downloads:** Node `fetch` streams with HTTP `Range` resume, a `.part` file, SHA-256 check before
  the rename, 2 retries, a free-space check up front, and pause/resume. A download queue in the main
  process; progress to the page through the existing event stream.
- **Process manager** (`src/main/engine-process.js`): spawn the embedded `python main.py` with
  `--listen 127.0.0.1 --port <free port>` (and the flags each GPU tier needs), point `comfyUrl` at
  it, health-check `/system_stats`, restart once on crash, kill the process tree on quit. The log is
  kept for Settings → Engine → *Show engine log*.
- **Existing ComfyUI stays supported.** Anyone who already runs ComfyUI keeps using it: the wizard
  offers "I already have ComfyUI" (today's address field), and the app never touches that install.

## Cloud-only mode (priority 1, small)

For PCs without a capable GPU, or before setup finishes: signed in to bloop, cards render on bloop
cloud models and the app is fully usable with no ComfyUI at all.

- Engine light: **Cloud only** (blue sensor, not a red fault) when no engine is configured and a
  bloop account is signed in; Engine offline stays for a configured engine that does not answer.
- Cards: the Model list shows the bloop models first when there is no local engine; the placeholder
  says "Pick a bloop model or set up your GPU".
- Launch screen / Settings: the two-button choice above.

## Checklist

- [ ] Cloud-only mode: engine light, card defaults, launch/Settings choice
- [ ] Model manifest with sources, sizes, SHA-256 and licenses; test: every workflow file is listed
- [ ] GPU check step (VRAM, disk, vendor) and the per-tier preselection
- [ ] Download queue: resume, checksum, free-space check, progress over the event stream
- [ ] ComfyUI portable install (NVIDIA), pinned version, `7zr.exe` bundled + notices
- [ ] Custom nodes as pinned archives + requirements
- [ ] Engine process manager: start with the app, stop on quit, health check, log
- [ ] Wizard UI (modal steps), Settings → Engine: add family / repair / remove / disk used
- [ ] AMD (ROCm) path, behind beta
- [ ] Tested end to end on a clean Windows PC (12 GB NVIDIA) and the 24 GB AMD desktop

## Open questions for the owner

- Default install drive when C: is small: ask, or pick the drive with the most room?
- Ship the int8 (12 GB) family set as the default for unknown GPUs, or ask every time?

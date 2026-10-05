# Bloop Studio roadmap — from 2026-10-04

The order agreed with the owner. Each line ships as its own release; the bloop web app items deploy
through Forge from `marketdragonph/bloop` `main`.

**The goal:** people make their stories without learning ComfyUI. Every item below either removes a
setup step or brings a bloop tool to where their renders already are.

| # | What | Where | Status | Plan |
|---|---|---|---|---|
| 0 | Optional bloop account, cloud models, launch screen, account menu, model search | both | **COMPLETE** (released 2026-10-04) | [bloop-account.md](bloop-account.md) |
| 0b | Free plan sees the lower-cost models (≤ 5 credits image, ≤ 15 video) instead of "needs Lite" | bloop | COMPLETE (2026-10-05) | [bloop-account.md](bloop-account.md) |
| 1 | `/bloop-studio` download page (always the latest installer) + footer, nav and in-app links | bloop | PARTIAL: live 2026-10-05; app clip, comparison, gallery, email-me-the-link still open | below |
| 2 | Cloud-only mode: no ComfyUI needed when signed in | Bloop Studio | COMPLETE (2026-10-05) | [engine-setup.md](engine-setup.md) |
| 3 | **Engine setup wizard**: installs ComfyUI and the right models for the GPU, runs it for you | Bloop Studio | PARTIAL: shipped 2026-10-05; AMD path and a clean-PC run left | [engine-setup.md](engine-setup.md) |
| 3b | **Director port**: bloop's Spaces Director (plan first, staged rail, beat writers, critic, panel), adapted to local models | Bloop Studio | PLANNED (next) | [director-port.md](director-port.md) |
| 3c | **Model browser**: search and install LoRAs from Hugging Face for the models we run, a live model catalog, variants of our models | Bloop Studio | PLANNED (after 3b) | [model-browser.md](model-browser.md) |
| 4 | Katana (video editor) in the app: board takes onto a timeline, export with bundled ffmpeg | Bloop Studio | PLANNED | survey first |
| 5 | Kaiga (canvas editor) in the app: edit a still, send it back to a card | Bloop Studio | PLANNED | survey first |
| 6 | Forge (filmmaker): storyboard → scenes → renders → finished film, on the app's Director | Bloop Studio | PLANNED | survey first |

## 1 · Download page `/bloop-studio` (bloop)

`/studio` is taken (the public showcase), so the page is `/bloop-studio`. Follows bloop's rules
(CLAUDE.md: design-system.css tokens, atomic Blade components, hx-boost, docs).

**It has to sell, not just link.** The pitch is "make films with AI without learning ComfyUI".
Sections, most persuasive first:

1. Hero: "Make films with AI. No node spaghetti." A short looping clip of the real app (wire a Text card
   into a Video card, Generate, the clip plays). **Download for Windows** with version + size, and
   "Free · runs on your GPU · or render on bloop cloud".
2. ComfyUI vs Bloop Studio: a real ComfyUI graph beside the same shot as three wired cards (shown
   plainly, not mocked).
3. "Made with Bloop Studio": a gallery of stills and clips rendered in the app (the Kiri assets fit).
4. Online / Offline / Both tiles (from engine-setup.md), "60 free credits when you sign in".
5. Three steps: download → choose online or *Install offline engine* → first shot.
6. Feature tiles: wired story board, first → last frame video, video with sound, Director chat;
   coming soon: Katana (video editor), Kaiga (canvas).
7. Requirements + FAQ, then the download button again.
8. On a phone or Mac: "Bloop Studio is for Windows" + *Email me the link*. After the download starts:
   a "What next" panel that shows the SmartScreen screen and where to click.

Clips and screenshots are made under `F:\MarketDragon-Media\` (bloop's media rule), never in the repo.
Built from bloop's marketing components (`marketing-hero`, `marketing-section`, `marketing-feature-card`).

- Hero: "Bloop Studio for Windows — free, renders on your own GPU"; **Download for Windows**.
- The button resolves the latest release server-side (GitHub API for
  `marketdragonph/bloop-studio-releases`, cached 10 minutes) and shows version + size; if GitHub
  cannot be reached it links the releases page.
- Lead line for people without a strong GPU: "No strong GPU? Sign in and render on bloop cloud."
- Perks (free offline; optional sign-in adds cloud models; 60 free credits), three steps, requirements,
  FAQ (SmartScreen until the installer is code-signed, automatic updates, NVIDIA/AMD).
- Links: footer Product column "Bloop Studio (Windows)", top marketing nav "Download", and a small
  "Get the desktop app" link on the Spaces page for signed-in users.

## 4–6 · Editor ports — notes

- The look carries over (Bloop Studio's mecha primitives were ported from bloop: `ae-key`, `ae-plate`,
  stencils). The plumbing changes to Bloop Studio's rules: Blade → Edge, Tailwind → CSS variables and
  component classes, one Alpine component per file, ≤ 500 lines per file.
- Web-only concepts become local: workspaces/teams → none, credits pop-ups → the optional bloop
  account, asset library / brand kits → the media folder.
- The web versions stay on bloop; the desktop gets its own.
- Before each port: a read-only survey of the bloop code (size, front-end libraries, what runs in PHP,
  how export is produced, AI features and their providers) to size it honestly.

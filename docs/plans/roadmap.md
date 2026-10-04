# Bloop Studio roadmap — from 2026-10-04

The order agreed with the owner. Each line ships as its own release; the bloop web app items deploy
through Forge from `marketdragonph/bloop` `main`.

**The goal:** people make their stories without learning ComfyUI. Every item below either removes a
setup step or brings a bloop tool to where their renders already are.

| # | What | Where | Status | Plan |
|---|---|---|---|---|
| 0 | Optional bloop account, cloud models, launch screen, account menu, model search | both | **COMPLETE** (released 2026-10-04) | [bloop-account.md](bloop-account.md) |
| 0b | Free plan sees the lower-cost models (≤ 5 credits image, ≤ 15 video) instead of "needs Lite" | bloop | PLANNED | [bloop-account.md](bloop-account.md) |
| 1 | `/bloop-studio` download page (always the latest installer) + footer, nav and in-app links | bloop | PLANNED | below |
| 2 | Cloud-only mode: no ComfyUI needed when signed in | Bloop Studio | PLANNED | [engine-setup.md](engine-setup.md) |
| 3 | **Engine setup wizard**: installs ComfyUI and the right models for the GPU, runs it for you | Bloop Studio | PLANNED | [engine-setup.md](engine-setup.md) |
| 4 | Katana (video editor) in the app: board takes onto a timeline, export with bundled ffmpeg | Bloop Studio | PLANNED | survey first |
| 5 | Kaiga (canvas editor) in the app: edit a still, send it back to a card | Bloop Studio | PLANNED | survey first |
| 6 | Forge (filmmaker): storyboard → scenes → renders → finished film, on the app's Director | Bloop Studio | PLANNED | survey first |

## 1 · Download page `/bloop-studio` (bloop)

`/studio` is taken (the public showcase), so the page is `/bloop-studio`. Follows bloop's rules
(CLAUDE.md: design-system.css tokens, atomic Blade components, hx-boost, docs).

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

# Bloop Studio (local)

Offline desktop version of bloop's **Spaces** and **Director/Forge**. Private project, not open source.
Electron + Node (plain JavaScript, ESM) + Hono + Edge.js templates + HTMX + Alpine.js + SQLite.
All generation runs on a local **ComfyUI** (default `http://127.0.0.1:8188`). The Director's LLM is
**Claude or OpenAI**, chosen in Settings with the user's own key. No teams, no payments in the app.
The one exception is the **optional bloop account** (docs/plans/bloop-account.md): signed in on Lite and up,
bloop's cloud models render on bloop with the person's bloop credits. Everything else stays local and free.

## Behavior

- Act as a senior JavaScript (Node/Electron) + HTMX + Alpine engineer.
- Concise, production-focused, Clean Code + SOLID. Ready-to-use code, consistent naming.

## Core engineering standards

- **Maximum 500 lines per file**, templates and CSS included. Split instead.
- **Pipelines** for multi-step flows (generation jobs, imports): small stage modules with `handle(ctx, next)`.
- **PromptProcessor pattern** for every prompt we build:
  ```js
  const prompt = new PromptProcessor().create(new SubjectPrompt(ctx), new StylePrompt(ctx));
  ```
- RESTful routes. Mutating requests are POST/PUT/PATCH/DELETE and must carry the CSRF header.
- One source of truth for rules the client and server both need (e.g. node socket types) in `src/shared/`.
- Never block the event loop on the GPU: jobs go through the queue, progress streams to the page.

## UI & design system ("mecha", inspired by the genre, never a franchise)

- Use `public/css/` tokens and primitives. CSS variables only: no hardcoded colours, no `!important`,
  no inline styles, no duplicate component CSS.
- Never use franchise names, logos or designs (no "Gundam", "RX-78", "Mobile Suit", Zeon, etc.)
  in code, comments, UI copy or prompts we ship.
- Mobile-first, accessible: AA contrast, visible focus (the cut-control focus ring), `prefers-reduced-motion`.
- Orange = action/live, blue = sensor/in progress, everything else seam grey.

## Templates & JavaScript

- Server-rendered Edge.js views; HTMX for server communication (`hx-boost`, partial swaps).
- Atomic components in `src/server/views/components/` (key, plate, stencil, field, alert, badge, status light).
- Each Alpine component in its own file under `public/js/components/`, registered with `Alpine.data("Name", Name)`.
- **HTMX modal pattern**: trigger with `hx-get` → `hx-target="#modal"`; the modal view returns full modal HTML;
  forms use `hx-boost`; success redirects back with a flash message.

## Security

- The server binds to `127.0.0.1` only, on a random port. Every mutating request needs the CSRF token.
- API keys are encrypted with Electron `safeStorage`; never log them, never send them anywhere but their provider.
- Only trusted ComfyUI workflows ship in `workflows/`. No user-supplied code execution.

## Testing

- `node --test` for unit tests. Run only the test files you touched; never the whole suite unless asked.
- Tests use a temp SQLite file and a fake ComfyUI server — never the real GPU.

## Docs

After any feature or fix: update `docs/plans/*.md` (`[x]`, PLANNED → PARTIAL → COMPLETE) and `docs/features.md`.

**Every user-visible change adds one line to `CHANGELOG.md` under `## Unreleased`**, in plain words a user
understands (`New:`, `Changed:`, `Fixed:`), not commit language. The release workflow publishes that
section as the release notes and files it under the version. Internal-only changes (tests, refactors,
docs) need no line.

## Media

Generated media never goes in the repo. It goes to the media folder from Settings (default
`%USERPROFILE%\Videos\Bloop Studio`).

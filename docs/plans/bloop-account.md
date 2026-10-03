# Optional bloop account: cloud models on credits — PARTIAL

Bloop Studio stays free and renders on the person's own ComfyUI. Signing in to a bloop account is
optional: on **Lite and up** it adds bloop's curated cloud models to every card's Model list, paid
with the person's bloop credits. The server side lives in the bloop repo (`modules/Studio`, plan
`docs/plans/bloop-studio-desktop-api.md`).

## How it works

- **Sign in** (Settings → Bloop account): a browser hand-off with PKCE, like the GitHub CLI.
  `BloopAccount` listens on `127.0.0.1:<random port>`, opens `<bloopUrl>/studio/connect`, and swaps
  the one-time code bloop sends back for a token (`POST api/v1/studio/token`). No password passes
  through the app; any bloop login works (Google, TikTok, Facebook, email). The token is encrypted
  with Windows (`bloopToken` in the settings store) and only ever sent to `bloopUrl`.
- **Models:** `GET api/v1/studio/models`, cached 5 minutes. Each becomes a card family
  `bloop:<model key>` (`src/server/generation/cloud-models.js`), listed after the local families as
  "bloop cloud · from N credits". Its knobs are the model's own params (aspect_ratio, resolution,
  duration, quality); a knob the model lacks is hidden.
- **Rendering:** `CLOUD_STAGES` (`src/server/generation/cloud-stages.js`) instead of ComfyUI: wired
  words and pictures (Picture, First frame, Last frame) go to `POST api/v1/studio/renders`; the app
  polls `GET renders/{id}` and saves the file as an ordinary take. On bloop it is a card on the
  person's "Bloop Studio" board, with Spaces' own price, hold and refund.
- **Restarts:** the bloop render id is kept on the job (`bloop:<id>`), so a re-queued job polls the
  render it already paid for instead of sending it again.
- **Cancel** stops waiting; bloop finishes (and charges) the render anyway.
- A card on a bloop model with no bloop account (signed out, free plan, model removed) renders on
  the card's local default, as its Model list shows.

## Checklist

- [x] Settings → Bloop account: sign in, plan and credits, refresh, sign out; bloop address field
- [x] Cloud models on cards with their own knobs and price
- [x] Cloud render stages, resume after restart, refund note on failure
- [x] Tested against a local bloop (Sail): sign-in, account, 48 video + 23 image models on cards
- [ ] One paid render end to end (spends real credits: needs the owner's go-ahead)
- [ ] Cloud renders on their own lane, so a slow bloop render does not hold up local GPU renders
- [ ] Deploy bloop (`feature/studio-desktop-api`) before releasing this

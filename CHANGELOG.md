# What's new in Bloop Studio

Plain words, newest first. Every change adds its line under **Unreleased**; the release workflow turns
that heading into the version number and uses the section as the release notes.

## Unreleased

- Changed: the Director talks before it builds. For a new film on an empty board it pitches the story, cast, shots and music and asks up to two questions first, then builds once you answer. Questions get answers instead of cards.
- New: the Director plans sound. Every shot gets a sound line for the video's own audio, and films get a Score card for the music (with a Lyrics card when it's a song).

## 2026.1005.1026

- Changed: the Director finishes big builds by itself. No Continue button: when it needs more steps it carries on in the same reply, and a build cut off by closing the app picks up again when you reopen it. Its replies say what it built instead of telling you which buttons to press; what to render stays your choice.

## 2026.1005.939

- New: the Director keeps working in the background. Close the panel or switch boards and it carries on; big requests no longer stop halfway, and when it runs out of steps, is stopped or the app closes, press Continue to pick up where it left off.
- New: the Director checks its own board as it builds: characters and places named in a shot get wired in, and cards with nothing in Words get fixed before it replies. It can also build Audio cards with lyrics and use the Last frame and Voice sockets.

## 2026.1005.933

- Fixed: you can remove a wire again. Click it (it turns orange) and press Delete; Ctrl+Z puts it back.

## 2026.1005.916

- New: music on your own GPU. Audio cards make songs with ACE-Step 1.5 Turbo (fast) or MiniMax Music 3 (best), from 15 seconds to 3 minutes. Wire the style into Words and the song's words into the new Lyrics socket; leave Lyrics empty for an instrumental. Both models are in Install offline engine and Download missing models.

## 2026.1005.847

- New: longer clips on your own GPU. LTX-2.3, MiniMax-H3 and lip sync now go up to 10 seconds at 480p (about 2–4 minutes to render on a 12 GB card). The higher resolutions stay at 5 seconds for now.

## 2026.1005.816

- Changed: models you download show up on your cards right away. No restart and no Re-detect needed.
- Changed: each model now uses the version your graphics card has the memory for. A 12 GB card no longer picks a 24 GB version just because its files are there; Settings → Engine says *too big for this card* instead.

## 2026.1005.756

- New: **lip sync**. Wire a picture into a Video card's First frame and a voice or song into its new **Voice / audio** socket: the picture talks or sings to it, on your own GPU (LTX-2.3).
- New: **Audio card** for voices, sound effects and music from your words, on bloop's models (ElevenLabs, MiniMax, Qwen voices; Suno music). Sign in to bloop; free accounts get the lower-cost ones.
- New: Upload cards take voices and songs too (MP3, WAV, OGG, FLAC, M4A).

## 2026.1005.702

- New: Settings → Engine shows how much disk your models take, and has **Repair** (checks every model file and downloads broken ones again) and **Remove** (for an engine Bloop Studio installed; your boards and renders stay).
- Changed: big model downloads use several connections at once.
- Changed: models you keep in another folder (ComfyUI's extra_model_paths.yaml) are found, so they are never downloaded twice.

## 2026.1005.651

- New: **Install offline engine** (Settings → Engine). Bloop Studio checks your graphics card, suggests the models it can run, and downloads ComfyUI and those models for you, straight from their publishers. Downloads resume if interrupted and every file is checked.
- New: already have ComfyUI? *Download missing models* adds the models your card can run to it.

## 2026.1005.631

- New: free bloop accounts can use bloop's lower-cost cloud models too, on their free credits.
- New: no ComfyUI on this PC? Signed in to bloop, Bloop Studio works cloud only: the engine light says *Cloud only* and cards use bloop's models first.

## 2026.1005.623

- New: Bloop Studio finds ComfyUI on your PC and starts it for you. Press **Start** next to the engine light in the top bar, or turn on *Start ComfyUI when Bloop Studio opens* in Settings → Engine. No more .bat files.

## 2026.1004.945

- Changed: while signed out, the launch screen shows every time the app opens.

## 2026.1004.938

- Changed: signing out of bloop brings back the launch screen, to sign in again or continue without.

## 2026.1004.927

- Changed: the launch screen is full screen, with new MarketDragon hangar art behind it.

## 2026.1004.902

- New: release notes. Settings → App → *What's new* opens the notes for your version.

## 2026.1004.835

- New: a launch screen when the app opens. Sign in with bloop or continue without an account, then
  jump back into a recent space. It shows until you choose.
- New: your bloop account in the top bar. *Sign in*, or your plan and credits with *Sign out*.
- New: search in long lists. Type in the Model list to find a model by name or price.
- Changed: no bloop address to set. Bloop Studio always signs in at marketdragon.ph.

## 2026.1004.757

- New: optional bloop account. Sign in through your browser (Google, TikTok, Facebook or email) and
  bloop's cloud models join every card's Model list, paid with your bloop credits.
- New: cloud models offer only the settings each model takes (aspect, duration, resolution, quality).
- Fixed: the card preview follows any aspect ratio a model offers.

## 2026.1004.613

- New: app icon, the stencil B on the orange plate.
- New: minimize, maximize and close in the top bar; the app opens maximized. F11 for full screen.
- New: *Check for updates* shows its progress right away.
- Changed: one BLOOP STUDIO wordmark in the top bar.
- Fixed: clicking an Upload card opens the file picker again.

## 2026.1004.541

- New: updates install themselves. *Restart to update* appears when one is ready.
- New: Bloop Studio checks which models your ComfyUI has and offers only what your PC can run.
- New: LTX-2.3 video with sound.
- New: Last frame socket on Video cards (travel from the first picture to this one).

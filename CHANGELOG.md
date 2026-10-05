# What's new in Bloop Studio

Plain words, newest first. Every change adds its line under **Unreleased**; the release workflow turns
that heading into the version number and uses the section as the release notes.

## Unreleased

- New: a Cut dock at the bottom of every Space shows your film's beats in order, with each clip's length and a hatched slot for every beat that has no video yet. Go to card takes you to that beat's card. The dock folds to one line and remembers whether you left it open.
- New: you can edit the cut in the Cut dock. Fill the cut puts every rendered beat in. Drag clips to reorder them, drag the orange handles to trim, switch a join between a cut and a dissolve, turn a clip's sound off, take a clip out (with an 8-second Undo), and set the music and voice levels. Press Play to watch the cut with its music, with a slate where a beat is still missing. The cut saves by itself and keeps unsaved changes on this computer. If another window changed the cut, you choose which version to keep.
- New: on a planned board the cut builds itself. Each clip drops into its place in beat order as it finishes, and the music goes under it, until you edit the cut yourself. After that, new clips wait for Add new clips and never move what you did. A clip you took out stays out, unless its card gets a new take.
- New: Render missing beats, in the Cut dock and next to the render count, queues every card the plan still needs with one press. Its sheet first shows how many cards, on which models, and on bloop the credits it needs and your balance; it will not start if you are short. Cancel all stops those renders and leaves a card you started with Generate running.
- New: Start from a starter, on an empty board or the empty Spaces list, lays out a ready short film (Night drive, Product turn or Postcard from the sea) with every card wired and its words written. No key and no internet needed.
- New: Bring my clips, or dropping files on an empty board or an empty Cut dock, puts your own videos into the cut in the order you dropped them, with one song under them as the music. Bring two or more songs and the dock asks which one goes under the clips. Big files are copied without filling up memory, a file that fails to copy leaves no empty card behind, and one Undo on the board takes the whole drop back.
- Changed: an empty board shows what you can make and the ways to start. Ask the Director shows only when a Director key is set. With no engine but a bloop sign-in, new and starter cards start on bloop's models.
- New: ask the Director to "cut it together", "tighten it", "cut on the beat" or "duck the music under the lines". It measures your clips on this computer first (still frames, silence, spoken lines, loudness and the song's beats) and edits the cut with those numbers, saying why for every cut. It never renders and never exports, leaves clips you changed alone unless you name them, and "undo that" takes its whole turn back.
- New: after the Director edits your cut, a blue strip under the Cut dock's rail says what changed ("Director · 14 edits · 1:42 → 1:31"). Show edits lists every change with the Director's reason, marks those clips and jumps to one when you pick it; Undo turn takes the whole turn back in one press. Trimmed-off frames show as a faint blue ghost, and clips you changed yourself say "Yours, untouched".
- New: Settings › Director › Editing style, a box where you write how you like your cuts ("no dissolves, hold the last shot"). You can also tell the Director "remember that I never want dissolves". It reads your style on every turn.
- New: Snap to beats in the open Cut dock lands a dragged trim on the song's nearest downbeat. The blue ticks on the ruler are the song's beats, measured on this computer and marked as estimated.
- New: Duck under lines, in the Music level, lowers the music under spoken lines (yours and the ones inside your clips) by 3 to 18 dB. The preview plays it the way the export will, and the Music lane shows where it dips.
- New: Check your cut sits on the Cut dock's rail with its count. It finds a missing beat, a cut-off line, dead air, a clip much louder or quieter than the ones around it, music that stops before the picture, a cut that runs long, a clip shorter than its beat asked for, and two of the same shot in a row. Each line says when in the cut it happens, Show me jumps there, and a beat that needs a new take shows Go to card. While the clips are being measured the rail says so ("Measuring 3 clips…").
- New: Export in the Cut dock makes your cut into a video file on this computer, free. Before you press it, the sheet shows the length, the size, which beats are skipped and what to check. While it runs you see each step and can cancel. When it is done the file is in your media folder and on the board as a new video card, with Show in folder, Copy path and Show on board. If one clip cannot be read, Remove it and export again does what it says.
- New: the export sheet has Master, YouTube, TikTok, Reels and Shorts presets (with a note when the cut runs past a platform's limit) and a Shapes row that makes one file per shape, 16:9, 9:16 or 1:1, from one press. When a crop would blow a clip up and look soft, Fit with soft bars shows the whole picture over a blurred copy instead.
- New: Shape under the Cut dock's preview shows your cut in 16:9, 9:16 or 1:1 exactly as the file will look. Crop shows the whole selected clip with an orange box: drag it, pinch it, or use the arrow keys (Home centres it), and each clip keeps its own box for each shape.
- New: Captions burns the script's lines into the picture in the app's look, timed to the spoken lines, and you can see them in the preview first. Captions start on when each clip speaks its own script, and the sheet says why when they start off. An .srt file goes beside every export, and a 6-second preview GIF too unless you turn it off.
- New: Set as poster picks the cover frame of your export from the selected clip, and the cut remembers it.
- New: ask the Director to "make this ready for TikTok" or "add captions" and it sets up the preset, the shapes and the captions, and can fix a caption's words. It tells you when a shape will crop in and look softer, never moves your crop boxes, and never starts the export.
- New: Pack assets in the Cut dock puts every file the board made, with its notes and a manifest, into one zip in your media folder. You choose whether the prompts and seeds go in. You can also ask the Director to "pack everything up".
- New: Settings › Video tools shows the ffmpeg the app uses, with Check again and Choose ffmpeg.exe… if it goes missing.
- New: on a narrow window or a phone-sized screen the Cut dock opens as a sheet at the bottom, and only one of the dock and the Director is open at a time. Export stays in sight on the dock's top line. Tap a clip to open its sheet: Trim has a slider for each end and −0.1 s / +0.1 s keys, and Done closes it. On touch screens every key in the dock is big enough for a finger.
- Changed: orange and blue text is a shade deeper in the light theme, so it is easier to read.
- Fixed: undoing a card you deleted brings back its earlier takes too.
- Fixed: the Director panel could keep saying it was working after a quick reply had already arrived.

## 2026.1005.1232

- Changed: the Director now works like bloop's. On a new board it plans first: a pitch, the cast, the places and the shots, and at most two questions. After your answer it lays the cast and the places, then writes every shot in the background (you see each lane land), with the camera, the sound, the lines and the music. It checks its own work and never claims a change that didn't land. Its replies are formatted text.
- New: Image cards take up to three pictures. With two or more, the still is drawn from them on Qwen-Image-Edit 2511 (the same faces, outfits and places), and the Director wires each shot's cast sheets into its still. Qwen-Image-Edit is in the engine installer.

## 2026.1005.1156

- Fixed: a card no longer sits on "generating" forever when ComfyUI is restarted mid-render. It now stops with a message after about 20 seconds, so you can generate it again.

## 2026.1005.1134

- Fixed: Audio cards show their progress again while they render (the percentage, the bar and the step).

## 2026.1005.1122

- Changed: cards take the real shape of their clip or picture. A vertical clip makes a tall card instead of sitting in a wide box with black bars, on rendered cards and uploads alike.

## 2026.1005.1119

- Changed: the audio player matches bloop's: a framed player with mute, download and Show in folder keys under the waveform, in light and dark mode.

## 2026.1005.1112

- New: clips and sound play in Bloop Studio's own players. Clips get a play key, a scrubber, the time, a volume level that every player remembers, and fullscreen. Songs and voices get a waveform you can click to seek, a voice light and a level meter.
- Fixed: a new Video or Audio card showed "Choose…" for Duration instead of its default (5 s for clips, 30 s for songs).

## 2026.1005.1051

- New: you can see the Director working. While it builds, its reply shows what it is doing (adding cards, wiring, checking its work) with a running count of cards and wires, and the panel header lights up.
- Fixed: reloading the board while the Director was working showed your message twice.

## 2026.1005.1035

- Fixed: the board no longer lags while the Director builds. It redraws only what changed, at most twice a second, instead of redrawing every card for each card it adds.

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

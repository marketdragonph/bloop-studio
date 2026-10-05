# Katana 06 — Full Katana: CapCut feel, better than CapCut — PLANNED

Part of [../katana.md](../katana.md); settled conflicts and owner decisions (§8) there win. Phases live in
[04-full.md](04-full.md) §7. **Renderer, export pictures, transitions, effects, looks and text animations:
[07-fx.md](07-fx.md) (Katana FX) wins over this file.** Merged 2026-10-05 by the lead from three inputs: a CapCut desktop teardown
(2025–2026 help pages, shortcut sheets, reviews), a gap analysis of bloop's Creatives editor (read only), and a
"beat CapCut" proposal with a mecha layout. Sizes: **S** under 150 new lines, **M** 150–400, **L** over 400.

## 1. The target

Someone who has used CapCut opens Full Katana and edits within ten seconds: same four zones, same magnetic main
track, same keys. Then it does what CapCut cannot: it knows the story (chapters, lines, look), stays smooth on a
2-hour film, exports what the preview shows, resumes a failed export, and is free, local and watermark-free.

## 2. Decisions the lead made while merging

| # | Inputs disagreed on | Settled | Why |
|---|---|---|---|
| 1 | Keys: CapCut's map vs a custom one (S split, V/B tools) | **CapCut's map** (§4.4). Ours add J/K/L, Ctrl+K, R, Page Up/Down | Muscle memory is the point. Our extras use keys CapCut leaves free. |
| 2 | `[` `]` in CapCut select clips; in our dock they set in/out | `[` `]` = Q / W (trim the selected clip to the playhead). Clip select left/right moves to Shift+`[` `]` | One meaning across dock and Katana. |
| 3 | Bin tabs: CapCut's ten vs five story tabs | **Seven:** MEDIA, BOARD, SCRIPT, AUDIO, TEXT, TRANSITIONS, **EFFECTS** (was LOOKS; Looks is its first category; 07-fx §7.1, owner question A in katana.md) | CapCut's shape plus our edge. No stickers or whole-video templates. |
| 4 | Colour: LGPL filter chain vs one LUT | **One LUT** (`grade.js` → 33³ table, a 3D texture in the Katana FX compositor for preview **and** export; no `lut3d` in Full, 07-fx) | Parity by construction. Curves and wheels become cheap. No `eq`. |
| 5 | Captions engine: OpenAI key vs local Whisper | **Script first** (no AI), then **local whisper.cpp** on request; OpenAI only as opt-in | Local and free by default; names spelled right from the script. |
| 6 | bloop's `canvas/*`: port vs rebuild | **Rebuild.** `canvas/*` never ran for a user (imported by nothing) | Porting untested code is a rewrite with extra risk. |
| 7 | Markers and volume points in 0..1 of the clip (bloop) | **Source ms.** Hand-off converts once | 0..1 drifts on every trim and split. |
| 8 | Timeline drawing: canvas lanes vs virtual DOM | **Virtual DOM lanes** (≤ ~80 clip nodes) + canvas tiles for filmstrips and waveforms | DOM keeps focus, ARIA and the cut-control focus ring. Bitmaps keep it fast. |

## 3. The layout (1600 × 960 reference; tokens and mecha primitives only)

```
y 0   ┌ TOP BAR 56 ─ ‹ KATANA  Night market · SAVED R42 │ ↶ ↷ │ DIRECTOR ⌃K │ VERSIONS │      EXPORT ┐
y 56  ├ BIN 360 ───────────┬ VIEWER 900 ─────────────────────────────┬ INSPECTOR 340 ──────────────┤
      │ tabs 7 × 36        │ shape 16:9 9:16 1:1 · PROXY · SAFE · ½   │ VIDEO AUDIO SPEED ANIM ADJUST│
      │ search 32          │      canvas 718×404 on media-ground      │ (WORDS when the clip has a   │
      │ 2-col grid 160×90  │ transport 44: tc · ◂ ▶ ▸ · [ ] · loop ·  │  line)                       │
      │                    │   As exported · full screen              │ .ae-plate--sunk sections     │
y 536 ├────────────────── splitter 4 (drag; timeline up to 60 %) ─────────────────────────────────┤
y 540 │ TOOLBAR 36: A B │ ↶ ↷ │ split · del◂ del▸ · freeze · reverse · mirror · crop │ ⌖ P N ` S BEATS │ zoom ─●─ FIT │
      │ TURN STRIP 28 (only after a Director turn)                                                │
      │ SPINE 28: 01 HOOK·Night market │ 04 TURN·The door │ 07 CLIMAX·Roof                         │
      │ RULER 24: timecode · beat ticks · chapter seams · I/O range                               │
      │ headers 176 │ T1 TITLES 28 · V2 OVERLAY 40 · V1 MAIN 72 · A1 DIALOGUE 52 · A2 MUSIC 52 · A3 FX 40│
      │ MINIMAP 16: whole film, chapter seams, view box                                           │
y 936 └ STATUS 24: PROXIES 3/9 · EXPORT CH 4/12 · 37/140 · DISK 112 GB FREE · SPEECH MODEL: NOT INSTALLED┘
```

### 3.1 Top bar (56 px, `--topbar-height`, also the title bar; 138 px kept for window controls)

- Left: `.ae-key--square` back chevron (to the Space, or `/katana`), stencil KATANA, project name in Inter 600
  (click to rename). Readout "SAVED · R42" in seam grey; blue "SAVING" while a save runs.
- Centre: Undo, Redo, **Director** key with a "CTRL K" chip, **Versions**.
- Right: **Export** (`.ae-key--accent`). The only orange key on the page.

### 3.2 Bin (x 0–360)

`.ae-plate` with seven stencil tabs (≈ 51 px each, icon over a `--fs-3xs` (10 px) stencil label in
`--text-secondary`; Tab cycles them when the bin has focus). Active tab: 2 px orange underline (`.ae-stencil--ruled`). Below: 32 px search, then a 2-column grid of
160 × 90 thumbnails with a length chip and, when needed, a PROXY chip or a blue level.

| Tab | Holds | Press / drag |
|---|---|---|
| MEDIA | Imported files, takes from the linked Space | Hover scrubs (10-frame sprite). Drag to a track, or **+** adds at the playhead on V1 |
| BOARD | The Space's beats ("04 TURN · The door") with each beat's takes. Hidden on a blank project | Same as MEDIA; a beat drags in as its newest take |
| SCRIPT | The film's lines by beat: "[Kaito · flat] You still owe me a finish." | Click seeks. **Caption all lines**. **Delete line** ripple-removes its span (K6b) |
| AUDIO | Audio cards, imported audio, **Extract audio** from a video, **Record voice-over** | Drags to A1–A3 |
| TEXT | Default text, 8–12 house text templates (mecha look) | Drags to T1; a looping thumbnail shows the animation |
| TRANSITIONS | The 30 Katana FX transitions (07-fx §6.1), drawn by the compositor in preview and export; no longer limited to `xfade` names. Search, favourites, recent, hover preview on the selection | Drop on a V1 join; 0.5 s default; **Apply to all joins** |
| EFFECTS (was LOOKS) | Looks (8 presets over the grade, **Bring a LUT**) first, then 15 effects and 6 beat effects (07-fx §6.2, §6.4) | Drop on a clip (its stack), above the tracks (an E1 effect clip), or on the project with nothing selected |

Empty MEDIA: a ghost tile "Drop video, audio or images here. They are copied to your media folder."

### 3.3 Viewer (x 360–1260)

- 32 px header: shape chips 16:9 / 9:16 / 1:1 (`.ae-chip`, active one orange-edged), PROXY chip when any proxy
  plays, safe-area toggle, preview quality (Full, ½, ¼).
- Well: always `--media-ground` black in both themes. At 16:9 the canvas is 718 × 404, centred.
- Transport 44 px: timecode in Inter 600 tabular figures ("01:12:04:18 / 02:04:31:00", never Orbitron), step
  back, Play, step forward, `[` `]`, Loop (I/O range), **As exported**, Full screen (Ctrl+Shift+F).
- A selected visual clip shows handles: drag to move, corners to scale, a rotate grip. Guides snap to centre and
  safe area; hold Ctrl to ignore them. In 9:16 or 1:1, an orange crop box per clip (K5 static, K6 keyframed).

### 3.4 Inspector (x 1260–1600)

Tabs follow the selection, CapCut's order. Sections are `.ae-plate--sunk` with stencil labels; sliders are
`role=slider` with readouts; every animatable row has a ‹◇› keyframe control.
- **Video clip:** VIDEO (transform, opacity, blend: Normal, Multiply, Screen, Darken, Lighten only, 04 §5; mirror,
  rotate, crop) · AUDIO (volume, fades, bus) · SPEED
  (constant 0.25–4×, pitch; curves later) · ANIMATION (In, Out, Combo) · ADJUST (grade, look, effects stack ≤ 4 per 07-fx §7.1, match to board
  still) · WORDS (only when the clip carries a script line). **Re-take this shot** sits at the foot of VIDEO.
- **Text clip:** TEXT (font from bundled fonts, size, plate, outline) · ANIMATION (In, Out, Loop).
- **Audio clip:** AUDIO (volume line, fades, normalise) · SPEED.
- **Nothing selected (the project):** FRAME (shape, fps) · LOOK (the board's look note, **Apply the look**) ·
  SOUND (LUFS target, measured value, duck depth) · CAPTIONS (style, burn-in).
- Director notes show as `.ae-signal` with the sensor-blue line.

### 3.5 Timeline zone (y 540–936; grows to 60 % via the splitter)

- **Toolbar 36 px.** Left: Select (A) and Blade (B) tool keys, Undo, Redo, Split, Delete left (Q), Delete right
  (W), Freeze, Reverse, Mirror, Crop. Right: toggles Magnet (P), Snap (N), Linkage (`), Preview axis (S),
  **Beats**; a log zoom slider with − / +; **Fit** (Shift+Z). Toggle on = orange 2 px edge (`--accent-text`);
  off = `--ae-seam-control` edge (the faint `--ae-seam` fails 3:1), plus `aria-pressed`.
  **Cut to the music** shows with a selection (K8).
- **Turn strip 28 px**, only after a Director turn: blue `.ae-signal` "DIRECTOR · 9 EDITS · 4:12 → 3:58 · UNDO
  TURN · SHOW". Folds at the person's next edit.
- **Story spine 28 px.** One chamfered seam plate per chapter: Orbitron stencil ("04 TURN") + Inter name. The
  current chapter has the `.ae-plate--flash` orange corner. Click jumps; double-click zooms to it; drag moves the
  whole chapter (picture, sound, titles) as one ripple op. Hover: "planned 6 s · cut 4.8 s". Plates are
  virtualized like clips (only plates in view exist).
- **Ruler 24 px.** Timecodes, sensor-blue beat ticks (downbeats taller, "estimated"; measured data is sensor, and
  orange stays for the playhead), chapter seams, I/O range. Ticks, seams and markers are drawn on the ruler's
  canvas tiles, never as DOM nodes (120 bpm over 2 h is 14,400 ticks).
- **Tracks.** 176 px headers: stencil name, lock, eye or mute, solo on audio, a 4 px meter. Default lanes:
  T1 TITLES 28 · V2 OVERLAY 40 · **V1 MAIN 72** (filmstrip, junction chips between clips) · A1 DIALOGUE 52 (solid
  waveform, speech spans underlined) · A2 MUSIC 52 (outlined waveform, hatched duck bands) · A3 FX 40 (hatched
  waveform). Buses differ by pattern, never new hues. More overlay tracks appear on demand above V2.
- **Clips.** `--bg-tertiary` with seam edges; clip names in `--text-secondary` (`--text-muted` is 4.3:1 on
  `--bg-tertiary` in light, under AA). Selected: orange 2 px edge and orange trim handles (22 px; 44 px
  on coarse pointers). Director-changed: blue ring for 2 s (static under reduced motion). Disabled (V): hatched.
  Person-locked from a Director turn: a small lock mark.
- **Playhead.** 2 px orange line across spine, ruler and tracks; chamfered head on the ruler. The preview-axis
  line (S on) is seam grey.
- **Minimap 16 px.** The whole film with chapter seams; the view box has a seam-lit edge; drag to travel.

### 3.6 Status strip (24 px)

Readouts only: "PROXIES 3/9" (blue while building), "EXPORT · CH 4/12 · 37/140" (blue level), "DISK 112 GB
FREE", "SPEECH MODEL: NOT INSTALLED" (seam grey). Each is a key that opens its place.

### 3.7 The Ask bar (Ctrl+K)

- A 640 × 52 `.ae-plate` slides down from the top of the timeline zone, centred over the lanes; 3 px sensor-blue
  left edge. 160 ms (`--duration-base`, `--ease-out`); appears without a slide under reduced motion.
- Left: scope chip SELECTION / CHAPTER 3 / WHOLE FILM (default: selection, else the current chapter; keeps a
  2-hour film in the token budget). Input "Tell the Director what to change". Right: **Ask** (a normal key).
- Below: one 32 px row of three suggestions with numbers from `inspect_cut`: "Tighten chapter 3 (can lose 6.2 s)",
  "Music 4 dB loud under the roof scene", "Cut the chase on the beat".
- The suggestions are the page's own chips from measured numbers, not Director text. Pressing one fills the input;
  nothing runs until **Ask**. Opening the bar sends nothing to the provider.
- Working: pulsing sensor dot (static under reduced motion), "Measuring 14 clips". Done: two lines of reply in a
  polite live region for 6 s (held while hovered or focused), then it closes and the turn strip pins. The reply
  says what changed in editing words and never names a control (03 §6 grep). **Esc** closes; Ctrl+K again shows
  the last reply. No key: "Add a Claude or OpenAI key in Settings
  to ask the Director" + **Open Settings**.

### 3.8 Themes and narrow windows

Every colour is a `light-dark()` token. Orange: Export, playhead, selection, trim handles, active toggles, crop
box. Blue: in progress, Director, proxies, exports, beat ticks. Everything else seam grey.
**Contrast (checked against `tokens.css`):** plain `--accent` (#F97316) is 2.55:1 on light `--bg-tertiary`, under the
3:1 that lines and edges need. On theme surfaces, orange lines, edges, handles and the playhead use `--accent-text`
(#C2410C light 4.7:1, #F97316 dark 6.2:1); plain `--accent` stays for key fills (with `--ink-on-accent`) and inside
the black media well. Blue lines use `--sensor` (4.7:1 light, 3.4:1 dark), blue text `--sensor-text`. Readouts
and small labels use `--text-secondary`. A K1 check measures every token pair the page uses in both themes. Focus is the
cut-control ring (`.ae-key:focus-visible`) everywhere, clips and spine plates included. Under 64rem the bin and
inspector become sheets; under 40rem "Katana needs a wider window" with **Back to the Space**.

## 4. The editing model

### 4.1 Tracks

- **V1 MAIN is magnetic** while the magnet is on (P, default on). It never has a gap: insert pushes later clips,
  delete closes up, a drag reorders. Magnet off: gaps allowed, shown hatched, exported as black and silence.
- **Overlay tracks** (V2+, T1, A1–A3) are free: gaps and overlaps across tracks allowed. A drop on an occupied
  spot makes a new track of that kind above (video, text) or below (audio).
- Track headers: lock, hide or mute, solo (audio). Locked tracks ignore every op, Director ops included.

### 4.2 Linkage

- Linkage on (`, default on): an overlay, title or audio clip is linked to the V1 clip under its start, stored as
  `linkedTo: clipId` + `linkOffsetMs` on the `ClipDTO`. Moving, rippling or deleting that V1 clip moves linked
  clips with it (delete asks: "Also remove 2 linked clips?" — default keep, they unlink in place).
- Hold **Alt** while dragging to move a clip free (unlink). Linkage off: clips keep absolute time.
- Clip sound split from a V1 clip (J/L from the hand-off, **Extract audio**) is linked by default.
- One pure function, `ops/link.js`, resolves followers; every op calls it. A test pins "ripple moves followers".

### 4.3 Snapping, splitting, trimming

- **Snap (N):** playhead, clip edges on every track, markers, I/O, chapter seams, and beat ticks when **Beats** is
  on. Threshold 8 px at every zoom (bloop's pixel rule). A thin vertical line shows the target. Targets live in a
  sorted array rebuilt per drag start; lookup is a binary search (bloop scanned linearly).
- **Split (Ctrl+B)** splits the selected clips at the playhead, or the clip under it when none is selected;
  **Ctrl+Shift+B** splits every unlocked track. Blade (B) splits where you click; A goes back. Split divides
  fields by rule: in-transition and In animation stay left, out-transition and Out animation go right, markers
  and volume points go to the half they fall in, keyframes are re-based, a speed segment is recomputed.
- **Q / W** (and `[` / `]`) delete the selected clip's part left or right of the playhead; on V1 the rest closes up.
- **Trim** by handles clamps at the first and last source frame and accounts for speed (bloop's three trim fixes).
- **Delete / Backspace** removes; on V1 with the magnet on it ripples. **Shift+Delete** leaves a gap (magnet off).

### 4.4 Keys (one map in `src/shared/katana/keys.js` `KEYS`, read by the controls registry; the guide test pins it)

| Key | Action | Key | Action |
|---|---|---|---|
| Space | Play / pause | J / K / L | Shuttle back / stop / forward (press again: 2×, 4×) |
| ← / → | Frame back / forward | Shift+← / → | 10 frames |
| ↑ / ↓ | Previous / next cut | Home / End | Start / end |
| Page Up / Page Down | Previous / next chapter | Shift+M | Add chapter at the playhead |
| A / B | Select / blade tool | Ctrl+B / Ctrl+Shift+B | Split / split all tracks |
| Q / W, [ / ] | Delete left / right of playhead | Shift+[ / ] | Select clips left / right |
| Delete | Delete (ripple on V1) | Shift+Delete | Delete, leave gap |
| V | Enable / disable clip | M | Add marker |
| I / O | Mark in / out | Alt+X | Clear in / out |
| P | Main track magnet | N | Snapping |
| ` | Linkage | S | Preview axis (hover skim) |
| Ctrl+= / Ctrl+− | Zoom in / out (also Ctrl+scroll) | Shift+Z | Fit |
| Alt+scroll | Pan | Ctrl+G / Ctrl+Shift+G | Group / ungroup |
| Ctrl+R | Speed panel | Ctrl+Shift+S | Extract / restore audio |
| Ctrl+. / Ctrl+, | Volume +1 / −1 dB | Alt+K | Keyframe at playhead on the focused row |
| Ctrl+Z / Ctrl+Shift+Z, Ctrl+Y | Undo / redo | Ctrl+C / X / V | Copy / cut / paste |
| Ctrl+I | Import | Ctrl+E | Export sheet |
| Ctrl+K | Ask bar | R | Re-take this shot |
| Ctrl+S | Save a named version | Ctrl+Shift+F / Esc | Full screen / exit, close |

Keys never fire inside text inputs. Clip focus: Tab into a lane, arrows move between clips, Alt+arrow moves the
clip, Shift+arrow nudges 0.1 s, Enter opens its inspector. (Chapters were on Alt+←/→ and clashed with Alt+arrow
on a focused clip; they moved to Page Up / Page Down.) Space plays even when a key has focus; Enter presses keys.

**Clashes with Electron and Windows (critic pass).** `src/main/main.js` sets `autoHideMenuBar` but never replaces
Electron's default menu, so today **Ctrl+R reloads the page** (lost edits), **Ctrl+− / Ctrl+0** zoom the whole
page, **Ctrl+W** closes the window and a lone **Alt** opens the hidden menu (breaks Alt+drag and Alt+scroll).
K2 sets an app menu with none of those roles (owner question, §10), keeps DevTools and reload as
`before-input-event` keys in unpackaged runs only, turns off Ctrl+wheel page zoom (`setVisualZoomLevelLimits(1, 1)`
and a non-passive wheel listener), and leaves **F11** to the window's full screen, as today. No key uses
Ctrl+Alt (AltGr on European layouts; some graphics drivers rotate the screen on Ctrl+Alt+arrows), Win, Alt+F4 or
Alt+Shift (Windows' layout switch). Punctuation keys match `event.code` (`Backquote`, `BracketLeft`, `Period`,
`Comma`, `Equal`, `Minus`) so ` [ ] . , = − work on non-US layouts; letters match `event.key`.
`tests/katana-keys.test.js` fails on a duplicate binding or a reserved combination.

## 5. Feature table

**Must** = K1–K6b (first Full Katana release). **Should** = K7–K8. **Later** = K9 on request. **Skip** = never.
How: **port** (logic from bloop, rewritten as a pure function), **rebuild** (bloop as reference), **new**.

| Feature | Pri | How | Size, phase |
|---|---|---|---|
| Four zones, top bar, splitter, status strip | must | new | M, K1 |
| Bin: MEDIA, BOARD with hover scrub sprites and + add | must | new | M, K1 |
| Chapters from beat roles + clip `source` in the hand-off | must | new | S, K1 |
| Schema with `groups`, `filterPreset`, `linkedTo`, `enabled`, `source`, chapters; round-trip test | must | port + fix | S, K1 |
| Magnetic V1, free overlay tracks, auto new track | must | rebuild | M, K2 |
| Linkage (`linkedTo`, Alt to free) | must | new | M, K2 |
| Snap (sorted index), split rules, Q/W, trim clamps, ripple | must | port | M, K2 |
| Op-patch history (one entry per drag), `history[0]` kept | must | rebuild | S, K2 |
| Autosave: queued save, flush on close, 409 merge by op replay | must | port + fix | S, K2 |
| Markers, I/O, enable/disable, group, copy/paste | must | port | M, K2 |
| Virtual lanes, filmstrip tiles, minimap, log zoom | must | rebuild | L, K2b |
| Story spine, chapter moves | must | new | M, K2b |
| Versions sheet (auto + named) | must | new | S, K2b |
| Re-take this shot + Swap (opens the card; never queues a render) | must | new | M, K2b |
| One clock, decoder pool of 8, canvas renderer | must | rebuild | L, K3 |
| Titles: SDF text in the compositor, shared by preview and export (07-fx §1.3) | must | rebuild | M, K3 |
| Transform handles and guides | must | rebuild | M, K3 |
| Proxies that build themselves, preview quality | must | new | M, K3 |
| Preview axis (hover skim on the timeline) | must | new | S, K3 |
| Waveforms from cached peaks, buses A1–A3, meters, LUFS | must | port + new | M, K4 |
| Volume keyframes, fades, ducking under measured lines, loudness | must | port | M, K4 |
| Beat ticks + snap to beats | must | new | S, K4 |
| Record voice-over | must | new | S, K4 |
| Segment export, resume (the person's press), windowed mix, disk preflight | must | rebuild | L, K5 |
| Export sheet: preset, quality, fps, mp4 + wav, size estimate | must | new | M, K5 |
| Chapter metadata, `-chapters.txt`, `.srt` beside every export | must | new | S, K5 |
| Shapes 16:9 / 9:16 / 1:1 with static crop | must | port (Mini P6) | S, K5 |
| Katana FX: 30 transitions, 15 effects, 8 looks, 14 text animations, 8 titles, effects browser (07-fx) | must | new | FX2–FX3, K6 |
| Beat effects, the Director's FX ops | should | new | FX4, after K4 / with K8 |
| In / Out / Combo animations; text Loop; text templates | must | port + new | M, K6 |
| Motion keyframes (position, scale, rotation, opacity) | must | rebuild | M, K6 |
| Constant speed 0.25–4×, freeze frame 3 s, reverse ≤ 20 s, mirror, rotate, crop | must | port | M, K6 |
| One-LUT grade, looks, curves, **Apply the look**, **Match to the board still**, .cube import | must | new | L, K6 |
| Moving crops (keyframed per shape) | must | new | S, K6 |
| Script tab, **Caption all lines**, caption editor, **Delete line** | must | new | M, K6b |
| Local Whisper (whisper.cpp, on request) for word times and footage without a script | should | new | M, K7 |
| Line check (`LINE_MISSED`, `LINE_CHANGED`, `LINE_SQUEEZED`) | should | new | S, K7 |
| Ask bar, Cut to the music (`beat-fit.js`) | should | new | M on K8's Director work |
| Speed curves (preset names our own, not CapCut's) | later | rebuild | M |
| Chroma key (`chromakey` + `despill`), adjustment layer, noise reduction (`afftdn`) | later | port | M |
| Masks (rectangle, circle first), HSL, wheels | later | port | M |
| Compound clips, bilingual captions, transcript cut, third-party effect sets (07-fx FX5) | later | new | M–L |
| webm / mov / gif, `cut.edl` | later | new | S each |
| AI cutout via a trusted ComfyUI workflow (e.g. BiRefNet, MIT code and weights; the custom node's licence is checked too, some are GPL). GPU render on the person's press only, with the queue's usual readout | later | new | L |
| Stabilise (`vidstab` GPL), vocal isolation (large model), stickers, whole-video templates, TTS in Katana, share buttons, copyright check, cloud drafts, collaboration | skip | — | — |
| Watermark, ending clip, Pro locks | skip, never | — | — |

## 6. Where Katana beats CapCut

1. **Free and local, said on the sheet.** No watermark, no ending clip, no Pro lock, no upload, no telemetry.
   CapCut moved effects, 1080p and AI tools behind Pro (2025) and its terms license uploaded content. (K1–K5)
2. **What you see is what exports.** One clock, one compositor (07-fx) for every picture, one envelope. A rendered-frame test
   checks preview and export agree. CapCut has a help page for edits that do not match the preview. (K3, K5, K6)
3. **Two-hour films that finish.** Virtual lanes at 1,800 clips, proxies, segment export with **Resume from
   segment 37** (a press; never by itself), honest size and disk numbers before the press. (K2b, K3, K5)
4. **Story spine.** Chapters from the plan's beat roles. Move the turn, not 14 clips. (K1, K2b)
5. **Captions from the script.** Exact words and speaker names from the board, no AI needed. Whisper only for
   word times and footage without a script, on the PC. (K6b, K7)
6. **Line check.** Did the generated clip say the line? Flags missed, changed and squeezed lines. (K7)
7. **Re-take this shot.** Back to the card that made it, then **Swap** keeps the in-point and length. Nothing
   renders until the person presses Generate on that card. (K2b)
8. **Beat cuts that never cut a line**, faster toward the climax because the roles are known. (K4, K8)
9. **One project, three shapes**, with crops that move. Fix a cut once; every shape gets it. (K5, K6)
10. **The look as a matched grade.** Starts from the board's look note; **Match to the board still** fixes the
    colour drift AI clips have from beat to beat. (K6)
11. **Sound in three buses**, mixed to a LUFS target you can read, ducked under measured lines. (K4)
12. **Versions** without copies: before every Director turn, every export, and on Ctrl+S. (K2b)
13. **The Ask bar** edits for story from measured numbers, respects the person's edits, undoes in one press. (K8)

## 7. Performance plan (target: 2 h, 700–1,800 clips, 60 fps playhead)

**Budgets.** Open a 2 h project ≤ 2 s to first frame. Scroll and zoom at 60 fps. Playhead never drops a frame
from timeline work (≤ 4 ms main-thread per frame). Memory ≤ 1.5 GB for the page with 8 decoders.

- **State.** `Alpine.store('katana')` holds the timeline as raw, non-reactive data (`Alpine.raw`); only
  selection, panel flags and a `rev` counter are reactive. Views re-read on `rev`. The playhead time is never
  reactive: the clock writes one CSS variable (`--kt-playhead-x`) and the timecode text node per frame.
- **Clock.** `src/shared/katana/clock.js`: frame-quantised time (fps from the project), used by preview, scrub,
  the export planner and `segments.js`. The preview drives media from it; drift > 1 frame re-seeks one element.
- **Decoder pool.** 8 `<video>` elements, least-recently-used; the next clip on V1 is pre-seeked 1 s ahead.
  Overlays take pool slots; beyond 8 visible sources the preview drops the lowest overlay and shows "Preview
  simplified" (export unaffected).
- **Virtual lanes.** Clips are indexed per track in a sorted array of starts; the view renders only clips in the
  visible range plus one screen each side (≈ 80 nodes max, caption clips on T1 included), positioned by
  `transform: translateX`. Nodes are recycled. Zoom changes recompute x on a rAF, never per mouse event.
- **Everything long is virtual or canvas.** Beat ticks, markers, chapter seams and the minimap are canvas. Spine
  plates, the bin grid (1,800 takes) and the SCRIPT list (1,500 lines) render only rows in view. DOM budget for
  the whole page at 2 h: ≤ 1,500 elements (the K2b check counts them).
- **Filmstrips.** Tiles by (take, zoom bucket, tile index) from capped sprite calls (`fps,scale=-1:48,tile`, `-t`
  and `-fs`) on the tools queue at below-normal priority, behind exports. Stored in `media/katana/cache/`,
  keyed by sha1 of path + mtime. Only visible tiles are requested; a newer view drops older pending requests, so
  a fast scroll across 2 h queues one screen, not hundreds. A seam-grey placeholder shows meanwhile ("Waiting for
  the export" while one runs). A 2 h film never thumbnails up front. In memory: an LRU of ≤ 300 `ImageBitmap`
  tiles (≈ 50 MB), `close()` on evict. On disk: cache and proxies share a cap (default 20 GB, LRU, owner
  question §10) with **Clear cache** in Settings › Video tools. Bin hover sprites (10 frames at 160 px) are made
  the first time a tile is in view, never for the whole bin.
- **Waveforms.** Peaks once per file (min/max per 10 ms) as a small binary file in the same cache; drawn per
  visible tile on canvas. Duck bands and volume lines drawn on the same tile.
- **Proxies.** Rule in `src/shared/katana/proxy-rule.js`: over 1080p, HEVC, ProRes, 10-bit, or long-GOP over 20
  min. 540p `h264_mf` software MFT (`hw_encoding` stays off, so no GPU memory is taken from ComfyUI), ~1.5
  Mbit/s, GOP 15, `-t` = source length, `-fs` set, tools queue, paused during an export.
  Stored in `media/katana/proxies/<sha1>.mp4`. Board clips (480p–720p H.264) need none. Export reads originals.
- **History.** Op patches with inverses; a drag is one entry. 200 steps, `history[0]` kept.
- **Save.** Debounced 1.5 s; one in flight, one queued; flushed on `beforeunload`. The 2 h timeline JSON
  (~1–2 MB) is gzipped for versions only. `JSON.stringify` of 2 MB is a 10–30 ms task, so it runs in
  `requestIdleCallback` and waits while playing (at most 10 s, or at pause). The K2b check measures it.
- **Snap.** Sorted targets, binary search, rebuilt per drag start.
- **Tests and checks.** `tests/katana-virtual-lanes.test.js` (visible range maths), a 1,800-clip fixture
  generator, and a K2b exit check in the real app: scroll, zoom and play at 60 fps measured with the
  Performance panel, no long task over 50 ms, ≤ 1,500 DOM elements, page memory ≤ 1.5 GB after 10 min of play.

## 8. What we port from bloop, what we rebuild, where it lands (every file ≤ 500 lines)

bloop's checkout is read only. Port means: read the logic, rewrite it as a pure function with tests.

**Port (logic):** DTO names in ms; revision lock with the "adopt the server revision on 409" lesson; snap maths
and the pixel threshold; ripple delta and the right-to-left delete order; split source-point maths and Q/W;
detach audio and freeze frame; the three trim clamps; volume envelope, `mergeOverlappingDuckRegions`, the
loudness table; the junction model and half-overlap crossfade timing (any Katana FX transition, 07-fx §6.1);
`animation-presets` as JSON and the per-row keyframe UX; `history[0]` protection; filmstrip tiles at the source's
aspect; peaks computed once.

**Rebuild:** store and clock; timeline view; preview and export pictures as one compositor (07-fx); magnetic track and linkage; split
field rules; markers and keyframes in source ms; op-patch history; autosave queue; proxies and hover scrub;
inspector partials; colour (one LUT); keymap; export (segments, resume).

**Drop:** `collaboration.js`; `remove-bg.js`, `ai-generate.js`, cloud TTS, translate and script calls in
`captions.js`; the DOM preview (`preview.js`, `preview-bridge.js`); seek-based reverse; GPL-backed features
(`eq` looks, `boxblur` oblique blur, `perspective` flip; glitch and page curl return as compositor shaders,
07-fx); spin, heart, star; the thumbnail POST
on every save; infinite CSS animations; `FFmpegRenderService.php` as code.

| Folder | Files (≈ lines) |
|---|---|
| `src/shared/katana/` | `schema.js` 300, `clock.js` 120, `timing.js` 200, `segments.js` 300, `envelope.js` 150, `ducking.js` 120, `loudness.js` 80, `grade.js` 250, `proxy-rule.js` 60, `snap.js` 150, `chapters.js` 150, `beat-fit.js` 200, `align.js` 200, `findings.js` 150, `keyframes.js` 250 (per-frame table; no `sendcmd`), `blend.js` 60, `keys.js` 150; `transitions.js` and `animations.json` give way to the effect sets in `public/fx/` and `fx/*` (07-fx) |
| `src/shared/katana/controls/` | The controls registry split per surface so no file passes 500 lines: `dock.js`, `bin.js`, `viewer.js`, `timeline.js`, `inspector.js`, `export.js`, `settings.js` (≤ 250 each); `src/shared/katana-controls.js` only merges them (~40) |
| `src/shared/katana/ops/` | `add` 120, `move` 200, `trim` 180, `split` 220, `ripple` 160, `remove` 140, `link` 150, `magnet` 150, `group` 120, `transition` 120, `swap-take` 100, `chapter` 150, `apply.js` 120 (op → patch + inverse) |
| `public/js/katana/` (pure) | `history.js` 150, `keymap.js` 200, `media-pool.js` 250, `virtual-lanes.js` 300, `tiles.js` 250, `peaks.js` 150, `hover-scrub.js` 100, `render/{handles 300, hit 150}.js`; `render/{canvas,layers,text,lut-gl}` are replaced by the compositor in `fx/` (07-fx) |
| `public/js/components/` (one Alpine component each) | `katana-store` 250, `katana-timeline` 400, `katana-tracks` 300, `katana-trim` 250, `katana-spine` 200, `katana-minimap` 120, `katana-preview` 300, `katana-transport` 200, `katana-inspector` 300, `katana-keyframes` 250, `katana-bin` 300, `katana-script` 300, `katana-versions` 150, `katana-export` 300, `katana-ask` 200, `katana-status` 120 |
| `src/server/katana/` | `handoff.js` 300, `import.js` 200, `projects-service.js` 250, `versions.js` 150, `take-bridge.js` 120, `proxies.js` 200, `tiles.js` 200, `peaks.js` 150, `export/*` stages ≤ 250 each, `speech/capped-whisper.js` 250 |
| `src/server/views/katana/` | `page.edge`, `topbar`, `bin/*` (one per tab), `viewer`, `inspector/*` (one per tab), `timeline/{toolbar,spine,ruler,tracks,minimap}`, `status`, `ask-bar`, `export-sheet`, `versions-sheet`, each ≤ 300 |
| `public/css/katana/` | `layout`, `bin`, `viewer`, `inspector`, `timeline`, `clips`, `spine`, `ask` — each ≤ 400, tokens only |

## 9. Local AI, licences and honesty

- **whisper.cpp** (MIT) with OpenAI Whisper weights (MIT): CPU build only (never fights ComfyUI for VRAM), 4
  threads, below-normal priority, on the tools queue. Default model `ggml-small-q5_1` (~190 MB), optional
  `ggml-base` (~142 MB) for slow PCs. Nothing ships in the installer: **Settings › Video tools › Speech model ›
  Download (190 MB)** is the person's press; sha256 pinned for model and binary, both fetched only from the
  pinned whisper.cpp release and its model repository. Licence check: whisper.cpp MIT, weights MIT (OpenAI's
  model card); the notice goes in the app's open-source list. Runner
  `src/server/katana/speech/capped-whisper.js`: timeout per minute of audio, 4 MB stdout cap. Audio goes out as
  16 kHz wav through the capped ffmpeg runner. OpenAI stays an opt-in with the "audio is sent to OpenAI" notice.
- **No other local model.** Beats, speech spans, loudness and "match to still" use bundled LGPL ffmpeg filters
  (`astats`, `silencedetect`, `ebur128`, `signalstats`) and JS. Cutout only through a trusted ComfyUI workflow.
- **Filters used (LGPL; confirm against the pinned build's `-filters` with the 05 §5.8 check before K6).** Since
  07-fx, Full Katana's pictures come from the compositor; ffmpeg only decodes, scales and encodes. Picture filters:
  `crop`, `scale`, `format`, `setpts`, `trim`, `concat`, `fps`, `tile`, `split`, `reverse`, `palettegen`,
  `paletteuse` (`xfade` stays for Mini's dissolve only; `lut3d`, `overlay`, `blend`, `colorchannelmixer`, `gblur`,
  `sendcmd`, `hflip`, `transpose`, `rotate` leave Full's export); sound: `atrim`, `atempo`, `asetrate`,
  `aresample`, `afade`, `volume`, `amix`, `areverse`; measure only: `loudnorm` (pass one), `ebur128`, `astats`,
  `silencedetect`, `signalstats`, `blackdetect`, `freezedetect`, `scdet`. The grade never chains colour filters:
  curves, levels, temperature and hue are baked into the one LUT by `grade.js`.
  **Never (GPL-only in ffmpeg's `configure`, `*_filter_deps="gpl"`, or a GPL library):** `eq`, `boxblur`,
  `smartblur`, `hqdn3d`, `perspective`, `colormatrix` (use `scale` / `colorspace`), `cropdetect` (no "find the
  black bars" with it), `blackframe` (use `blackdetect`), `mpdecimate`, `delogo`, `histeq`, `stereo3d`,
  `interlace`, `tinterlace`, `pullup`, `phase`, `kerndeint`, `mcdeint`, `pp`, `pp7`, `spp`, `fspp`, `uspp`,
  `owdenoise`, `vaguedenoiser`, `nnedi`, `sab`, `super2xsai`, `signature`, `repeatfields`, `find_rect`,
  `cover_rect`, `mptestsrc`, `frei0r`, `vidstab*`, `rubberband`; encoders `libx264`, `libx265`, `libxvid`.
  **Encoders:** `h264_mf` (software MFT), `aac_mf` (native `aac` only when `aac_mf` is missing), `pcm_s16le`,
  `mjpeg`, `png`, `gif`. The 05 §5.8 grep fails the build on any name in the Never list.
- **FX sources (07-fx §5.3, §6):** shaders are ours or adapted per file from gl-transitions (MIT; Page curl
  BSD-3), glfx.js, pixi-filters, glsl-film-grain and webgl-noise (all MIT); never Shadertoy, LYGIA, easings.net
  or other editors' presets. A licence gate and a grep fail the build otherwise.
- Every estimate says "estimated"; every missing measure says "Not measured".

## 10. Critic pass (2026-10-05)

Checked against ffmpeg's GPL list, `tokens.css`, `src/main/main.js` and the 500-line rule. Fixed in place:
- **Licence.** Full GPL filter list in §9. 05 §5.8 no longer plans a colour-filter chain (one LUT only). 05 §5 and
  01-core's `VENC` no longer name `aac` as the main encoder or `libx264` as a fallback.
- **Preview = export.** "Dissolve" is `xfade` `fade`, never `xfade`'s noise `dissolve`; blend limited to five
  modes; motion keyframes, animated titles, reverse preview, the colour matrix and loudness got one shared path
  each (04 §5).
- **2 h.** Segments by length (~60 s), not at every layer change (captions alone would make 3,000); sound mixed in
  windows of ≤ 5 min, so a blank project with no chapters never builds one 2 h `amix` (04 §5). DOM budget,
  canvas ticks, tile cancelling, bitmap and disk caps, idle saves (§7).
- **Keys.** Chapters off Alt+arrows; Ctrl+Y redo; Electron's default menu (Ctrl+R reload, page zoom, Ctrl+W)
  removed in K2; layout-safe matching (§4.4).
- **Contrast.** Orange lines on theme surfaces use `--accent-text`; clip labels and readouts `--text-secondary`;
  10 px minimum labels; beat ticks are sensor blue (§3).
- **Files.** The controls registry is split per surface (§8); every listed file stays ≤ 400 lines.
- **Copy.** CapCut and its preset names stay in docs; the banned-term test (05 §4.1) now covers "CapCut" in views,
  the registry, the guide and starters.

**Owner questions:**
1. **The app menu.** Removing Electron's default menu frees Ctrl+R, Ctrl+= and Ctrl+− for Katana (CapCut's keys)
   and stops Ctrl+R from reloading over unsaved edits, but it also removes page zoom everywhere, which some
   people use to read small text. **Recommendation:** remove it, and add **Settings › Appearance › Interface
   size** (90–150 %, `webContents.setZoomFactor`) so nobody loses large text.
2. **Proxies and filmstrips without a press.** They build by themselves (CPU only, below-normal priority, paused
   during exports) and can use disk: ~1.4 GB of proxies for 2 h of 4K or HEVC footage. **Recommendation:** keep
   them automatic, as CapCut does, with a 20 GB shared cap, LRU eviction, the size in the status strip and
   **Clear cache** in Settings.

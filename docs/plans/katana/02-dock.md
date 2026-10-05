# Katana 02 — Mini Katana UI: the Cut dock — COMPLETE (P1, P2, P5 on branch katana-mini; §13 is the P5 record)

Part of [../katana.md](../katana.md). Settled conflicts there win over this file.
The Cut dock is Mini Katana. It sits at the bottom of a Space board. The approved look is the mockup
`cut-canvas/project/Main.dc.html`. This file is UI only; routes, storage and export are in 01-core.md, the
Director's ops in 03-director.md. The dock only consumes them.

**Ported verbatim from bloop** (`spaces-mini-timeline/01-timeline.md` §3): the 32/44 px rail, the edit actions
table, dissolve limits, the A/B preview, 150 ms drift fix, the gap slate, 800 ms autosave + local draft + "adopt
the server revision on 409", the 8 s remove undo, a 50-step dock-only undo stack, the live region, and "no deep
watch on nodes".

**Adapted for local, and why:**
- Blade partials become Edge partials. `Alpine.data("SpaceCutDock")` becomes `CutDock`.
- bloop's `cutUpdate` presence whisper becomes the `cut` event on the existing SSE stream. No presence channel here.
- No feature flag. The dock ships when it is done.
- No 720p proxy and no server thumbnails. The preview plays the original file (Range/206 from P0). Filmstrip frames
  are captured in the browser.
- Open height is about 360 px, not bloop's 240 px. The mockup is the approved look.
- bloop shares the bottom row with a run strip and a minimap. Neither exists here, so the dock owns the row.
- "Show render queue" becomes the board's queue readout (`queueSummary()` in `public/js/board/generation.js`).
- "Offline" means the local server did not answer, not the internet.

## 1. Files

| File | Lines (est.) | What it holds |
|---|---|---|
| `src/server/views/pages/spaces/cut/dock.edge` | ~60 | `<section class="cut-dock" x-data="CutDock" aria-label="Cut">`, includes the parts below |
| `.../cut/rail.edge` | ~70 | stencil "Cut", readout (`6 of 7 beats · 0:47 · 1080p`), save chip, Undo/Redo, Fit, Pack assets, Open in Katana, **Export** (`ae-key--accent`), fold key |
| `.../cut/banner.edge` | ~50 | 409 / Director changed it / restore draft / not saved / replace offer (one at a time) |
| `.../cut/preview.edge` | ~70 | two stacked videos, gap slate, caption chip, the deck (`media-deck.edge` markup reused), selection meta |
| `.../cut/tracks.edge` | ~110 | ruler + beat ticks, Video / Voice / Music lanes, playhead |
| `.../cut/item.edge` | ~70 | one clip or gap: frames, tag, length, Director note, handles, status light |
| `.../cut/export-sheet.edge` | ~90 | preflight readout, export states, pack states |
| `public/js/components/cut-dock.js` | ~220 | `CutDock`: load, slots, fold, selection, edit actions, keys, live region |
| `public/js/components/cut-strip.js` | ~200 | `CutStrip`: scale, drag reorder, trim drag, frame capture, waveform bars |
| `public/js/components/cut-player.js` | ~230 | `CutPlayer`: A/B videos, dissolve, J/L, slate, gap mode |
| `public/js/components/cut-bed-sync.js` | ~120 | `CutBedSync` methods spread into `CutPlayer`: music/voice sync, pause on slates, duck envelope, fade, loudness gain (split out so `CutPlayer` stays well under 500) |
| `public/js/components/cut-history.js` | ~60 | `CutHistory` methods: undo/redo over item snapshots |
| `public/js/components/cut-persistence.js` | ~150 | `CutPersistence` methods: autosave, local draft, 409, retry |
| `public/css/cut.css` | ~230 | dock frame, rail, open/folded, banners, sheet, preview, states |
| `public/css/cut-tracks.css` | ~230 | ruler, lanes, clips, gaps, joins, handles, waveform, duck bands, playhead |

- `CutHistory` and `CutPersistence` are method modules spread into `CutDock`, the way `public/js/board/board.js`
  spreads `historyMethods`/`persistenceMethods`. `CutDock`, `CutStrip` and `CutPlayer` are each registered in
  `public/js/app.js` with `Alpine.data(...)`. One scope keeps one copy of the item state.
- `cut-history.js` reuses `createHistory()` from `public/js/board/history.js` as its own instance. Commands are
  snapshots `{ label, undo: () => apply(before), redo: () => apply(after) }`. At 50 items a snapshot is cheap.
- Timing from `src/shared/cut-clock.js`, limits from `src/shared/cut-rules.js`. Duck windows and beat ticks come
  computed from `GET /spaces/:id/cut` (`ducks`, `beats_ms`), so the dock never derives them itself.
- `editor.edge` includes `pages/spaces/cut/dock` inside `.board-page`, after `.board`, nested in the `SpaceBoard`
  scope so it can call `bringIntoView(node)`, `selectCard` and a new `askDirector()`. It is **not** inside
  `.board__world`, so the board transform never repaints it.

## 2. Layout: folded rail vs open

- `.board-page` rows become `auto minmax(0,1fr) auto`. The dock is row 3, so the board gets shorter and no card is covered.
- **Folded (default):** a 32 px rail (44 px under `pointer: coarse`): `Cut · 6 of 7 beats · 0:47 · Saved`, Play,
  Open in Katana, the unfold key. The body is removed with `x-if`, so no `<video>` stays alive.
- **First draft opens it once.** The first time a draft lands (Director or Fill), the dock opens by itself, then
  the person's fold choice is remembered per space in `localStorage` (`bloop-studio:cut-open:{spaceId}`, try/catch).
- **Open:** about 360 px. Rail 40 px, then a body grid: preview `clamp(16rem, 30%, 25rem)` and tracks
  `minmax(0,1fr)`. Track heights follow the mockup: Video 84, Voice 34, Music 56 px, labels 72 px.
- **Director panel:** `.director` stays absolute on the right (`public/css/director.css`). While it is open the dock
  gets `margin-right: calc(var(--director-width) + 2 * var(--space-3))`, so the dock ends where the panel starts.
  `director.css` switches its `26rem` to `--director-width`.
- **Narrow (< 48rem since P5; was 40rem):** the Director is a 60 vh bottom sheet; the dock opens as a 60 vh sheet too. Only one is open
  at a time. Tracks scroll sideways with snap. Trim uses the item sheet (two-handle range, ±0.1 s keys).
- `.toasts` (`public/css/board.css`) moves up by the dock height: `.board-page:has(.cut-dock.is-open) .toasts`.

## 3. Tokens

Everything uses `tokens.css`/`mecha.css`: `--accent` (playhead, selected edge, handles, Export), `--ink-on-accent`,
`--sensor`/`--sensor-text` (Director notes, duck bands, rendering, saving), `--ae-seam*` (hatched gaps, joins,
rulers), `--ae-stencil-ink`, `--media-ground`, `--media-scrim-deck`, `--media-chip`, `--on-media`,
`--status-alert-text`/`--status-warn-text`, `--duration-*`, `--ease-out`. Hatch and duck tints are `color-mix()`
of existing tokens. New layout tokens, no new colours: `--director-width: 26rem`, `--cut-rail: 2rem`,
`--cut-rail-coarse: 2.75rem`, `--cut-open: 22.5rem`, `--cut-label: 4.5rem`, `--cut-video-h: 5.25rem`,
`--cut-voice-h: 2.125rem`, `--cut-music-h: 3.5rem`, `--cut-item-min: 4rem`, `--touch-min: 2.75rem`.

## 4. The tracks

- **Scale:** linear px per second. **Fit** fills the lane, but never below the scale where the shortest clip is
  `--cut-item-min`; past that the lanes scroll sideways. Ruler and playhead use the same scale.
- **Video lane:** one item per beat in beat order. A clip shows up to 4 frames (1 when narrower than 96 px), the
  beat tag, the length and a Director note (sensor dot + text, e.g. "Trimmed −1.5 s"). A person's edit clears it.
- **Gap:** a hatched slot the size of the beat's planned length, "04 · Flashback / not rendered", **Go to card**.
  Go to card calls `bringIntoView(node)`, selects the card and rings its Generate key for 1.6 s (static under
  reduced motion). It never renders anything. The readout shows both lengths: "0:47 to export · 0:55 with gaps".
- **Join chips** on each junction: `|` for a cut, `0.5` for a dissolve (orange edge), a J/L mark when `audio_ms` is set.
- **Voice lane:** the voice bed card at its start point. Once the Director's analysis records speech spans, they
  show read-only as dialogue spans ("In clips", the mockup's `MIRA: …` lines).
- **Music lane:** the bed's waveform, duck bands (sensor tint, dashed top) and the level readout (`−12 dB`).
- **Waveform:** reuse `reduceTrack()` from `public/js/components/audio-player.js` with a new optional `bars`
  argument (default 80, so the card player is unchanged). The dock asks for `laneWidth / 6` bars, cached by media
  path, drawn as **one SVG path**.
- **Beat ticks:** small sensor-blue ticks (`--sensor`) on the ruler from `beats_ms` (measured data; orange stays for the playhead). Empty until P4 analysis fills it.

## 5. States

| State | What the person sees | Way forward |
|---|---|---|
| No video cards | "No clips yet. Render a beat's video card and it lands here." | **Ask the Director** (opens the panel, focuses the box) |
| Plan, nothing rendered | All gaps, "0 of 7 beats rendered" | Go to card on each gap |
| All rendered, cut empty | "All 7 beats are rendered." | **Fill the cut** (`POST /spaces/:id/cut/draft`) |
| Replace offered (`cut` event, `offer: 'replace'`) | "A fresh draft in beat order is ready to replace this cut." | **Replace my cut** / **Keep mine** |
| Loading | Skeleton items sized from the known lengths | — |
| Load error | "Could not load the cut. The board still works." | **Retry** |
| Rendering beat | Blue status light in its slot, from node SSE | — |
| Render failed | "05 · render failed" | Go to card |
| Card deleted | "Card deleted" | **Remove from cut** |
| New take | `New take` badge, pinned take kept | **Use new take** (trim clamped; "Trim reset to fit the new take") |
| Clip will not play | "Could not play this clip"; the preview skips it | Go to card |
| Saving / saved | Chip `Saving…` (sensor), then `Saved` | — |
| Not saved | Chip `Not saved, kept on this device` (alert) | **Retry**; auto retry at 2, 5, 15 s |
| 409 | "This cut changed in another window." | **Use the newer version** / **Keep mine** |
| Director changed it, dock dirty | "The Director changed the cut." | same two keys |
| Draft found on load | "Restore unsaved changes?" | **Restore** / **Discard** |
| Export preflight | Sheet: beats in, gaps skipped, length, size, cap, loudness set or not | **Export** / Close |
| Unsaved changes at Export | "The latest changes are not saved yet." (the sheet flushes first) | **Retry** / Close |
| Export unavailable | Reason from preflight (e.g. the video tools are missing, the encoder is missing) | **Open Settings › Video tools** |
| Waiting for the slot | "Waiting for another export to finish" (a Full Katana export or a pack holds the one slot) | **Cancel** |
| Exporting | Step text + `.ae-level` (sensor), e.g. "Joining clip 4 of 6" | **Cancel** |
| Export done | "Your cut is ready · 0:47 · 38 MB, saved to your media folder" | **Show in folder** / **Show on board** / **Open in Katana** |
| Export stale | "This export is from an older version of the cut." | **Export again** |
| Failed at one clip | "The export stopped at 04 · Flashback. That clip could not be read." | **Remove it and export again** / Go to card / **Try again** |
| Failed on limits | "The cut is 12 minutes. The limit is 10." | Close (edit the cut) |
| Failed, timed out / app closed / cancelled | Plain reason, "Nothing was saved." | **Try again** |
| Packing / packed / pack failed | Level, then "Packed 14 files"; or the plain reason (disk full, file missing) | **Show in folder** / **Try again** |
| Undo turn no longer on top | The rail's "Undo turn" goes away; the live region says "Later edits came after the Director's turn." | Ctrl+Z steps back through them one by one |
| Analysis missing (no video tools) | Beat ticks and dialogue spans stay empty; a muted line "Not measured" on the Music lane | **Open Settings › Video tools** |

## 6. Edit actions (all undoable, all autosave)

| Action | Mouse | Keyboard (focus in dock) | Touch |
|---|---|---|---|
| Select | click | Tab into the strip, then ←/→ | tap |
| Reorder | drag (6 px threshold, auto-scroll at edges) | Alt+←/→ | long-press 300 ms, drag; or Move in the item sheet |
| Trim | drag the orange handles; time shows while dragging | `[` / `]` set in/out at the playhead; Shift+←/→ nudge 0.1 s | item sheet range, ±0.1 s keys |
| Remove from cut | Delete key or item menu | Delete / Backspace | item sheet |
| Join | click the chip (cut ↔ dissolve) | D on the focused chip | tap the chip |
| Clip sound | item menu | M | item sheet |
| Play / pause | deck key | Space | deck key |
| Undo / redo | rail keys | Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | rail keys |

- Remove never deletes the board card. The rail shows "Removed 04 · Flashback from the cut · **Undo**" for 8 s.
- A drag updates only local state each frame and pushes **one** history command on pointerup.
- **Touch:** handles are 44 px hit areas that hang outside the clip, so they never cover the clip's own tap area.
  A clip narrower than 2 × `--touch-min` shows no handles under `pointer: coarse`; a tap opens the item sheet,
  where trim is the two-handle range with ±0.1 s keys. `touch-action: pan-x` on the lanes, `none` on a handle
  while dragging, so a trim never scrolls the board. Long-press shows a visible lift before the drag starts.
- A Director turn arrives as one **Undo Director edit** command (03-director.md §3), shown in the rail as "Undo turn".
- **Key scoping:** `onKeyDown` in `public/js/board/cards.js` runs on `@keydown.window`. It must return early when
  `event.target.closest('.cut-dock')`, or Ctrl+Z and Delete would also act on the board. Space in the dock plays;
  it must not set `spaceHeld`.

## 7. Preview player (`CutPlayer`)

- Reuses `fmtTime`, `readVolume`, `saveVolume` and the deck markup (`media-deck.edge`, `public/css/player.css`).
  `MediaPlayer` itself is unchanged.
- Two stacked `<video>`s, A and B, `playsinline`, `preload="auto"` only while open. B loads the next item and
  seeks to its `in` while A plays.
- At `out` the player swaps A and B. A **dissolve** starts B at `out − d`, opacity 0→1 over `d`
  (`--cut-dissolve`), A's sound fading out. Under `prefers-reduced-motion` it is a hard cut at the junction
  midpoint; the export keeps the dissolve. J/L offsets shift which clip's sound plays across the junction.
- **Gap slate:** "04 · Flashback not rendered" on `--media-ground`, the planned length, timed by a rAF clock.
- **One time on screen.** Ruler, playhead cap, counter and lanes all use the same map from `cutClock`
  (01-core.md §5). Default is **with gaps** (board time, as the mockup draws it). Beds and duck bands are placed in
  export time, so the Music and Voice lanes draw the same hatched pause under each gap, and the bed pauses while a
  slate plays. A rail toggle **As exported** hides the gaps; then every number equals the export. The counter's
  total always names its mode ("0:47 as exported" / "0:55 with gaps"). The mockup's "0:19.4 / 0:47.2" mixes the
  two and is corrected in P5.
- **Out points use `requestVideoFrameCallback`**, not `timeupdate` (250 ms steps), so a swap lands within a frame.
- **J/L preview:** over a J window, B plays from `in − |audio_ms|` hidden under A with B's sound on and A's sound
  off; at A's out, B is shown (already playing). An L does the mirror with A playing on, hidden. Two video
  elements are enough because J/L only sits on a cut join (01-core.md §2).
- **Fades and loudness:** the bed fade starts at `fadeStart()`; the master gain uses the export's linear loudness
  gain (01-core.md §5), so the preview level matches the file.
- **Captions** (P6, 05 §5.5): **Captions** under the preview shows the script's lines at the measured spoken spans in
  the burned-in look (the cues of `cut-captions.js`); with Burned in, the export overlays the same captions, drawn
  in the page as PNGs, and writes an .srt beside every file.
- **Music and voice:** one `<audio>` each. They seek on play, seek and item change. Every 250 ms, if
  `|audio.currentTime − expected| > 0.15 s`, the player resets `currentTime`. Ducking ramps `music.volume` toward
  `level × 10^(db/20)` over the windows from `ducks`.
- **Clip sound off** mutes that item. **Master clock:** the playing video's `currentTime` through `cut-clock.js`;
  the rAF clock during a slate.

## 8. Autosave (`CutPersistence`)

- `PUT /spaces/:id/cut` (CSRF header, `revision`) 800 ms after the last change. Flush on
  `visibilitychange`/`pagehide` with `fetch(…, { keepalive: true })`.
- Every change is also written to `localStorage` `bloop-studio:cut:{spaceId}` as `{ revision, items, at }`, in try/catch.
- On load, a newer, different draft shows the restore banner.
- **On 409 the client takes the server's `revision` in the same step.** "Keep mine" then saves on top at once. A
  test pins "the save after a conflict succeeds".
- A change made while a save is in flight is saved again after it, as in `public/js/board/persistence.js`.

## 9. Where the board's events feed the dock

One EventSource per board (`initGeneration()` in `public/js/board/generation.js`). No new stream, no polling.
- `node` → `applyNodeUpdate` dispatches `board:node` `{nodeId, status, progress, media_path}`; the dock updates
  only that slot.
- `refreshBoard`/`refreshSoon` (`public/js/board/director.js`) and card add/delete dispatch `board:nodes`; the dock
  refetches `GET /spaces/:id/cut`, debounced 300 ms. The server works out each beat's clip; the client never does.
- `cut` `{revision, by, changed[], offer}`: a clean dock reloads and rings the changed items in sensor blue for 2 s;
  a dirty dock shows the banner; `offer: 'replace'` shows the replace banner.
- `cut_export` drives the export and pack states.

## 10. Accessibility

- `<section aria-label="Cut">`. The fold key has `aria-expanded` and `aria-controls`.
- The strip is an `<ol>` of buttons, e.g. `aria-label="Beat 3, The letter, 7.5 seconds, dissolve in, selected"`.
  Join chips are buttons ("Join between beat 2 and 3: cut"). Handles are `role="slider"` with `aria-valuetext="In 0:01.4"`.
- One `aria-live="polite"` region: "Beat 3 moved to position 2", "Removed beat 4", "Saved", "The Director trimmed 3 clips".
- Focus uses the cut-control ring from `mecha.css` (`.ae-key:focus-visible`); items and chips get the same ring.
- Hit areas: 24 px minimum on desktop; `--touch-min` (44 px) under `pointer: coarse`. Nothing is hover-only.
- AA contrast from tokens; notes on frames sit on `--media-chip`.
- **Both themes.** The app has `data-theme` dark, light and system (`public/css/tokens.css`). P5 checks each:
  text 4.5:1 (orange text uses the accent text token, never `--accent` on a light ground), non-text 3:1 for the
  playhead, handles, join chips, clip edges, the hatch on gaps, duck bands and the focus ring, against the lane
  ground in that theme. Hatch and duck `color-mix()` values are checked per theme, not assumed. Notes on frames
  stay on `--media-chip` with `--on-media` in both themes (media is dark in both). Status is never colour only:
  gaps say "not rendered", ducks show a dashed top, the Director note has a dot and words.
- Reduced motion: no dissolve, no ring pulse, no sensor runner, no smooth scroll.

## 11. Performance (the board must not lag)

- No `$watch` or `x-effect` reads `nodes`. The dock holds a plain slot array (≤ 50) changed only by the events above.
- The playhead moves by rAF writing one CSS variable (`--cut-x`) on one element. The time readout updates at 10 Hz.
- Frames are captured by **one** hidden video, one clip at a time, in `requestIdleCallback`, cached as blob URLs
  by `media_path + in`, only for items on screen.
- The waveform is decoded once per bed; `reduceTrack` runs once per lane width.
- The folded dock has no videos, no audio and no frames.
- Blob URLs are revoked when an item leaves the cut or the dock folds; the frame cache is capped at 200 frames
  (least recently used out). The waveform decode runs once and is skipped for beds over 600 s (the cap); the
  dock then asks `GET /spaces/:id/cut` for the server's cached peaks instead of decoding a long file in the page.
- A `node` event for a card that is not in a slot is ignored in O(1) (a `Map` by node id), so a busy build
  streaming progress for 300 cards does no dock work.
- Budget: at most ~400 extra DOM nodes. Board pan and zoom stay at 60 fps with the dock open on a 300-card board
  (Performance-marks check in P5).

## 12. Tests (`node --test`, temp SQLite, fake services)

- Range/206 on `/media` (P0).
- Cut save with 409, then a successful save.
- Snapshot undo/redo; one Director turn is one undo step.
- `cut-clock` fixtures shared with the export.
- Key scoping: Ctrl+Z in the dock does not reach board history.
- Gap mode: with gaps, a 3 s slate holds the bed clock; as exported, the playhead total equals `cutClock` export total.
- Slot update from a fake `node` event; reload vs banner on a fake `cut` event.

## 13. As built (P5, 2026-10-05, katana-mini)

- [x] **P2b follow-ups.** Cancel all stops only `jobs.origin = 'render-plan'` (`011_job_origin.sql`; the rail key shows
  while such renders are in the board's `queue` stream). `settings.left_out` (card + take, `cut-edits.js leftOutAfter`)
  keeps a clip taken out on purpose out of Add new clips and the live cut. Bring my clips: a failed copy deletes its
  empty Upload card; the cards are one board undo step ("Bring 3 files"); two or more songs: **Use as music** per song or
  **No song**, the pick is one dock undo step. A card's DELETE answers `{takes}` and restore puts them back (the board's
  undo used to lose a clip's take). The preview tag follows the clip on screen. The CSP console error came from the
  board marquee (`:style="marquee && {…}"` gave Alpine null; since Phase 1a, 93cb4f6); a test checks every `:style`.
- [x] **ffmpeg licence and dev path.** `COPYING.GPLv3` (gnu.org `gpl-3.0.txt`, pinned sha256) beside `LICENSE.txt`;
  notices carry both; the installer build refuses without them. `locateFfmpeg()` finds `<repo>/vendor/ffmpeg` in dev.
- [x] **Contrast (§10).** `scripts/katana-contrast.mjs` resolves the tokens (light-dark, var, color-mix with premultiplied
  alpha) and checks 40 pairs per theme. Before: 22 of 74 failed (light playhead and handles 2.80, clip edge 1.69 / 2.06,
  hatch and ruler ticks 1.69 / 2.06, key hover text 3.81 / 4.40, media chip over a white frame 4.40, measuring line 4.50
  light). After: 80 of 80 (lowest 3.51 for marks, 4.76 for text). Token changes only (`--accent-mark`, `--cut-clip-edge`,
  `--cut-hatch`, `--cut-tick`, `--cut-wave`, a deeper light `--accent-text` #A8380A and `--sensor-text` #1D4ED8,
  `--media-chip` 0.6, key hover fill 14%); gap words on a solid patch; a dark keyline round the crop box.
- [x] **Narrow and touch (§2, §6).** Under 48rem: the 60 dvh sheet, one of dock and Director, lanes with scroll snap; a tap
  opens the item sheet (Trim: a slider per end, one undo step per drag, snapped to 0.1 s; −0.1 s / +0.1 s; Done). In the
  browser pane at 375×812 with touch: 42 dock controls and 13 export-sheet controls, none under 44 px.
- [x] **Performance (§11).** Electron 44 (the app's Chromium) offscreen at 60 fps on a throwaway server: 300 cards, a
  50-item cut over a bed; fold/open ×3, play 6 s, a real mouse trim drag, wheel zoom with the dock open and folded
  (scratchpad `p5/gate/perf-main.cjs`; the browser pane was hidden and ran no frames). Before (2 clean runs): 2,593 dock
  nodes; open 104–161 ms press to two frames; fold-open 0 and 4 long tasks (max 61 ms), trim 4 and 7 (max 54 / 58 ms).
  After (5 runs): 1,542 dock nodes; open 46–80 ms (the lanes land one task later); **0 long tasks** in fold-open, play
  (360 frames in 6 s), trim and wheel-with-dock-open. Wheel with the dock folded still shows the board's own zoom tasks
  (up to 106 ms), so it is not the dock's. How: `cut-patch.js` patches `cutItems` and the ruler in place during a drag;
  minor ticks are one gradient; rare clip parts render under one x-if each; lanes render one task after the preview;
  `cutPart` searches inside the dock. Found on the way: the out handle sat under the next clip's join chip (fixed).
- [x] **bloop 04-qa.md.** `tests/katana-qa.test.js`: undo/redo 20-step script and the 50 cap, debounce (one PUT
  800 ms after 10 changes), remove + undo in place, no new poll, plain words, every state's way forward, status in words.
  Look check (scratchpad `p5/gate/look-main.cjs`, Electron, 1440×900 and 390×844 with touch, light and dark, reduced
  motion): painted-stack text contrast with the dead-token control (fails at 1.0:1 as it must), page width, clipped text,
  hit targets (24 px desktop, 44 px touch), running animations, toast and Director overlap. It found and P5 fixed: Check
  your cut 4.13:1 (dark), a picked preset's note 4.39:1 (light), the deck's seek bar 14 px, volume 20 px and Snap to beats
  18 px. Two clean runs after: 58–73 text nodes per view, lowest 5.93:1 light / 6.24:1 dark, 0 problems.
- Not done: the clean-PC export run (owner, needs a second PC); a real phone (a headless touch PASS is not a phone).

## 14. Final gate (2026-10-05, katana-mini; the record is in [../katana.md](../katana.md) "Final gate")

- [x] A cut of only missing beats (a starter, nothing rendered) showed the gap slate and "No clips yet" on top of each
  other in the preview. The empty line now shows only while no slate is up (`cut/preview.edge`).
- [x] Under 48rem the rail scrolls sideways (P5), which left **Export** and the fold key off the right edge at 390 px
  with no sign they were there. They sit in `.cut-rail__end`, pinned to the right edge (`position: sticky`, the dock's
  ground behind them) while the rest of the rail scrolls under them; on a wide window nothing moves.
- Test: `tests/cut-final-gate-view.test.js`.

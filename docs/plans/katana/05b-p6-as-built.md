# Katana 05b — P6 outputs as built (moved from 05-irresistible.md §5.5) — COMPLETE

The planned design of shapes, captions and the preview GIF is in [05-irresistible.md](05-irresistible.md) §5.4–§5.6.
This file keeps the build and gate records of P6, so 05 stays under the 500-line rule (moved at the final gate).

**Dock side, as built (P6 frontend).** Shape (under the preview, per viewer and space) frames each preview video
with `src/shared/cut-frame-edit.js` `previewFrame` on `cut-frame.js` `fitFor`/`cropBox` (CSS percentages, so any
preview size shows the export's pixels; a real 9:16 export frame matched the shared box at SSIM 0.98 / PSNR 39.9 dB,
a 7 px shifted box 0.50). Crop opens CutReframe (`public/js/components/cut-reframe.js`, `crop-box.edge`): the whole
clip with the greyed outside, drag anywhere, corner / pinch / wheel zoom 1–3×, arrows 2 % (Shift 10 %), Home centres,
Enter or Escape close; one undo step per drag, key or wheel run; a new selection moves the box, Play closes it. Soft
bars in the preview: the playing clip drawn on a 32 × 18 canvas, scaled up, CSS-blurred and dimmed. Captions: the
preview plate (Inter 700, `--media-scrim-deck`, orange cut, `CAPTION_SAFE` line, container units) and the PNGs
(`public/js/cut/caption-render.js`, 52 px at the 1080 px reference, one per server cue id, sent as
`captions: {mode, images: [{id, png, width, height}]}`). The sheet (`cut-outputs.js`, `export-outputs.edge`):
the five presets, the length hint, Shapes as checkboxes with one line per file, Fit with soft bars with the
server's measured blow-up (`/cut/preflight?shapes=`), Captions Off / Burned in, Preview GIF (on by default), and
one job per press ("File 2 of 3 · 9:16", then each file with Show in folder / Copy path). Tests:
`tests/cut-frame-edit.test.js`, `tests/cut-shape-view.test.js`.

**Backend, as built (P6).** Shared rules: `src/shared/cut-frame.js` (`cropBox`, `fitFor`: the cut's own shape
unframed keeps P3's fit; another shape crops centred; soft bars when `outputs.soft_bars` and a centred crop blows up
past 2×, or `frame[shape].fit = 'bars'`; `checkFrame`, `cleanFrame`), `src/shared/cut-captions.js` (script lines
without tags, 32-character wrap, two lines a cue, three a clip, 50 a cut, one line per measured span when they
match, else spread by length; `toSrt` CRLF; `placeCaption` from the 1080 px reference above `CAPTION_SAFE`),
`export-presets.js` (TikTok/Reels/Shorts, `outputsFor`: one file per shape, the preset's own first, any other shape
a Master of that shape; `lengthHint` with `LIMITS_CHECKED_ON`), `cut-rules.js` `checkOutputs` and the item's
`frame` (moving a box is not an edit for the lock). Server: `cut/captions-plan.js` (cues from script cards +
measured speech + `caption_text` fixes; default on only when the clip's script card and a voice card are both wired
into it), `cut/export/outputs.js` (press choices, caption PNG intake: one per cue, PNG, ≤ 200 KB, ≤ 2000 × 600,
written to `.cut-tmp/captions-<group>` and swept when the group's last row ends; the readout with the measured
blow-up), `frame-chain.js` (fit / `crop=w:h:x:y,scale` / soft bars `split`, quarter-size `scale`+`crop`,
`gblur=sigma=10`, `colorchannelmixer` ×0.55, `overlay`; caption PNGs as single-frame inputs held by `overlay` with
`enable='between(t,a,b)'`, so no `-loop`), `extras.js` (PrepareCaptions, SideFiles: `.srt` every time there are
lines, GIF `fps=12,scale` 480 long side, `palettegen`/`paletteuse`, `-fs 8M`, one 360 px / 10 fps retry, never fails
the export), `010_cut_export_shapes.sql` (`variant`, `group_id`), group cancel, idempotent press per shape and
choices. `video-tools.js` reports `outputs` (per-output readiness and the plain reason). New runner rule: an input
`-loop` only as `-loop 1` on an image with its own `-t`. `drawtext`, `subtitles`, `boxblur` and `eq` never appear
(the build has `drawtext` and `subtitles`; we still draw captions as PNGs for our look and no font files).
**Gate (real LGPL ffmpeg, 3 real clips 864×480 / 1344×768 / 720×1280 24 fps, one dissolve, 3 captions):** one
press made TikTok 9:16, Master 16:9 and Master 1:1 in 11.6 s (3.6–4.0 s each); every file 11,500 ms on an
11,500 ms clock, 345 frames, h264 yuv420p 30 fps, AAC 48 kHz; captions on at 1.5 s (plate edge RGB 251,115,45) and
off between lines; GIFs 270×480 / 480×270 / 480×480, 72 frames, 3.2–5.9 MB; `.srt` beside each; event loop max
24.7 ms; the same press again returned the same rows; soft bars (Reels) 3.3 s. **It caught a P3 bug:** the per-step
`-fs` cap was 2 MB a second, and a 0.5 s 1080p dissolve junction is ~1.4 MB, so `-fs` cut it at 1 MB with no
error and the 16:9 file came out 3 frames short (342). Every step cap now has a 16 MB floor. Tests:
`tests/cut-frame.test.js`, `tests/cut-captions.test.js`, `tests/export-presets.test.js`,
`tests/cut-export-shapes.test.js`, `tests/director-outputs.test.js`, `tests/capped-ffmpeg.test.js`.

**Joint gate (2026-10-05, the real dock in the browser pane, the real server on throwaway folders, the bundled LGPL
ffmpeg; 3 real clips 864×480 25 fps, 864×480 24 fps, 720×1280 24 fps, each with its script and voice cards wired
in, one dissolve).** Presses from the sheet: Reels + 16:9 with captions and GIF (one job, "File 1 of 2 · 9:16"),
then Master 1:1 with soft bars, then Reels 9:16 after moving clip 1's crop box to x = 0.2 with the arrow keys.
Every file: h264 yuv420p 30 fps, AAC 48 kHz stereo, 11,500 ms, 345 frames (1080×1920, 1920×1080, 1080×1080).
Captions: burned in at 1.5 s / 5.0 s / 8.3 s, absent between lines (3.8 s), in both shapes of the press; the
`.srt` holds the 3 cues (0.5–3.3 s, 4.3–6.9 s, 7.8–9.0 s). GIFs 270×480 / 480×270 / 480×480, 72 frames, 2.4–3.9 MB.
Soft bars: the sharp fit over the blurred, dimmed copy at 2.3× (the sheet said 2.3×). Preview against file: the live
preview video's on-screen box (crop 270×480 at x = 296.98 of 864) and a frame of the export scored SSIM 0.977 /
PSNR 43.1 dB, 7 source px off 0.75 / 0.71; with the moved box (x = 118.98, shared maths 118.8) 0.981 / 43.7 dB.
Same choices pressed again made byte-identical files. `.cut-tmp` empty after. **Loudness:** every file measured
−16.4 LUFS integrated, peak −1.5 dBFS: the Reels file asks −14 but the true-peak ceiling (−1.5 dBTP) caps the gain
(report `reached_lufs` −16.3, `capped: true`); gain only, no limiter, as P3 built it. **Fixed in the gate:**
Captions ignored the server's default (on when every captioned clip speaks its own script), so it always started
Off and the sheet never said why: `GET /spaces/:id/cut` now carries `captions {default_on, why_off}`, the dock
follows the person's choice else that default, the sheet shows `why_off` while Captions is off, and the "makes its
own sound" note shows only when it is true. A finished export kept the sheet on its done view forever, so after one
press the person could not reach the presets or shapes again: an ended export the person has seen now starts over
at the choices (its file stays on the board).

# Engine auto-detect and workflow variants — COMPLETE

Bloop Studio runs on more than one PC: an RX 7900 XTX (24 GB, ROCm) and an RTX 3080 Ti (12 GB, CUDA),
each with its own ComfyUI and its own model files. The app must pick the right workflow on each without
anyone editing JSON.

## Design

- `workflows/<id>.json` and `workflows/<id>.<variant>.json` share one preset `id`; each has a `variant`
  name and a `priority` (lower = preferred when several can run). Bindings, needs and card type must match
  across variants (tested), so a card renders on any machine.
- `src/server/generation/engine-check.js` derives what a variant needs from its graph: every node class,
  and every fixed dropdown value (model file, sampler, clip type…). Values the app writes at render time
  (bindings) are not checked. No hand-kept model lists.
- `src/server/services/engine-profile.js` caches the result per ComfyUI address for 5 minutes; *Re-detect*
  forces it. Offline: last profile of that address, else every preset's best variant unchecked.
- A preset's `knobs` names its table in `src/shared/formats.js` (e.g. `h3-int8`, `ltx`), so the card UI
  offers what that variant was tested at.

## Checklist

- [x] Variants: `bf16`/`int8` (Z-Image), `gguf`/`int8` (H3), `fp16` (Wan), `distilled-fp8` (LTX)
- [x] Variant picking from `/object_info`, cached per engine, re-detect button
- [x] Families without a runnable variant hidden from the card's model picker
- [x] Knob tables per variant (`h3-int8`, `ltx`), tested on 12 GB
- [x] Settings → *Workflows on this PC* with hardware and missing files
- [x] Takes record the variant
- [x] GPU name without the allocator suffix (`: cudaMallocAsync`, `: native`)
- [x] LTX-2.3 family (text, first frame, first → last frame)
- [x] Last frame socket on video cards; H3 and LTX first → last frame workflows
- [x] Clear error when a wired picture cannot be used by the chosen workflow

## Measured on the RTX 3080 Ti (12 GB, 32 GB RAM), 5 s clips

| Workflow | 480p | 768p / 720p |
|---|---|---|
| H3 int8, 4 steps | 65 s | 190 s |
| LTX-2.3 distilled, 8 sigmas | 55 s | 105 s |
| Z-Image int8, 1024² still | 10 s | — |

## Adding a variant for a new machine

1. Copy the closest `workflows/<id>.json` to `workflows/<id>.<variant>.json`; set `"variant"` and a `"priority"`.
2. Change only the loaders / model files (keep every `_meta.title` the bindings use).
3. If it needs different knobs, add a table to `src/shared/formats.js` and set `"knobs"`.
4. `node scripts/try-preset.mjs <id> "<prompt>"` renders it with the variant this ComfyUI picks.

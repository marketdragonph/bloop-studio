# Bloop Studio

An offline filmmaking board. Lay out a story as cards (text, pictures, clips), wire them together, and
render stills and video **with sound** on your own GPU through a local ComfyUI. Private project of
MarketDragon.

- [What you need](#what-you-need)
- [Install](#install)
- [Set up ComfyUI and models](#set-up-comfyui-and-models)
- [First run](#first-run)
- [Using the board](#using-the-board)
- [Which models your PC uses](#which-models-your-pc-uses)
- [Troubleshooting](#troubleshooting)
- [For developers](#for-developers)

## What you need

- Windows 10 or 11
- An NVIDIA (CUDA) or AMD (ROCm) GPU. Tested on an RTX 3080 Ti (12 GB) and an RX 7900 XTX (24 GB)
- 32 GB of RAM
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 0.38 or newer, running on the same PC
- Optional: a Claude or OpenAI API key for the Director (the chat that builds boards for you)

## Install

1. Get the latest `Bloop-Studio-Setup-<version>.exe` from your team.
2. Run it. You can choose the install folder; it adds Desktop and Start menu shortcuts.
3. To update, run a newer installer over the old one. Your boards, settings and renders are kept.

Versions are dates: `2026.1004.1530` was built on 4 October 2026 at 15:30.

## Set up ComfyUI and models

Bloop Studio sends every render to ComfyUI at `http://127.0.0.1:8188`. Start ComfyUI first, for example
`run_nvidia_gpu.bat` in the portable build.

You don't need every model. The app checks which models your ComfyUI has and offers only the model
families it can run. Install the files for the families you want, into ComfyUI's `models` folders.

### Images: Z-Image Turbo

| Folder | 12 GB cards (int8) | 24 GB cards (bf16) |
|---|---|---|
| `diffusion_models` | `z_image_turbo_int8_convrot.safetensors` | `z_image_turbo_bf16.safetensors` |
| `text_encoders` | `qwen_3_4b_fp8_mixed.safetensors` | `qwen_3_4b.safetensors` |
| `vae` | `ae.safetensors` | `ae.safetensors` |

Source: Hugging Face `Comfy-Org/z_image_turbo`.

### Video with sound: MiniMax-H3 Turbo

| Folder | 12 GB cards (int8) |
|---|---|
| `diffusion_models` | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` |
| `text_encoders` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` |
| `vae` | `minimax_h3_video_vae_int8_convrot.safetensors`, `minimax_h3_audio_vae_fp32.safetensors` |
| `loras` | `minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors` |

Source: Hugging Face `Comfy-Org/MiniMax-H3`. The 24 GB setup uses the GGUF build of H3 instead. Its exact
files and custom nodes are listed under **Settings → Engine** on a PC that lacks them.

### Video with sound: LTX-2.3 Distilled

| Folder | Files |
|---|---|
| `checkpoints` | `ltx-2.3-22b-distilled-fp8.safetensors` |
| `text_encoders` | `gemma_3_12B_it_fp4_mixed.safetensors` |

Source: Hugging Face `Lightricks/LTX-2.3`.

### Silent draft video: Wan 2.2 5B

| Folder | Files |
|---|---|
| `diffusion_models` | `wan2.2_ti2v_5B_fp16.safetensors` |
| `text_encoders` | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` |
| `vae` | `wan2.2_vae.safetensors` |

After adding models, restart ComfyUI, then press **Re-detect models** in Settings.

## First run

1. Open **Settings**.
2. **Engine**: check that the ComfyUI address is right and press **Test connection**. Under
   **Workflows on this PC** you'll see your GPU and, for each workflow, either **Ready** with the variant
   in use, or **Hidden · not installed** with the missing files listed.
3. **Media**: choose where renders are saved. The default is `Videos\Bloop Studio` in your user folder.
4. **Director** (optional): pick Claude or OpenAI and paste your API key. Keys are encrypted with Windows
   and only ever sent to that provider.
5. Press **Save settings**.

## Using the board

1. Go to **Spaces** → **New space**.
2. Add cards from the toolbar: **Text**, **Image**, **Video**, **Upload**, **Note**.
3. Wire cards by dragging from a card's right-hand arrow onto another card, or onto one of its sockets:

   | Card | Sockets |
   |---|---|
   | Image | **Words** (any number of text cards) · **Picture** (start from a picture) |
   | Video | **Words** · **First frame** (animate a picture) · **Last frame** (travel from the first picture to this one) |

4. Pick the card's **Model**, **Aspect**, **Resolution** and **Duration**, then press **Generate**.
   Progress, time left and the queue show on the card. **Cancel** stops it.
5. Every render is kept as a take. Open it full screen from the card, download it, or use *Show in folder*.

Tips:

- Name text cards `Cast · <Name>` and `Location · <Place>` and wire them into every shot. Their text is
  added after the shot text, so characters and places look the same in every shot.
- For video with sound, describe the sound in the words too, for example
  *"Sound: rain on the roof, distant thunder."*
- **Seed** on a card: lock it to re-render the same take with small changes.
- The **Director** (top right on a board) can lay out cast, locations and shots for you. You still press
  Generate.

### Times on an RTX 3080 Ti (5-second clips)

| Model | 480p | Higher resolution |
|---|---|---|
| MiniMax-H3 Turbo | about 1 min | 768p: about 3 min |
| LTX-2.3 Distilled | about 1 min | 720p: about 2 min |
| Z-Image (still) | about 10 s | — |

## Which models your PC uses

Each workflow has one or more variants, for example a full-precision one for 24 GB cards and an int8 one
for 12 GB cards. When the app connects to ComfyUI, it checks which variants your PC has every node and
model file for, and uses the best of those. So:

- The same app and the same boards work on every PC.
- A family appears in the card's **Model** list only if your PC can run it.
- A board made on another PC still renders. If its model family isn't installed here, the card uses one
  that is.

## Troubleshooting

| Problem | What to do |
|---|---|
| Top bar says **Engine offline** | Start ComfyUI and check the address in Settings → Test connection. |
| A model is missing from a card's list | Settings → Workflows on this PC lists the missing files. Add them, restart ComfyUI, press Re-detect models. |
| "No workflow on this PC fits this card…" | Nothing installed can render this combination of wires. Check Settings → Engine. |
| "…cannot use the last frame picture" | The chosen model has no first→last mode (Wan), or there is no first frame wired. |
| Renders are very slow or the PC stalls | Use 480p and shorter clips. Close other GPU-heavy apps. 768p H3 nearly fills 12 GB. |
| "Workflow rejected" | ComfyUI or a model changed since the last check. Press Re-detect models and try again. |

## For developers

```bash
npm ci
npm start              # Electron app
node scripts/dev-web.mjs   # browser-only server on http://127.0.0.1:5199
node --test tests/engine-check.test.js   # run the test files you touched
npm run dist           # Windows installer in dist/
```

- Project rules: [CLAUDE.md](CLAUDE.md). Feature list: [docs/features.md](docs/features.md).
  Plans: [docs/plans](docs/plans).
- Workflows live in `workflows/`. A variant for another machine is `workflows/<id>.<variant>.json`; see
  [docs/plans/engine-variants.md](docs/plans/engine-variants.md).
- `node scripts/try-preset.mjs <id> "<prompt>" [first.png[,last.png]]` renders one workflow straight
  against ComfyUI.

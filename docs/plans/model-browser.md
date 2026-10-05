# Model browser: search and install models from Hugging Face — PLANNED

Roadmap 3c, after the Director port (3b). Agreed with the owner 2026-10-05.

People find a style or a better model on Hugging Face and want it on their cards without learning ComfyUI.
The catch: every card runs a trusted workflow from `workflows/` (CLAUDE.md, Security), so a model only helps
when a workflow can load it. The browser therefore installs things that slot into what we already run.

## Rules for anything it installs

- `.safetensors` and `.gguf` only. Never pickle (`.ckpt`, `.pt`, `.bin`, `.pth`): loading one can run code.
- Checked against the SHA-256 Hugging Face publishes (`X-Linked-Etag`), like the engine installer.
- Shown before install: size, free disk, whether it fits the graphics card's memory, the license (with a
  plain-words note when it forbids commercial use), and "needs your Hugging Face login" for gated repos.
- A Hugging Face token, when someone adds one, is encrypted with `safeStorage` and sent only to huggingface.co.
- Downloads reuse the engine installer (parallel, resumable, into the ComfyUI model folders, extra_model_paths aware).

## Phases

### 1. LoRA browser
- [ ] Search Hugging Face for LoRAs per base model we run (Z-Image, Wan 2.2, LTX-2.3; base_model tags and
      file names), with name, preview picture, size, downloads, license.
- [ ] Install into `models/loras`; a list of installed LoRAs with Remove.
- [ ] Workflows get a LoRA slot (a LoraLoaderModelOnly bound like the other inputs); Image and Video cards get a
      **Style** knob (the LoRA) and a strength; the engine check knows which LoRA fits which family.
- [ ] The Director can read which styles are installed (never installs anything itself).

### 2. Live model catalog
- [ ] The installer's model list (`src/shared/model-sources.js`) can be refreshed from a signed catalog file on
      bloop, so a newly tested model appears in *Download missing models* without an app release. Each entry still
      comes with its tested workflow; an unsigned or unknown catalog is ignored.

### 3. Variants of the models we run
- [ ] Find fine-tunes and smaller quantisations (GGUF, fp8) of the same architectures; the engine check confirms the
      workflow loads them and the card has the memory before offering them.

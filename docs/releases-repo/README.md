# Bloop Studio — releases

Windows installers for **Bloop Studio**, an offline filmmaking board that renders stills and video with
sound on your own GPU through a local ComfyUI.

This repository holds **installers only**. The source code is private.

## Install

1. Open **[Releases](../../releases/latest)** and download `Bloop-Studio-Setup-<version>.exe`.
2. Run it. Windows may show *"Windows protected your PC"* because the installer is not code-signed yet:
   choose **More info → Run anyway**.
3. After that, Bloop Studio updates itself: new versions download in the background and a
   **Restart to update** button appears in the top bar.

Setup guide (ComfyUI, models, first run): ask your MarketDragon contact for the user guide.

## License

Bloop Studio is proprietary software. © MarketDragon. All rights reserved. You may install and use the
builds published here; you may not copy, modify, redistribute or reverse-engineer them except where the
law allows it.

Bloop Studio includes open-source components under their own licenses (MIT, Apache-2.0, 0BSD, Unlicense,
SIL OFL 1.1), plus Electron and Chromium. Their notices ship with every install:
`THIRD-PARTY-NOTICES.txt`, `LICENSE.electron.txt` and `LICENSES.chromium.html` in the install folder.

AI models are **not** included. You download them into your own ComfyUI, and each model's own license
applies to how you use it and its outputs.

# Auto-update from GitHub — PARTIAL

Installed copies update themselves instead of someone copying a new installer to each PC.

## Decision

Releases are published to a separate **public** repo, `marketdragonph/bloop-studio-releases`, holding only
installers. The code stays private in `marketdragonph/bloop-studio`; the app needs no GitHub token to update.
Anyone can download the installer (and could unpack its JavaScript); it contains no secrets.

## How it works

- `npm run dist` stamps each build with a date version (`2026.1004.1530`) that always compares higher.
- `.github/workflows/release.yml` (manual *Run workflow* or a `release-*` tag) builds on `windows-latest`,
  then uploads the installer, `latest.yml` and the blockmap with the GitHub CLI and the `RELEASES_TOKEN`
  secret: a draft release first, uploads retried up to 3 times, published as Latest only when all are up.
  Installed apps read the feed from `package.json` → `build.publish`.
- Run #1 (electron-builder publishing directly) created `v2026.1004.534` but uploaded only the blockmap;
  hence the draft-first upload.
- `src/main/updater.js` (electron-updater) checks on launch and every 4 hours, downloads in the background,
  and installs on *Restart to update* (top bar) or when the app quits.
- `scripts/third-party-notices.mjs` writes `THIRD-PARTY-NOTICES.txt` into every build.

## Checklist

- [x] Decide where releases live (public installers-only repo)
- [x] `.github/workflows/release.yml`
- [x] `electron-updater`: check on launch and every 4 h; *Restart to update* key; Settings → App
- [x] Third-party notices generated into every build; license notes in the releases repo README
- [ ] Create `marketdragonph/bloop-studio-releases` (public) with `docs/releases-repo/README.md` (owner)
- [ ] Add the `RELEASES_TOKEN` secret (fine-grained, Contents read/write on the releases repo only) (owner)
- [ ] First published release, and one update seen end to end on an installed PC
- [ ] Code signing (optional; without it Windows SmartScreen warns on first install)

# Auto-update from GitHub — PLANNED

Installed copies should update themselves instead of someone copying a new installer to each PC.

## How it would work

- `npm run dist` already stamps each build with a date version (`2026.1004.1530`) that always compares
  higher, which is what an updater needs.
- **Build in GitHub Actions** on a Windows runner when a `v*` tag is pushed (or on demand), and publish the
  installer plus `latest.yml` to a GitHub Release.
- **electron-updater** in the app checks that release feed on launch, downloads in the background and offers
  *Restart to update*.

## Decision needed: where the releases live

`marketdragonph/bloop-studio` is private. electron-updater can read a private repo's releases only with a
GitHub token built into the app, and anyone with the installer could extract that token.

- [ ] **Option A (recommended)**: a separate *public* repo (e.g. `bloop-studio-releases`) holding only
      installers; the code stays private.
- [ ] **Option B**: a fine-grained read-only token in the app, scoped to the releases repo only.
- [ ] **Option C**: a shared network folder or S3/R2 bucket as the update feed (no GitHub).

## Checklist

- [ ] Pick where releases live
- [ ] `.github/workflows/release.yml`: build on `windows-latest`, publish installer + `latest.yml`
- [ ] Add `electron-updater`; check on launch; *Restart to update* in the top bar
- [ ] Code signing (optional; without it Windows SmartScreen warns on first install)

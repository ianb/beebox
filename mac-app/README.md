# Bee Box for Mac

A menu-bar app that runs the beebox Linux image in a lightweight VM through
Apple's [Containerization](https://github.com/apple/containerization)
framework (pinned at 0.48.0). Experimental; findings are in
[phase1-spike-app.md](../research/installable-app/phase1-spike-app.md).

Requires macOS 26 on Apple silicon. An older macOS refuses to open the app
with the system's own "requires macOS 26.0 or later" message
(`LSMinimumSystemVersion`); a Mac that cannot run VMs gets the app's own
failure message in the menu.

## What the app uses

| Piece | Source |
|---|---|
| Linux kernel | Bundled: Kata Containers 3.32.0's `vmlinux-6.18.35-197-debug` (the kernel Apple's `container` recommends), fetched and SHA-256-checked by `scripts/fetch-kernel.sh` |
| Init filesystem | Pulled on first launch: `ghcr.io/apple/containerization/vminit:0.48.0` |
| beebox image | Pulled on first launch: `ghcr.io/ianb/beebox:<app version>`, published by `.github/workflows/image.yml` on a `v*` tag. A newer app version pulls its own tag and removes the old image |
| Updates | Sparkle 2.10.0 (`scripts/fetch-sparkle.sh`), feed at the latest GitHub Release's `appcast.xml`. Off until the bundle carries `SUPublicEDKey` |

## Build

Full Xcode is required.

```sh
scripts/build-app.sh      # → build/BeeBox.app (ad hoc signed)
scripts/make-dmg.sh       # → build/BeeBox-<version>.dmg
```

`build-app.sh` reads `VERSION` (also the image tag), `SIGN_IDENTITY`
(a Developer ID Application identity; ad hoc by default),
`SPARKLE_PUBLIC_KEY`, `BUNDLE_ID` (default `run.beebox.mac`), and
`BEEBOX_IMAGE`. `make-dmg.sh` signs the DMG with a real `SIGN_IDENTITY`, and
notarizes and staples it when `NOTARY_PROFILE` names an
`xcrun notarytool store-credentials` profile. Downloads are cached in
`~/Library/Caches/beebox-mac-build`.

VM memory is a hard reservation. On the 16 GB development Mac keep any VM
(builder, container, Lima) at 5 GB or less, check `memory_pressure` first, and
run long VM work under a watchdog that kills it below about 20% free; a 12 GB
builder alongside test suites forced a power-off on 2026-09-29. Pass `-c`/`-m`
to `container build` itself: it recreates the builder from the 2 GB default
otherwise. Keep VM state under `<worktree>/scratch/`, not the session
scratchpad.

## Run during development

```sh
open -n build/BeeBox.app \
  --env BEEBOX_IMAGE_LAYOUT=$HOME/Library/Caches/beebox-phase0/oci/layout
```

| Variable | Effect |
|---|---|
| `BEEBOX_IMAGE_LAYOUT` | Load the image from a local OCI layout (`container image save`, then untar) instead of pulling |
| `BEEBOX_IMAGE` | Pull a different image reference |
| `BEEBOX_STATE_DIR`, `BEEBOX_BOX_DIR`, `BEEBOX_PORT` | A second, throwaway instance |
| `BEEBOX_VM_MEMORY_MB` | VM size (default: a quarter of RAM, 2–4 GiB) |
| `BEEBOX_KERNEL` | Kernel path for a bare `swift build` binary, which has no bundle |

The box lives in `~/BeeBoxSpike/box`; runtime state in
`~/Library/Application Support/BeeBoxSpike`, which must not move (the
framework records absolute paths). The box is served at
`http://localhost:3280/box/`.

## Release (once the keys exist)

1. Tag `vX.Y.Z` and push it: the workflow publishes `ghcr.io/ianb/beebox:X.Y.Z`.
   The first time, make the package public in its GitHub settings.
2. `VERSION=X.Y.Z SIGN_IDENTITY="Developer ID Application: …" SPARKLE_PUBLIC_KEY=… scripts/build-app.sh`
3. `NOTARY_PROFILE=beebox-notary SIGN_IDENTITY=… scripts/make-dmg.sh`
4. Generate `appcast.xml` with Sparkle's `generate_appcast` (signs with the
   EdDSA private key in the keychain) and attach it and the DMG to the
   GitHub Release.

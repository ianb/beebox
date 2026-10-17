# Bee Box for Mac

A menu-bar app around a box. It pairs with boxes (a link copied from a box's
Settings → Companion Apps, pasted into Preferences → Boxes, or a `beebox://pair`
link clicked in the browser) and opens them in the browser. It uploads new
files from watched folders and Photos albums to a box (Preferences → Uploads),
which replaces `scan-uploader`'s launchd agent on this Mac. It can also run a
box itself, in a lightweight VM through Apple's
[Containerization](https://github.com/apple/containerization) framework
(pinned at 0.48.0): Preferences → General → "Run a box on this Mac", off by
default. With it off the app downloads nothing. Design:
[mac-app-shell.md](../beebox/docs/plans/mac-app-shell.md); VM findings:
[phase1-spike-app.md](../research/installable-app/phase1-spike-app.md).

## Code layout

- `Sources/BeeBoxMacCore/`: the logic, with no AppKit and no VM: paired boxes
  (`BoxStore`), the pairing sheet's model, the hosting setting, the scan-upload
  client (`Scan/`, a second client of
  [the scan-upload contract](../beebox/docs/scan-upload-contract.md)), and
  upload folders, scan tokens and Photos bookkeeping (`Uploads/`).
- `Sources/BeeBoxMac/`: the app: menu, Preferences, VM runtime, PhotoKit,
  folder events.
- `../apple-shared/` (`BeeBoxShared`): code shared with the iOS app: the
  pairing link, redeem, the http host policy, the Keychain store.
- Tests: `swift test --disable-swift-testing` here, or `bin/apple-test` from
  the monorepo root. `LiveScanSweepTests` runs only with
  `BEEBOX_LIVE_SCAN_URL` and `BEEBOX_LIVE_SCAN_TOKEN` set, against a test box.

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

Give a development build its own bundle id and state, so it does not share
preferences or the paired-box list with an installed Bee Box:
`BUNDLE_ID=run.beebox.mac.dev scripts/build-app.sh`, then launch with
`BEEBOX_STATE_DIR` and `BEEBOX_BOXES_DIR` pointing into the worktree's
`scratch/`. Keychain items use the services `run.beebox.mac.device-token` and
`run.beebox.mac.scan-token` whatever the bundle id.

```sh
open -n build/BeeBox.app \
  --env BEEBOX_IMAGE_LAYOUT=$HOME/Library/Caches/beebox-phase0/oci/layout
```

| Variable | Effect |
|---|---|
| `BEEBOX_IMAGE_LAYOUT` | Load the image from a local OCI layout (`container image save`, then untar) instead of pulling |
| `BEEBOX_IMAGE` | Pull a different image reference |
| `BEEBOX_STATE_DIR`, `BEEBOX_BOXES_DIR`, `BEEBOX_PORT` | A second, throwaway instance |
| `BEEBOX_BOX` | Which box to run (folder name and URL slug; default `box`) |
| `BEEBOX_VM_MEMORY_MB` | VM size (default: a quarter of RAM, 2–4 GiB) |
| `BEEBOX_KERNEL` | Kernel path for a bare `swift build` binary, which has no bundle |

Where things live:

```
~/BeeBox/<name>/                            one folder per box (default: box)
~/Library/Application Support/Bee Box/      shared by every box
    runtime/        images, VM disks, init filesystem (must not move)
    home/           accounts, session key, secrets, Codex login, caches
    claude-config/  Claude login
    logs/           app.log, box-<name>.log
    run/            <name>.sock, each box's relay socket
```

Accounts and agent logins are machine-wide in beebox, so they are shared.
The app runs one box at a time; the default box is served at
`http://localhost:3280/box/`.

## Uninstalling

**Uninstall Bee Box…** in the menu stops the box, deletes the shared data in
`~/Library/Application Support/Bee Box` (the image, VM disks, accounts, agent
sign-ins, and logs), the app's preferences and caches, and moves the app to the
Trash. Boxes in `~/BeeBox` are kept unless you tick the checkbox, and then they
go to the Trash, not straight to deletion.

By hand, after quitting Bee Box:

```sh
rm -rf ~/Library/"Application Support/Bee Box"
rm -rf ~/Library/Caches/run.beebox.mac ~/Library/HTTPStorages/run.beebox.mac*
rm -f ~/Library/Preferences/run.beebox.mac.plist
# and drag Bee Box.app to the Trash; ~/BeeBox holds your boxes
```

The app installs no login items or background services, and its VM runs only
while the app does.

## Release

One-time setup on the maintainer's Mac (done 2026-10-07):

- A **Developer ID Application** certificate (Xcode → Settings → Accounts →
  Manage Certificates), private key backed up as a `.p12`.
- A notarization API key stored as the `beebox-notary` profile
  (`xcrun notarytool store-credentials`).
- The Sparkle update key: `generate_keys --account beebox` (from
  `~/Library/Caches/beebox-mac-build/sparkle-2.10.0/bin`, unpacked by
  `fetch-sparkle.sh`). Its public half is the default in `build-app.sh`; the
  private half stays in the keychain, with a backup kept outside it.

Each release:

1. Tag `vX.Y.Z` and push the tag. The image workflow publishes
   `ghcr.io/ianb/beebox:X.Y.Z` (multi-arch, public).
2. `scripts/release.sh X.Y.Z` checks the tag and image, builds and signs the
   app with the Developer ID, notarizes and staples the DMG, writes
   `appcast.xml` signed with the Sparkle key, and publishes all three to the
   GitHub Release, marked latest (the feed URL follows GitHub's latest
   release, which skips pre-releases).

Apple's first notarizations for a new team can take hours; later ones take
minutes.

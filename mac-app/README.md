# Bee Box Desktop (Mac app)

A menu-bar app around a box. It pairs with boxes (Copy Link (Mac) in a box's
Settings → Companion Apps, then Pair with a Box… here, or a `beebox://pair`
link clicked in the browser) and opens them in the browser. It uploads new
files from watched folders and Photos albums to a box (Preferences → Watched Folders),
which replaces `scan-uploader`'s launchd agent on this Mac. It can also run a
box itself, in a lightweight VM through Apple's
[Containerization](https://github.com/apple/containerization) framework
(pinned at 0.48.0): Preferences → Box on this Mac → "Run a box on this Mac", off by
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
  the monorepo root. A fresh checkout needs `scripts/fetch-sparkle.sh` first
  (the Sparkle binary target is empty until then). `LiveScanSweepTests` runs only with
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
| beebox image | Follows the channel `ghcr.io/ianb/beebox:latest` (`BEEBOX_IMAGE_CHANNEL` picks another tag), published by `.github/workflows/image.yml` once a day from a green `main` run (a `v*` tag publishes its own version tag only). Each box start asks the registry which digest the tag names, reads the image's labels, and downloads it by digest when it is newer and compatible. See "Engine updates" below |
| Updates | Sparkle 2.10.0 (`scripts/fetch-sparkle.sh`), feed at the latest GitHub Release's `appcast.xml`, for the Swift shell only. Release builds carry the signing key; `*-dev` builds do not and never update themselves |

## Engine updates

The app and the engine image release separately. The image carries two
labels (`beebox/docker/Dockerfile`): `org.opencontainers.image.version`, the
engine version, and `run.beebox.min-app-version`, the oldest app that can
run it. The app carries `BeeBoxMinimumEngineVersion` (`MIN_ENGINE_VERSION`
in `build-app.sh`), the oldest image it can run. Both values only go up, and
both are bumped by hand when the contract between them changes: the mounts,
the server port, the entrypoint's argument form, the environment the app
sets, or the in-VM relay (the `create` block in `Sources/BeeBoxMac/BoxRuntime.swift`
on one side, `beebox/docker/entrypoint.sh` and the Dockerfile on the other).
An image that needs a newer app is left alone and Preferences says so;
Sparkle offers the app update.

At every box start (`Sources/BeeBoxMac/ImageSource.swift`) the app resolves
the channel tag to a digest, reads the labels from the registry, and decides
(`BeeBoxMacCore/EngineUpdate.swift`): up to date, update, needs a newer app,
image too old, unlabeled, or a known failure. An update is downloaded by
digest. Then (`BoxRuntime+Engine.swift`) the box's git state is read inside
the VM; a box with uncommitted edits defers the update. On a clean box the
app writes `update.json` beside its logs, re-tags the images (`beebox:current`,
`beebox:previous`), and starts. The update finishes when `/api/build-info`
answers. If the start fails first, the previous image comes back as current,
the failed one stays as `beebox:failed` (not retried until the channel moves,
or "Check for Engine Updates…" asks), the box is reset to its pre-update
commit when the migration sweep had committed, and the box starts again.
After the update finishes there is no automatic rollback; a later problem is
fixed forward by the next image, as on the server.

A running box is never stopped for an update. "Check for Engine Updates…"
(Preferences → Box on this Mac) stops it, checks, and starts it.

## Build

Full Xcode is required.

```sh
scripts/build-app.sh      # → "build/Bee Box Desktop.app" (ad hoc signed)
scripts/make-dmg.sh       # → build/BeeBoxDesktop-<version>.dmg
```

`build-app.sh` reads `VERSION`, `SIGN_IDENTITY` (a Developer ID Application
identity; ad hoc by default), `SPARKLE_PUBLIC_KEY`, `BUNDLE_ID` (default
`run.beebox.mac`), and `MIN_ENGINE_VERSION`. `make-dmg.sh` signs the DMG with a real `SIGN_IDENTITY`, and
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

## Logs

Every event goes to the unified log (subsystem `run.beebox.mac`) and to
`~/Library/Application Support/Bee Box/logs/app.log` (about 2 MB, then
`app.log.1`): launch, Preferences shown and closed (with the window's state),
pairing results, watched-folder sweeps that sent or failed something, folder
problems appearing and clearing, scan token mint and revoke (by name), Photos
and notification permission states, hosting and VM start and stop. Tokens,
pairing links, and file contents are never logged.

```sh
tail -50 ~/Library/"Application Support/Bee Box"/logs/app.log
log show --last 1h --predicate 'subsystem == "run.beebox.mac"'
```

The box this app runs writes its server log beside it, `logs/box-<name>.log`.

## Icon and DMG

`scripts/make-art.swift` draws the app icon (the iOS app's paper cube on a
macOS icon plate) and the DMG background; `build-app.sh` runs it and
`iconutil` makes `AppIcon.icns`. `make-dmg.sh` lays out the DMG window with
[dmgbuild](https://github.com/dmgbuild/dmgbuild), pinned and run through
`uvx`, so it needs `uv` and no Finder automation. The app was named "Bee Box"
before 0.1.4; its bundle id (`run.beebox.mac`) and data folders did not change,
so updates and existing boxes carry over. Sparkle updates an installed
`BeeBox.app` in place under its old file name.

## Entitlements

`BeeBoxMac.entitlements` holds `com.apple.security.virtualization` (the VM)
and `com.apple.security.personal-information.photos-library` (Photos album
export). A Developer ID build runs under the hardened runtime, where a
protected resource without its entitlement is denied silently: no prompt, and
the app is not listed in System Settings → Privacy & Security. Ad hoc builds
skip the hardened runtime, so they do not show the problem; check a new
protected resource with a signed build.

## Run during development

Give a development build its own bundle id and state, so it does not share
preferences or the paired-box list with an installed Bee Box:
`BUNDLE_ID=run.beebox.mac.dev scripts/build-app.sh`, then launch with
`BEEBOX_STATE_DIR` and `BEEBOX_BOXES_DIR` pointing into the worktree's
`scratch/`. Keychain items use the services `run.beebox.mac.device-token` and
`run.beebox.mac.scan-token` whatever the bundle id. An ad hoc build has a new
code signature each time, so macOS asks again for each item the previous build
made; the app reads each item once per launch. Signing development builds
with a stable identity (`SIGN_IDENTITY`) avoids the repeat prompts.

```sh
open -n "build/Bee Box Desktop.app" \
  --env BEEBOX_IMAGE_LAYOUT=$HOME/Library/Caches/beebox-phase0/oci/layout
```

| Variable | Effect |
|---|---|
| `BEEBOX_IMAGE_LAYOUT` | Load the image from a local OCI layout (`container image save`, then untar) instead of pulling |
| `BEEBOX_IMAGE` | Pull one fixed image reference instead of following the channel |
| `BEEBOX_IMAGE_CHANNEL` | Follow another tag of `ghcr.io/ianb/beebox` (for example `edge`, a manual run of the image workflow) |
| `BEEBOX_STATE_DIR`, `BEEBOX_BOXES_DIR`, `BEEBOX_PORT` | A second, throwaway instance |
| `BEEBOX_BOX` | Which box to run (folder name and URL slug; default `box`) |
| `BEEBOX_VM_MEMORY_MB` | VM size (default: a quarter of RAM, 2–4 GiB) |
| `BEEBOX_KERNEL` | Kernel path for a bare `swift build` binary, which has no bundle |

Where things live:

```
~/BeeBox/<name>/                            one folder per box (default: box)
~/Library/Application Support/Bee Box/      shared by every box
    runtime/        images (beebox:current, :previous, :failed), VM disks, init filesystem (must not move)
    update.json     an engine update in progress (see "Engine updates")
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
# and drag Bee Box Desktop.app (BeeBox.app before 0.1.4) to the Trash; ~/BeeBox holds your boxes
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

Each app release (the Swift shell; the engine needs none):

1. Tag `mac-vX.Y.Z` and push the tag.
2. `scripts/release.sh X.Y.Z` checks the tag and that `X.Y.Z` is not below
   the Dockerfile's `MIN_APP_VERSION`, builds and signs the app with the
   Developer ID, notarizes and staples the DMG, writes `appcast.xml` signed
   with the Sparkle key, and publishes all three to the GitHub Release,
   marked latest (the feed URL follows GitHub's latest release, which skips
   pre-releases).

Engine releases: the full-suite schedule dispatches the image workflow once
a day after a green run on `main`, which publishes `:latest` stamped as a
pre-release of the next patch version (`0.1.7-main.<date>.<sha>` after
`v0.1.6`). A `v*` tag publishes `:X.Y.Z` only; `:latest` moves only on the
gated path. A manual run of the workflow with channel `edge` publishes a
trial image that `BEEBOX_IMAGE_CHANNEL=edge` follows.

Apple's first notarizations for a new team can take hours; later ones take
minutes.

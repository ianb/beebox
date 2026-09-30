# Bee Box for Mac (spike)

A menu-bar app that runs the beebox Linux image in a lightweight VM through
Apple's [Containerization](https://github.com/apple/containerization)
framework (pinned at 0.48.0). It is an experiment, not a shipped install
path; results are in
[phase1-spike-app.md](../research/installable-app/phase1-spike-app.md).

Requires macOS 26 on Apple silicon and full Xcode.

## Inputs it borrows (spike only)

The app does not yet pull an image or carry its own kernel. It reads, from
`~/Library/Caches/beebox-phase0/` (override with `BEEBOX_SPIKE_INPUTS`):

- `oci/layout/` — the image as an OCI layout
  (`container image save beebox:phase0 -o beebox.tar`, then untar).
- `app/kernels/default.kernel-arm64` and
  `app/containers/buildkit/initfs.ext4` — downloaded by Apple's `container`
  CLI.

## Build and run

```sh
swift build -c release
codesign --force --sign - --entitlements BeeBoxMac.entitlements .build/release/BeeBoxMac
.build/release/BeeBoxMac
```

The box lives in `~/BeeBoxSpike/box` (override with `BEEBOX_BOX_DIR`).
Runtime state lives in `~/Library/Application Support/BeeBoxSpike` and must
not move: the framework records absolute paths. `BEEBOX_VM_MEMORY_MB` sets
the VM size; the default is a quarter of physical memory, 2–4 GiB.

Quit from the menu, or send SIGTERM; both stop the server gracefully before
the VM goes down.

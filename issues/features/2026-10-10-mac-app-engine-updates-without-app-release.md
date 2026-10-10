---
title: "Mac app: update the beebox engine image without a new app release"
workstream: unknown
area: mac-app
labels: [installable-app, updates]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder asking how often the installable app must update and whether it can self-update its internals
---

The Mac app (`mac-app/`) is a thin launcher. It bundles the Linux kernel and
Sparkle. On first launch it pulls `ghcr.io/ianb/beebox:<app version>`, and that
image contains all of beebox: the engine, the frontend, dependencies, git and
git-annex, the Claude Code CLI, and the pinned Codex
(`beebox/docker/Dockerfile`).

The image tag is pinned to the app version (`mac-app/README.md`, "What the app
uses"). Thus every engine change reaches users only through a full app release:
a `v*` tag, then `scripts/release.sh` (build, sign, notarize, DMG, appcast),
then a Sparkle update. Engine changes are much more frequent than changes to
the Swift shell, so the app must update at the engine's cadence.

## Direction

Let the app check for a newer engine image independently of its own version,
and use Sparkle only when the shell itself changes. The app already pulls the
image from GHCR, so the mechanism is mostly present. The parts to design:

- **App-image compatibility contract.** The shell depends on the image's
  environment variables, ports, relay socket, and mount layout. Each image
  declares the range of app versions it supports. If an image needs a newer
  app, the app waits for the Sparkle update and does not pull that image.
- **Release channel.** A moving tag or a small manifest names the current
  engine image, so an engine release does not need a signed and notarized app
  build.
- **Rollback.** Keep the previous image until the new one starts and the box
  migrations succeed. A failed engine update must not leave the box unusable.
  Box data migrations are one-way, so decide what rollback means after a
  migration has run.
- **When to update.** On app launch, on a schedule while the app runs, or by
  the user's choice from the menu. A running box must stop to change its image.

## Open question

Claude Code is installed into the image at build time (`/opt/claude`). The
production server updates it with `deploy/claude-update.sh`. The app has no
equivalent. Find out whether Claude Code updates itself inside the VM, and
whether an engine-image channel is enough to keep it current.

Related: [Mac companion app](2026-10-07-mac-companion-app.md),
[detect a server update](2026-08-03-detect-server-update-prompt-client-reload.md),
[web warns when the iOS app is out of date](2026-10-08-web-warns-when-ios-app-is-out-of-date.md).

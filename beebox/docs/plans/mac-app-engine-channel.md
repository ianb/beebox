---
title: "Mac app: engine image channel, independent of app releases"
status: draft
workstream: mac-app-updates
issues:
  - ../../../issues/features/2026-10-10-mac-app-engine-updates-without-app-release.md
---
# Mac app: engine image channel, independent of app releases

Bee Box Desktop (`mac-app/`) runs the beebox container image in a VM. Today the
image tag is the app's own version, so every engine change needs a signed,
notarized app release. This plan lets the app follow the engine image on its
own, with a compatibility check in both directions, a safe swap, and a rollback
window, while Sparkle keeps updating the Swift shell only when the shell
changes.

**Issues addressed:**
[engine updates without an app release](../../../issues/features/2026-10-10-mac-app-engine-updates-without-app-release.md).
Related, not resolved here:
[release discipline and update story](../../../issues/decisions/2026-07-20-release-discipline-and-update-story.md)
(this plan settles the cadence question for the desktop channel only);
[detect a server update, prompt reload](../../../issues/features/2026-08-03-detect-server-update-prompt-client-reload.md)
(a browser tab open during a box restart; the app does not solve it);
[installation remaining work](../../../issues/features/2026-07-19-installation-remaining-work.md)
item 6 (a published image is now a fact; this plan adds labels to it). Searched
`issues/` for "sparkle", "engine image", "image tag", "ghcr": only the two
files above match.

## Design

Inline, from the bbx-design template. The surface is small: two lines in the
menu-bar menu and one section in Preferences → Box on this Mac.

### Situations

- When Priya opens her Mac in the morning and the app has found a newer
  engine overnight, I want the box to come up on the new engine without a
  question, so I can keep using it and never think about versions.
- When Tomas is mid-conversation with the box and an update arrives, I want
  the app to stay quiet and update at the next start, so I can finish what I
  am doing.
- When Priya reads about a fix on the beebox site, I want a button that
  checks and updates now, so I can get the fix without waiting a day.
- When an update fails to start, I want the box to come back on the engine
  that worked, with one plain line saying what happened, so I can still open
  my box and report the failure.
- When Odette never wants the box to change under her, I want the update to
  wait for the next time the box is stopped anyway and to be visible in the
  menu first, so I can see it coming. (The person who does not want this.)

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| App launch, box not yet running, newer image known | Act: start on the new image | Menu status line "Box on this Mac: Updating to engine 0.1.8…" | Background; the status line already shows starts |
| Box running, newer image found by the daily check | Download in the background; show, do not act | Menu item "Restart Box to Update (engine 0.1.8)" | Waits to be found, like Sparkle's gentle reminder (`Updates.swift:4-7`) |
| Person presses "Check for Engine Updates…" | Act: check now, then as above | Preferences → Box on this Mac | Interrupts, by request |
| New image fails to serve | Act: roll back to the previous image and restart | Menu status line "Box on this Mac: Running (engine 0.1.7; the 0.1.8 update failed, see app.log)" | Waits to be found; the box works |
| Image needs a newer app | Show, do not download | Menu item "Update to Bee Box Desktop X.Y.Z…" (Sparkle's existing item) with a Preferences caption "The current engine needs Bee Box Desktop X.Y.Z" | Waits to be found |

### Spirit

- **Serves:** "You should be able to see the gears": the engine version is
  visible in Preferences, and the update is a named step in the status line,
  never a silent swap.
- **Risks:** "It should feel like a place": a box that changes under you.
  Guard: a running box is never stopped for an update; the swap happens only
  at a start the person or the app's launch already caused.

### Trust

The app updates automatically at start (the "automatic" rung) because the
same image channel is what every other install follows, and a failed start
rolls back on its own. Stopping a running box stays at "confirmation": only
the person's own menu action does it. There is no opt-out setting in this
plan; see Open design questions.

### When it goes wrong or does nothing

- A check that cannot reach the registry: nothing changes, the status keeps
  the current engine, and app.log records the failure. No menu noise.
- The new image needs a newer app: the Preferences caption says so, Sparkle's
  item offers the app update, the box keeps the current image.
- The new image fails to serve: the app restores the previous image and
  starts it; the status line names both versions and points at app.log. The
  failed image stays on disk as `beebox:failed` until the next successful
  update, so the boxholder can inspect it.
- Nothing newer: "Check for Engine Updates…" shows "Engine 0.1.7 is current
  (checked just now)" under the button.

### Walkthrough

Priya quits the app at night. At 7:40 the next morning she opens it. The app
starts the box: it asks GHCR for the digest behind `latest`
(one HEAD request), reads that image's config labels, sees engine 0.1.8 with a
minimum app of 0.1.6 (she has 0.1.7), and pulls it by digest. The menu says
"Downloading engine 0.1.8… 300 of 1009 MB". The app tags the old image
`beebox:previous` and the new one `beebox:current`, records the box's git HEAD,
and starts the container. The entrypoint runs the migrations and serves. The
menu says "Box on this Mac: Running". Preferences shows "Engine 0.1.8, updated
today". Had the server not answered, the app would have swapped the tags back,
reset the box to the recorded HEAD if a migration commit had landed, and started
again on 0.1.7.

## Smallest fix and budget

**Smallest fix:** change `BundleConfig.image` from `ghcr.io/ianb/beebox:<app
version>` to `ghcr.io/ianb/beebox:latest` and re-resolve the tag at every box
start (`ImageSource.image()` currently returns the stored image without asking
the registry, `ImageSource.swift:19-21`). About 40 lines. It fails on: an image
that needs a newer shell (no check, the box stops serving with a shell error);
a bad image (the old one is deleted by `removeOtherBeeboxImages`,
`ImageSource.swift:49-58`, so there is nothing to go back to); and an engine
that cannot say what version it is (the image reports `0.1.0`, see "What
already exists").

**Chosen design**, tracks A to D below:

| Track | Source lines | Test lines |
|---|---|---|
| A. Image labels and version stamp (Dockerfile, image.yml) | 30 | 0 (verified by pulling the published image) |
| B. Channel resolution and compatibility (Swift, BeeBoxMacCore + ImageSource) | 220 | 150 |
| C. Swap and rollback window (BoxRuntime) | 140 | 40 (pure decision function) |
| D. Menu, Preferences, release scripts, docs | 110 | 0 |
| Total | 500 | 190 |

Authored docs (README sections, docker.md note): about 60 lines, separate.
Not a BIG CHANGE. The fuller design buys: the two-way compatibility check
(principle 4: a shell that cannot run an image fails before the download, not
after), rollback (principle 4: a failed update is visible and the box still
serves), and a version the engine can report (principle 13: a Preferences line
shows the state the system is in).

## Stated preferences this plan trades against

- `beebox/docs/engineering-principles.md` §4 (resilient and never silent) and
  §13 (a control shows the state the system is in): the status line names the
  engine version and the update step; a rollback is reported, never quiet.
- §8 (one way to do each thing): the image is the one engine artifact for the
  Mac app, compose, and NAS installs (`image.yml:3-6`). This plan adds no
  second artifact; it labels the existing one.
- Boxholder decisions recorded in memory: minimize invented concepts and
  reuse platform primitives (the registry tag and OCI labels, not a manifest
  file); operational simplicity over per-call cost (one HEAD request a day).
- Shipped precedent for a hand-bumped compatibility number:
  `SCAN_CONTRACT_VERSION` (`beebox/docs/scan-upload-contract.md`; the Mac
  client sends it as `x-scan-contract`, `mac-app-shell.md:388-389`). This plan
  uses two version strings instead of one contract integer; the "Could this be
  simpler?" gate explains why.
- The Ghost lesson in `beebox/src/cli/commands/upgrade.ts:14-22`: code and
  data revert as one unit, by a `git reset --hard` at the box root. Rollback
  here follows it, inside the start window only.

## What already exists

- **Pull and store.** `ImageSource.image()` (`mac-app/Sources/BeeBoxMac/ImageSource.swift:14-45`)
  pulls `BundleConfig.image` when the store lacks it and otherwise returns the
  stored copy without a network call. Reuse the pull, progress counter, and
  error text. `removeOtherBeeboxImages` (`:49-58`) deletes every other beebox
  reference; this plan changes it to keep `beebox:previous`.
- **Store semantics.** `ImageStore.pull(reference:)` resolves the tag with a
  HEAD request (`RegistryClient+Fetch.swift:31-60`, header
  `Docker-Content-Digest`) and records the image under the reference string
  given; a digest reference `name@sha256:…` parses
  (`Reference.swift:98`, `ImageStore.swift:242-246`). `ImageStore.tag(existing:new:)`
  (`ImageStore.swift:205`) and `ReferenceManager.create` overwrite an existing
  name (`ImageStore+ReferenceManager.swift:86-90`: `state[description.reference] = description.descriptor`).
  `delete(reference:performCleanup:)` removes only unreferenced blobs
  (`ImageStore.swift:123-138`). `Image.config(for:)` reads the OCI config from
  the local store (`Image.swift:94-102`); `ContainerizationOCI.ImageConfig.labels`
  exists (`ImageConfig.swift:49`). `RegistryClient.fetch<T>(name:descriptor:)`
  (`RegistryClient+Fetch.swift:88`) fetches a manifest or config from the
  registry before any layer is downloaded. All in Containerization 0.48.0,
  pinned (`mac-app/Package.resolved`). The dev path already re-tags a loaded
  layout as `beebox:dev` and compares digests (`ImageSource.swift:65-80`); the
  channel path uses the same primitives.
- **Start, stop, failure detection.** `BoxRuntime.run()` (`BoxRuntime.swift:150-243`)
  and `waitForServer` (`:361-380`), which already distinguishes exit,
  "convergence needs recovery" (`LogWriter.swift:48-51`), relay exit, and a
  10-minute timeout. Rollback hooks into these outcomes; nothing new detects
  failure.
- **Migrations at start.** The entrypoint runs `bbx engine migrate --apply
  --repair --within-maintenance --prepare` before serving and parks in `sleep
  infinity` when convergence needs recovery (`beebox/docker/entrypoint.sh:76-124`).
  The sweep commits each applied migration (`migration-sweep.ts:203,243`) and
  keeps recovery snapshots. The app reuses this; it adds no migration logic.
- **Engine version reporting.** `getServingEngineVersion` reads the engine's
  own `package.json` (`beebox/src/core/engine-version.ts:33-35`), which says
  `0.1.0` (`beebox/package.json:3`) while the published tags reach 0.1.6
  (GHCR tag list, verified 2026-10-24). `/api/build-info` reads
  `deploy-info.json` (`root-routes.ts:247-250`), which only `deploy.sh` writes;
  the image has none, so the hash is `null`. Both are fixed by Track A's
  version stamp. The Dockerfile has no `LABEL` (grep, none).
- **Sparkle.** Release builds carry the public key by default
  (`build-app.sh:26-30`); dev builds (`*-dev`) do not. `Updates` is enabled
  whenever the feed and key are present (`Paths.swift:118-125`,
  `Updates.swift:18-22`). The spike confirmed an end-to-end update
  (`research/installable-app/phase1-spike-app.md:148-150`). So Sparkle is
  already on for released apps; the "off until the bundle carries
  SUPublicEDKey" wording in `mac-app/README.md` describes dev builds. Scheduled
  checks default to once a day (Sparkle docs, below).
- **Release scripts.** `release.sh:26-33` requires the tag `v<VERSION>` on
  origin and the image `ghcr.io/ianb/beebox:<VERSION>` published. Track D
  loosens this.
- **Image workflow.** `image.yml:95-100`: a `v*` tag publishes `:<version>`
  and `:latest`; a manual run publishes `:edge`. `latest` currently equals
  `0.1.6` (same digest, verified). Seven tags shipped between 2026-10-06 and
  2026-10-20; `beebox/src` had 904 commits since 2026-10-01 against 27 in
  `mac-app/`; `beebox/src/core/migrations.ts` changed 51 times since
  2026-09-01 (73 migrations). Engine cadence is daily; shell cadence is weekly
  or slower.
- **Timings.** `TimedOperation` (`Timings.swift:5-9`) records `firstStart`,
  `start`, `stop`. An update start is an ordinary `start` plus a download; the
  download already reports its own progress line. No new case.

## Prior art (external)

- **OCI image annotations**, adopted: `org.opencontainers.image.version`
  names the image version; custom keys use reverse-DNS
  (<https://github.com/opencontainers/image-spec/blob/main/annotations.md>).
  Docker `LABEL` writes them into the config the app can read locally and
  from the registry. No ACKNOWLEDGEMENTS entry: a specification, not code.
- **Sparkle appcast**, evaluated-only: `sparkle:minimumSystemVersion`,
  `sparkle:channel`, critical updates exist
  (<https://sparkle-project.org/documentation/publishing/>). Scheduled check
  interval defaults to 86400 s, minimum one hour
  (<https://sparkle-project.org/documentation/customization/>). The engine
  check reuses that cadence, so the person meets one rhythm. Sparkle items
  are for the shell only; the engine does not travel through the appcast.
- **Claude Code installer**, verified: `claude.ai/install.sh` accepts
  `stable|latest|VERSION` (bootstrap script usage line), so a Dockerfile can
  pin or float Claude Code. The image sets `DISABLE_AUTOUPDATER=1`
  (`Dockerfile:150`) so the CLI never self-updates inside a container.
- **Ghost CLI rollback bug** (`upgrade.ts:17-22`, <https://github.com/TryGhost/Ghost-CLI/issues/699>):
  the reason rollback here reverts the box commit along with the image, never
  the image alone.
- Searched for a Containerization API that lists remote tags or reads remote
  labels in one call: none beyond `resolve` + `fetch` (`RegistryClient+Catalog.swift`
  exists but tag listing is not needed; `latest` is the only tag read).

## Ontology

- **Engine image**: the OCI image `ghcr.io/ianb/beebox`, one per `v*` tag
  (`image.yml`). Identified by digest. Carries labels (Track A). Exists.
- **Channel**: the moving registry tag the app follows, `latest` by default.
  Identified by name. It is not a file and not a GitHub Release. New noun, but
  it is the registry's own concept; `BEEBOX_IMAGE_CHANNEL` names it,
  `BEEBOX_IMAGE` (existing, `Paths.swift:112-116`) bypasses it.
- **Engine version**: the label `org.opencontainers.image.version` and, after
  Track A, the engine's `package.json` version. Identified by a semver string.
  Exists as a concept (`engine-version.ts`); the value becomes true.
- **Minimum app version**: label `run.beebox.min-app-version` on the image.
  The oldest `CFBundleShortVersionString` that can run this image. New.
- **Minimum engine version**: Info.plist key `BeeBoxMinimumEngineVersion`.
  The oldest image this build of the app can run. New. Together with the
  previous noun it is the compatibility contract; see "Could this be simpler?".
- **Current / previous / failed image**: store references `beebox:current`,
  `beebox:previous`, `beebox:failed`, in the app's image store
  (`Paths.runtime`). The pattern exists for `beebox:dev` (`ImageSource.swift:67`).
  `beebox:current` is the only image a start ever uses.
- **Pre-update HEAD**: the box's git commit recorded before an update start,
  in `Paths.support/update.json` with the update's timestamps. New, small, and
  deleted when the start succeeds.
- **App version**: `BundleConfig.version` (`Paths.swift:103-105`). Exists.
  Decoupled from the image tag by this plan.

## Tracks / scope

### Track A: label and stamp the image

**What.** The image carries its engine version and the minimum app version
it needs, and the engine's own `package.json` says the same version.

**Why.** The app cannot ask an image what it is: no `LABEL` exists, and the
engine's reported version is a constant `0.1.0`. Without this, no
compatibility check and no "Engine 0.1.8" line are possible.

**Direction.** In `beebox/docker/Dockerfile`:

```dockerfile
ARG BEEBOX_VERSION=0.0.0-dev
ARG MIN_APP_VERSION=0.1.6
LABEL org.opencontainers.image.version=$BEEBOX_VERSION \
      run.beebox.min-app-version=$MIN_APP_VERSION
```

In the build stage, before `pnpm --dir beebox release`, set the version:
`pnpm --dir beebox exec npm pkg set version=$BEEBOX_VERSION` (guarded so a dev
build keeps `0.0.0-dev`). `image.yml` passes `build-args:
BEEBOX_VERSION=${version}` for a `v*` tag and `edge` otherwise. `MIN_APP_VERSION`
is edited by hand in the Dockerfile when the shell contract changes (ports,
mounts, environment, relay socket: `BoxRuntime.swift:36-45,287-323`), the same
way `SCAN_CONTRACT_VERSION` is bumped by hand.

**Vocabulary lock-ins.** Label keys `org.opencontainers.image.version`,
`run.beebox.min-app-version`; build arg names `BEEBOX_VERSION`,
`MIN_APP_VERSION`.

**First chunk.** Dockerfile labels and version stamp; `image.yml` build-args.
Verify locally with `docker build --build-arg BEEBOX_VERSION=0.0.1-test` and
`docker inspect`, and after the next tag by reading the published config. The
tag itself is the boxholder's action.

### Track B: resolve the channel and check compatibility

**What.** A `BeeBoxMacCore` type decides whether an update applies, from
plain inputs; `ImageSource` resolves the channel, reads the remote labels,
and pulls by digest.

**Why.** Today the stored image is never compared with the registry
(`ImageSource.swift:19-21`), and `pull` would overwrite the only copy.

**Direction.**

- `BeeBoxMacCore/EngineUpdate.swift`: `struct EngineImageInfo { digest,
  version: String?, minAppVersion: String? }` and a pure function
  `EngineUpdate.decide(current: EngineImageInfo?, remote: EngineImageInfo,
  appVersion: String, minEngineVersion: String) -> Decision` with cases
  `.upToDate`, `.update(to:)`, `.needsNewerApp(min:)`, `.imageTooOld(min:)`,
  `.unlabeled`. Version comparison is numeric semver on the three dotted
  fields with an optional pre-release suffix, the same grammar as the tags;
  anything else is `.unlabeled`. No AppKit, no VM, so it is testable with
  `swift test`.
- `ImageSource.check()`: `RegistryClient(reference: channelReference)` →
  `resolve(name:tag:)` → fetch the index, the arm64 manifest, the config →
  labels. Returns `EngineImageInfo`. One HEAD plus three small GETs.
- `ImageSource.image()` becomes: if `beebox:current` exists and no update is
  decided, return it. Otherwise pull `ghcr.io/ianb/beebox@sha256:<digest>`,
  then `tag(existing: "beebox:current", new: "beebox:previous")` (deleting
  the old previous first) and `tag(existing: <digest ref>, new:
  "beebox:current")`. The digest reference is deleted after tagging so the
  store holds at most current, previous, and failed. `removeOtherBeeboxImages`
  keeps those three names and `beebox:dev`.
- First launch of an app built by this plan on a Mac that holds
  `ghcr.io/ianb/beebox:0.1.6`: the stored tag-named image is adopted as
  `beebox:current` before the check, so no re-download.
- `BundleConfig.channel`: `BEEBOX_IMAGE_CHANNEL` or `latest`.
  `BundleConfig.minimumEngineVersion` from Info.plist. `BEEBOX_IMAGE` set:
  the check is skipped and that reference is pulled as today (development).
  `BEEBOX_IMAGE_LAYOUT` is unchanged.
- Checking cadence: at box start, and once a day while the app runs (a Task
  that sleeps 86400 s, like Sparkle's default). A daily check that finds an
  update pulls it in the background, swaps nothing, and publishes
  `pendingUpdate: String?` for the menu. The swap happens only in `run()`.

**Vocabulary lock-ins.** `beebox:current`, `beebox:previous`,
`beebox:failed`, `BEEBOX_IMAGE_CHANNEL`, `BeeBoxMinimumEngineVersion`,
`EngineUpdate.Decision`.

**First chunk.** `EngineUpdate` with its tests (version grammar, each
decision case, the unlabeled image). No open question inside it.

### Track C: swap at start, roll back inside the start window

**What.** `BoxRuntime.run()` applies a pending update before creating the
container, and restores the previous image when the new one fails to serve.

**Why.** `removeOtherBeeboxImages` leaves no copy to return to, and a failed
start today ends in `.failed` with a log pointer (`BoxRuntime.swift:238-242`).
A migrated box plus an old engine is the state the spike saw park the box
(`phase1-spike-app.md:152-155`). The engine itself refuses only a box whose
shape version is newer than its build (`beebox/src/lib/box-shape.ts:38-40`);
migrations inside one shape version leave manifest entries an older engine
does not know, and `computePending` ignores them
(`migration-run.ts:97-100`), so the old engine would serve a box in a newer
shape without a word. Rollback must revert the box too.

**Direction.** In `run()`, after `source.image()` returns with `fetched ==
true` and a `beebox:previous` exists:

1. Record `update.json` in `Paths.support`: `{ previousDigest, currentDigest,
   boxHead, startedAt }` where `boxHead` is `git -C <box> rev-parse HEAD` run
   on the host (the box folder is a plain git repository, `Paths.swift:7`).
2. Start as today. On `.running`, delete `update.json`.
3. On any failure before `.running` (exit, needs recovery, relay exit,
   timeout) while `update.json` exists: tag `beebox:current` as
   `beebox:failed`, tag `beebox:previous` as `beebox:current`, then if the
   box's HEAD moved since `boxHead`, run once on the restored image
   `git -C /data/box reset --hard <boxHead>` through `runOnce` (`BoxRuntime.swift:325-336`)
   with the same mounts, and start again. The second start carries no
   `update.json`, so a second failure ends in `.failed` as today, with the
   text naming both engine versions.
4. A start found with a stale `update.json` (the app quit mid-update) treats
   it as a failure of that update and performs step 3 before starting.

The reset is safe inside the window because nothing served between the
record and the failure, so the only new commits are the migration sweep's
own (`migration-sweep.ts:203,243` and the per-migration commit). Untracked and
ignored files (`node_modules`, `.beebox/engine`) are untouched by `reset
--hard`; the entrypoint relinks the engine on every start
(`entrypoint.sh:34-41`). After `.running`, there is no automatic rollback: a
later problem is fixed forward by the next image, as production does
(`deploy.sh` has no data rollback; `deploy.sh:36` records the ref so an
operator can redeploy an older code ref).

**Vocabulary lock-ins.** `update.json` fields above; the `.failed` phase text
"the box did not start on engine X; back on engine Y".

**First chunk.** The window record and the swap-back without the git reset.
The reset is the second chunk, verified against a test box migrated by a
newer engine; the box-shape citation above makes the reset necessary, and
the run shows what the old engine does without it (serve the newer shape or
park).

### Track D: menu, Preferences, release scripts, docs

**What.** Two menu lines, a Preferences section, `release.sh` and
`build-app.sh` decoupled from the image tag, README and docker.md text.

**Direction.**

- Menu (`BeeBoxMacApp.swift:186-202`): when `runtime.pendingUpdate` is set and
  the box is running, "Restart Box to Update (engine X)…" which calls `stop()`
  then `start()`. The status line already shows the download and start steps.
- Preferences → Box on this Mac (`PreferencesWindow.swift:403-421`): a line
  "Engine X.Y.Z (checked <relative time>)", a "Check for Engine Updates…"
  button, and the caption for `.needsNewerApp`. The existing "Check for
  Updates…" (`:479`) is relabeled "Check for App Updates…".
- `build-app.sh`: `BEEBOX_IMAGE` default becomes empty (the channel decides);
  write `BeeBoxMinimumEngineVersion` from `MIN_ENGINE_VERSION` (default in the
  script, bumped by hand when the app drops support for an image shape).
- `release.sh`: drop the image check (`:29-33`); the tag check accepts the
  app's tag name (see Open design questions on tag names).
- `mac-app/README.md`: "What the app uses" row for the image and the Release
  section; `beebox/docs/install/docker.md`: one sentence that the Mac app
  follows `latest`.

**First chunk.** The Preferences line and button, since they only read state
Track B publishes.

## Could this be simpler?

**Simplest version:** the 40-line fix in "Smallest fix": follow `latest`,
re-resolve at each start, no labels, no rollback. It fails on an image that
needs a newer shell (the box stops serving with an opaque error, against §4)
and on a bad image (no previous copy, against §4 and the Ghost lesson).

**One contract number instead of two versions.** A single
`SHELL_CONTRACT=1` on both sides, like `SCAN_CONTRACT_VERSION`, cannot express
"this image works with apps from 0.1.6 on" and "this app needs images from
0.1.9 on" at the same time without a range, and a range of integers is the
same information as two versions with an extra name to learn. Versions
already exist on both sides; the plan reuses them.

**Rollback without the git reset.** Swapping the image back is 20 lines; the
reset is 15 more and a second chunk. The spike's observation makes the plain
swap insufficient in exactly the case rollback exists for, so the reset stays,
gated on the test-box confirmation in Track C.

**No daily check while running.** Checking only at start is simpler and
covers Priya's morning. It fails Tomas's "box runs for a week" case, where
the download would land on the start he makes for other reasons and add
minutes to it. The daily background pull is one Task and reuses the start's
pull; it stays.

**Dropped as over-build:** a manifest file or appcast for the engine (the
registry tag is the manifest); an opt-out preference (see Open design
questions); keeping more than one previous image; a Codex or Claude Code
updater inside the VM (see NOT in scope).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Registry unreachable at the daily check | no | Track B: log, keep current, retry next day | clear in app.log, quiet in UI (by design) |
| Registry unreachable at a start with no stored image | yes (existing error text, `ImageSource.swift:38-40`) | existing | clear |
| `latest` resolves but the image has no labels (an image from before Track A) | Track B test: `.unlabeled` | Track B: treat as needs-newer-app? No: treat as incompatible and keep current; log | clear (Preferences caption) |
| Image needs a newer app | Track B test | Track B: no download; menu shows Sparkle's item if available | clear |
| App needs a newer image than `latest` (engine tag not yet cut) | Track B test | Track B: keep current, Preferences caption | clear |
| Download interrupted (quit, sleep) | no | `ImageStore.pull` cancels its ingest session (`ImageStore.swift:255-257`); `beebox:current` untouched | clear: next start retries |
| New image exits before serving | existing detection (`BoxRuntime.swift:368-370`) | Track C step 3 | clear |
| New image parks in "convergence needs recovery" | existing detection (`:371-373`) | Track C step 3 with reset | clear |
| Migration committed, then serve failed; old engine on new-shape box | no | Track C reset to pre-update HEAD | clear |
| Reset fails (git error inside the VM) | no | Track C: stop, `.failed` names both engines and the HEAD to restore by hand | clear |
| App quits mid-update (stale `update.json`) | Track C test on the pure decision | Track C step 4 | clear |
| Both current and previous fail | existing `.failed` path | ends in `.failed` as today | clear |
| Disk full during pull (two images on disk) | no | pull throws; existing error text | clear but generic; the text should mention the second copy |
| Person presses "Restart Box to Update" with a browser tab open | no | existing stop waits for WebSocket close (`BoxRuntime.swift:78-84`); the tab needs a reload (the 2026-08-03 issue) | silent for the tab; documented |
| `MIN_APP_VERSION` forgotten when the shell contract changes | no | none | **silent until a user's box fails to serve** |

> **Critical gap:** a Dockerfile change to ports, mounts, environment, or the
> relay socket without a `MIN_APP_VERSION` bump. Mitigation in this plan: a
> comment block at the `ARG` naming every file that defines the contract
> (`BoxRuntime.swift` create block, `entrypoint.sh`), and a line in
> `mac-app/README.md`. Accepted as a documented risk: the contract has
> changed twice since the spike (relay socket, mounts), both by the same
> person, and an enforcement check would need the Dockerfile to know Swift
> constants. Filed as a follow-up candidate, not built.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: ADDRESSED. The app reads one tag (`latest`) and two
  label keys; both are constants in one Swift file and one Dockerfile.
- Stale ref: ADDRESSED. `latest` can move between the HEAD and the pull; the
  pull is by digest, so the app gets exactly what it checked.
- Two agents touching the same card: not applicable; the app and the box
  never write the same file. The maintenance lock inside the box is the
  entrypoint's (`entrypoint.sh:80`).
- Hand-edit drift: DEFERRED. A hand-edited `update.json` is not expected;
  the file is written and deleted by the app. A malformed file is treated as
  stale (step 4) and logged.
- Fabricated free-form value: ADDRESSED. Versions are parsed by one grammar;
  anything else is `.unlabeled`, never "newest".
- Validation error UX: ADDRESSED in Design, "When it goes wrong".
- Partial migration / transition state: ADDRESSED. The first app built by this
  plan adopts the stored `:0.1.6` image as `beebox:current` (Track B). An
  image older than Track A has no labels and is never chosen. Boxes made by
  earlier apps need nothing; the box folder does not change shape.

## NOT in scope

- **Claude Code updating inside the VM.** `DISABLE_AUTOUPDATER=1` is right for
  a container: `/opt/claude` sits in the image root filesystem, and the
  container is deleted and recreated at every start (`BoxRuntime.swift:191,
  325-332`), so an in-VM `claude update` would be lost each start. Claude Code
  updates with each engine image; at a tag a week it lags production's
  nightly `claude update` by up to a week. Accepted; if that lag matters, the
  fix is a persistent install location, a separate decision.
- **Codex.** Pinned in `beebox/package.json:150`, resolved by `codex-binary.ts:7-13`;
  it only ever changes with an engine release. Nothing to do.
- **Sparkle changes.** Already on for release builds; the key, feed, and
  `release.sh` publish path stay. Only the tag check changes (Track D).
- **An engine opt-out or "ask first" setting.** Every other install follows
  the image at the operator's pull; the desktop follows at start. Filed as an
  Open design question, not built.
- **Browser-tab reload after a box restart.** The 2026-08-03 issue; the app
  cannot reach the tab.
- **Release notes or a changelog for engine tags.** The 2026-07-20 decision's
  remaining open items.
- **NAS and compose installs following `latest`.** They already can; this
  plan only labels the image. Their update cadence is theirs.
- **Multiple boxes or a hub in the app.** One box, as today
  (`Paths.swift:12`).
- **Enforcing the `MIN_APP_VERSION` bump.** See Critical gap.

## Open design questions

1. **Tag names.** Today one `vX.Y.Z` tag names the engine image and the app
   release. After this plan an engine tag must not imply an app release.
   Options: (a) keep `v*` for the engine, tag the app `mac-vX.Y.Z` and point
   `release.sh` at that; the appcast feed follows GitHub's latest Release,
   which only `release.sh` creates, so engine-only tags leave the feed alone
   (`release.sh:13-16`); (b) keep `v*` for the app and add `engine-vX.Y.Z` for
   images, changing `image.yml:14` and the compose docs. Lean: (a). The
   engine tag is what compose and NAS users already see, and the app version
   numbering can continue from 0.1.6 as `mac-v0.2.0`.
2. **Cadence of engine tags.** Production deploys every `main` commit; the
   desktop channel moves only when a `v*` tag is pushed. Options: a tag by
   hand when the boxholder wants desktops to move (what happens today, roughly
   twice a week); or a scheduled tag (the hourly full suite on `main` could
   tag after a green run). Lean: by hand for now, since every tag is also a
   10-minute image build and a 1 GB download for each desktop; revisit when a
   second desktop user exists.
3. **Automatic swap at start versus ask first.** The plan swaps at start
   without asking (Trust section). The alternative is a one-time "Update the
   box now?" question at the first start that would swap. Lean: swap without
   asking; a stopped box has no work to lose, rollback covers a bad image,
   and a question at every engine tag is the paperwork spirit.md argues
   against.
4. **`MIN_APP_VERSION` initial value.** `0.1.6` (the current app) is safe
   because 0.1.6 already runs the current image shape. Lean: `0.1.6`.

## Knowledge audits

Skip: purely infrastructural. No box agent meets the channel, the labels, or
the app's update flow. The box's own health check (`pendingMigrationsCheck`)
is unchanged.

## What will hold this after it ships

- **Decision logic** is a pure function in `BeeBoxMacCore`
  (`EngineUpdate.decide`), reached by `swift test` in `mac-app/Tests/BeeBoxMacCoreTests`,
  the tier that already holds `BoxStore` and `HostingPreference`. Cases: each
  decision outcome, version grammar edge cases (`0.1.10` > `0.1.9`,
  `0.2.0-dev`), stale `update.json` handling (also pure: a function from the
  file's fields and the current digests to an action).
- **Store operations** (tag, delete, adopt) are not unit-tested; they are
  Containerization calls and the start path exercises them. A manual tour
  entry in `mac-app/README.md` ("Run during development") describes the
  check with `BEEBOX_IMAGE_CHANNEL=edge` against the `edge` tag.
- **Image labels** are checked once per tag by the release checklist in
  `mac-app/README.md` (read the published config); a label missing from a
  published image is visible in the app as `.unlabeled` and in Preferences.
- No new test tier, no mock of the registry.

## Implementation order

1. Track A, chunk 1: Dockerfile labels and version stamp, `image.yml`
   build-args. Local `docker build` verification. (Needs the boxholder's next
   tag to be useful to the app; the app treats unlabeled images as
   incompatible, so until then it keeps the current image.)
2. Track B, chunk 1: `EngineUpdate` and its tests.
3. Track B, chunk 2: `ImageSource.check()`, pull by digest, the three store
   names, adoption of the stored tag image, `BundleConfig.channel` and
   `minimumEngineVersion`, `build-app.sh` plist key.
4. Track C, chunk 1: `update.json`, the swap-back on a failed start, the
   stale-record handling.
5. Track C, chunk 2: the git reset, verified by a test-box run (the current
   `edge` or a local build against a box migrated by a newer engine, under
   `BEEBOX_STATE_DIR` and `BEEBOX_BOXES_DIR` in the worktree's `scratch/`).
6. Track B, chunk 3: the daily background check and pull, `pendingUpdate`.
7. Track D: menu and Preferences, `release.sh` tag change (after question 1),
   README and docker.md.

Each chunk is a commit. The plan ships together, when the boxholder says so.

## Rollout shape

**Tests first.** `EngineUpdateTests` names every decision case before
`ImageSource.check()` is written; the stale-record action is a second pure
function with its own cases. Done-when: `swift test --disable-swift-testing`
passes in `mac-app/`; `bin/apple-test` from the root passes.

**Manual verification before landing**, in the worktree's `scratch/` with a
dev bundle id (`mac-app/README.md`, "Run during development"):

1. A fresh state dir: the app resolves `latest`, pulls by digest, starts.
2. A state dir holding `ghcr.io/ianb/beebox:0.1.6`: adopted as
   `beebox:current`, no second download.
3. `BEEBOX_IMAGE_CHANNEL=edge` with an `edge` image built from this branch
   (manual `image.yml` run is the boxholder's action; otherwise a local
   build loaded through `BEEBOX_IMAGE_LAYOUT` and a hand-tagged store entry):
   the labels read, the version shows in Preferences.
4. A deliberately broken image (an `edge` built with `MIN_APP_VERSION`
   above the app's version): no download, caption shown.
5. A failed start: an image whose entrypoint exits; the app swaps back and
   serves on the previous image; `app.log` names both.

**Migration approach.** No box data shape changes. The app's image store
gains three names; an older app build reading the same store ignores them
and pulls its own tag as before.

**Knowledge audits.** None.

---
title: "canvas-loop scene, subplan (c): box figures"
status: draft
workstream: canvas-brushes
issues:
  - ../../../issues/decisions/2026-11-13-isolate-view-and-figure-code.md
  - ../../../issues/decisions/2026-11-13-view-file-writes-too-broad.md
  - ../../../issues/bugs/2026-07-18-canvas-loop-figure-post-merge-followup.md
---
# canvas-loop scene, subplan (c): box figures

Stage 5 subplan (c) of `beebox/docs/plans/canvas-loop-scene.md`. It moves
beebox's figure card and `bbx figure run` to the scene renderer as the only
canvas-loop path, puts a software Vulkan driver on the server, rewrites the
box-agent figure guidance and starter, and sets what a person sees when a
figure cannot draw. It also gives the deployment order, the rollback, and the
prompt the boxholder can give the courseware agent to regenerate figures.

**Issues addressed:** none is resolved by this plan. Related, listed so the
finish step sees them, and **not to be closed** by it:
`issues/decisions/2026-11-13-isolate-view-and-figure-code.md` (session risk of
figure code; see "Interaction with figure isolation" below),
`issues/decisions/2026-11-13-view-file-writes-too-broad.md` (views, not
figures), and `issues/bugs/2026-07-18-canvas-loop-figure-post-merge-followup.md`
(older verification list for the Canvas2D figure runtime; its item 1 is
already handled by the CSS in `FigureMount.tsx:196`, and its other items
describe the runtime this plan replaces). Searched `issues/` for `webgpu`,
`lavapipe`, `vulkan`, `figure run`, `figure error`: nothing else open.

## Design

### Situations

- When Juni opens a chemistry figure in the courseware box to balance a
  reaction, I want the figure to draw and answer the sliders as before, so
  she can work the reaction and not notice that anything changed.
- When Juni opens a figure that was written for the earlier canvas-loop and
  stops at a call that no longer exists, I want the card to say in plain
  words that this figure needs updating and that the box's agent can do it,
  so she knows it is not her mistake and can tell someone, or move on.
- When Wren opens a figure on an older iPad in the iOS app (iOS 18, no
  WebGPU), I want the card to say that this browser cannot draw this figure
  and which browsers can, with the figure's description still shown, so he
  is not left with an empty box.
- When Priya (the boxholder) deploys the new engine, I want to give the
  courseware agent one message that regenerates the figures that fail and
  lists the ones that pass, so she decides about the rest herself.
- When the courseware agent rewrites a figure, I want `bbx figure run` to
  name each removed call with its replacement and to render on the server in
  seconds, so the agent fixes the sketch in one step.
- When a figure draws correctly, nobody wants to hear about renderers. The
  card says nothing about WebGPU, the scene or versions.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| A working figure | quiet | the figure card, embedded or page | none |
| An old sketch fails | show | a warning notice in place of the figure, on that card only; one console warning with the card path, which reaches the box's `.beebox/client-debug.log` | waits to be found |
| No WebGPU in this browser | show | a warning notice in place of the figure; the card body (page mode) or caption (embed) still shows | waits to be found |
| Other figure errors (compile, a draw that throws) | show | today's error notice, unchanged in kind | waits to be found |
| Regeneration after deploy | act, when the boxholder asks | the courseware box's chat | the boxholder starts it |

The notices replace the figure at the moment someone opens it, the only
moment the figure matters. The box does not push a notification or start
regeneration by itself: the boxholder decides whether and when, and a learner
reading a notice has nothing to do right then.

### Spirit

- **Serves:** "You should be able to see the gears" — the notice says what
  happened (made for an earlier canvas-loop; no WebGPU here) and what fixes
  it, and the agent's run names the exact call.
- **Risks:** "It should feel like a place" — a learner meets a broken spot.
  Guard: the gap is short (the boxholder prompts regeneration right after the
  deploy), most old sketches still draw (the chemistry port needed only
  type-import, `paperTexture` and sprite changes, `stage4-plan.md:137-139`),
  and the notice is calm wording in the warning tone, not an alarm.

### Trust

The card only shows; it takes no action. Regeneration is a **question** rung:
the boxholder asks for it in chat, and the agent regenerates only the figures
that fail and lists the rest for the boxholder to choose. A later "regenerate
the rest too" from the boxholder is the answer that widens it. Nothing is
recorded as standing trust; each regeneration is one chat request.

### When it goes wrong or does nothing

- **Old sketch:** warning notice, heading "This figure needs updating". Text:
  "It was made for an earlier version of the canvas-loop drawing library. The
  box's agent can regenerate it." Below, in small type, the technical line
  from canvas-loop, for example `v.cache was removed; use v.picture and
  v.place (canvas-loop.md, "Pictures")`.
- **No WebGPU:** warning notice, heading "This browser can't draw this
  figure". Text: "This figure draws with WebGPU, which this browser does not
  offer. Recent Chrome and Edge have it, and Safari on iOS, iPadOS and macOS
  26 or later." With WebGPU present but no adapter: "This browser has WebGPU
  turned off or no GPU it can use."
- **Lost GPU device:** unchanged from the spike, an on-figure notice that
  retries on click (`canvas-loop/src/scene-spike/browser/mount.ts:177`).
- **Server has no Vulkan driver:** `bbx figure run` fails with "no GPU
  adapter: this machine has no Vulkan driver (on Linux, Mesa's
  mesa-vulkan-drivers); ask the boxholder", so the agent stops rewriting and
  asks.
- **Nothing to do:** a working figure shows no notice and no badge.

The person corrects it in their own words: the boxholder says "regenerate
the photosynthesis figure" or "leave it" in chat.

### Walkthrough

Juni opens a lesson card in the courseware box that embeds
`![balance it](…/Balance.figure.card)`. `FigureView` (`view.tsx:73-92`)
imports the compiled module from `/api/figure/module.js`. `FigureMount`
loads canvas-loop's browser namespace (`FigureMount.tsx:79-81`), wrapped by
`wrapCanvasLoopLib`. The sketch's factory calls `cl.mountSketch`, which is
now the scene mount. It leases the page's GPU device and records `draw`.
The sketch's `draw` calls `v.cache(…)`; the recorder throws canvas-loop's
retired-call error naming `v.picture`. The scene mount reports it to
`onError`; with this plan the wrapper forwards it to the card, and
`FigureView` shows "This figure needs updating" with the technical line, and
logs one console warning naming the card path, which lands in the box's
`.beebox/client-debug.log`. Juni reads the lesson text around it. Later, Priya
sends the regeneration message; the agent runs `bbx figure run`, sees
`Balance.figure.card` fail with the same line, rewrites the sketch, runs it
until clean, looks at the frames, and commits. The card's live refresh
(`view.tsx:99`) reloads the module when the entry changes, and the figure
draws.

## Smallest fix and budget

**Smallest fix:** add `webgpu` to beebox's dependencies and Mesa to the
server, make `bbx figure run` and the card call the new runner, and change
nothing else. It leaves a browser without WebGPU on a blank canvas (see
Failure modes) and leaves the guidance describing the old API, so it fails
the boxholder's "a clear error, not a blank" requirement
(`canvas-loop-scene.md:394-398`).

**Chosen design, estimated changed lines (additions plus deletions):**

| Chunk | Source | Tests |
|---|---|---|
| C1 dependency and host install (package.json, lockfile entry, `bbx-figure-gpu-install`, deploy.sh, cloud-init, Dockerfile) | ~120 | ~30 |
| C2 `bbx figure run` on the scene runner | ~90 | ~80 |
| C3 the card: one mount, errors routed, two notices | ~150 | ~100 |
| C4 guidance and starter | ~120 (schema instructions, starter, doc notes) | ~30 |
| Total | ~480 | ~240 |

Authored docs (server docs, knowledge audits): ~80 lines. About 800 lines in
all: not a BIG CHANGE. The Lima measurement (C5) and production steps (P1–P3)
add no source. The lockfile diff is generated output and is reported
separately.

## Stated preferences this plan trades against

- **No backward compatibility.** The boxholder: "Don't worry about backward
  compatibility"; figure sketches "only really exist in courseware" and "can
  be regenerated based on this, by the agents in the box"
  (`canvas-loop-scene.md:160-165`). The plan keeps no Canvas2D path and no
  opt-in marker.
- **Fail closed, never blank.** The parent plan's failure table:
  *"clear error on the card until the box agent regenerates the figure"*
  (`canvas-loop-scene.md:438`). `beebox/AGENTS.md`: *"do not add silent
  fallbacks for broken invariants"*. This rules out a quiet Canvas2D fallback
  and rules out leaving today's console-only path.
- **One way to do each thing** (`beebox/docs/engineering-principles.md` §8):
  one mount function and one runner. The opt-in marker from chunk 6b
  (`run-one.ts:44-55`, `figure-canvas-loop.ts:63-82`) is removed.
- **Figures should not have much power.** The boxholder: file-writing APIs for
  figures are "crazy", and the session risk of figure code is "a high
  priority" to revisit (`issues/decisions/2026-11-13-isolate-view-and-figure-code.md`).
  This plan adds no route, helper or capability for figure code; the sketch
  gets scene-building calls, never a `GPUDevice`.
- **Host steps follow the shipped precedent:** a deploy-time root helper that
  installs a distro package idempotently and proves it works as a box user
  inside the box sandbox (`deploy/server-bin/bbx-codex-sandbox-install`).
- **Production changes need the boxholder's own yes** (root `AGENTS.md`,
  "How much to do"). Steps P1–P3 are marked.

## What already exists

- **Chunk 6b host path (reuse, then simplify).** `run-one.ts:89-95` runs
  `runSpike` when the entry exports `renderer = "scene"`;
  `figure-canvas-loop.ts:91-110` (`sceneMount`) lazy-loads
  `@ianbicking/canvas-loop/scene-browser`. Both keep their shape and lose the
  branch.
- **The card's error notice (reuse).** `view.tsx:168-174`:
  `<Notice tone="error"> … <h3 …>Figure error</h3> <Pre size="sm" error>{message}</Pre>`.
  `<Notice>` also has `tone="warning"` (`frontend.md:240`: *"`tone="warning"`
  is `role="status"`"*), which the two new notices use.
- **The wrapper's harness (reuse).** `wrapCanvasLoopLib` (`figure-canvas-loop.ts:117-149`)
  already wraps each mount for param warnings and activity; it gains error
  forwarding.
- **The gap this plan closes.** After load, the scene mount reports failures
  only to the sketch's handler: `mount.ts:237`
  *"if (opts.onError === undefined) console.error("canvas-loop: scene figure failed", error);"*.
  The wrapper forwards only a failed chunk load to the card
  (`figure-canvas-loop.ts:98-104`). So today a browser without WebGPU
  (`shared-gpu.ts:64`, *"this browser has no WebGPU (navigator.gpu is
  missing), and the scene renderer has no Canvas2D fallback"*) leaves an
  empty canvas shell on the card.
- **Headless no-adapter error (reuse, reword).** `runner.ts:200`:
  *"no GPU adapter (Dawn found none)"*.
- **Timeout (reuse, reword).** `run.ts:178-180` reports *"a sketch that never
  returns (an endless loop in init, update or draw?)"*. On a software driver a
  slow render can also hit it.
- **Bundling of canvas-loop's npm deps.** `bundle.ts:60-62`: *"canvas-loop is
  a private workspace package that exports TypeScript source … inline it (its
  own npm dependencies stay external, declared by beebox)"*. beebox declares
  `@napi-rs/canvas` (`package.json:158`) this way; `webgpu` follows.
- **Server install.** deploy.sh syncs canvas-loop (`deploy.sh:550`,
  `SHIPPED_DIRS=(personal-vibe-check tap-check canvas-loop beebox)`) and runs
  `pnpm install --frozen-lockfile` at the workspace root
  (`deploy.sh:454`). With `nodeLinker: hoisted` (`pnpm-workspace.yaml`),
  canvas-loop's own `webgpu` dependency (`canvas-loop/package.json:51`) is
  already hoisted on the server. The beebox declaration matters for the
  packed install: the Docker image installs `/app/beebox.tgz`
  (`docker/Dockerfile:197,217-220`), which carries only beebox's own
  dependencies.
- **`webgpu` install scripts.** `pnpm-workspace.yaml` lists `webgpu` under
  `ignoredBuiltDependencies`: *"Its postinstall only removes the macOS
  quarantine attribute from the Dawn binary"*. No change.
- **Host package precedent.** `deploy/server-bin/bbx-codex-sandbox-install`
  installs `bubblewrap` when absent and then runs a check *"as one existing
  box user, through the box units' own sandbox drop-in and environment
  file"* with `systemd-run` (lines 68-100). deploy.sh runs it after the
  restart (`deploy.sh:997-1002`). The new helper copies this shape.
- **The box sandbox.** `deploy/systemd/box-sandbox.conf:34-46`:
  `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`,
  `NoNewPrivileges=yes`, `MemoryMax=2560M`. No `MemoryDenyWriteExecute`, which
  would block lavapipe's LLVM shader compiler. A box user's home is
  `/var/lib/beebox/<slug>` (`add-box.sh:146`), writable, so Mesa's shader cache
  can land under it.
- **Server image.** The example provisioner uses `ubuntu-24.04` and a `cpx21`
  (3 vCPU, 4 GB) (`deploy/hetzner/create-server.sh:22-23`). The live server's
  CPU count is not recorded in the repo (`dawn-linux.md:59-61`, "Open").
- **Guidance surfaces.** The figure schema's `instructions`
  (`src/schemas/figure.ts:41-280`), emitted to boxes as `card-figure.md`;
  canvas-loop's `TEA.md` and `BRUSHES.md` copied to box docs with a box note
  (`canvas-loop-doc.ts:16-22`); the starter (`starters.ts:154-210`); the
  command summary (`bbx-commands.ts:180-192`); knowledge audits
  `figure-canvas-loop-*` (`src/dev/knowledge-audits.yaml:1376-1440`). A chat
  run regenerates box docs at its start (`start-run.ts:116-117`, *"await
  generateDocs(opts.boxRoot)"*), so the courseware agent's first chat after
  the deploy reads the new text.
- **Box changelog.** `docs/box/agent-changes.md` is written by the
  `agent-changes` schedule (`docs/agent-guide.md:145`); this plan's commits
  give it the entry. No hand entry.
- **Client debug log.** Console warnings and errors reach the box's
  `.beebox/client-debug.log` (`docs/client-debug-log.md`, "How It Works").
- **Theme Studio harness.** `src/frontend/src/pages/dev/components/ThemeStudioHarness/figure.tsx:8,28-31`
  mounts a Canvas2D sketch with `mountSketch`; its calls (`v.background`,
  `v.circle`) exist in the scene API, so it keeps working once `mountSketch`
  is the scene mount.

## Prior art (external)

- **WebGPU in Safari is on by default from version 26** on macOS, iOS, iPadOS
  and visionOS; Chrome desktop since 113, Android 12+ since 121; Firefox on
  Windows since 141, on macOS from 145/147, Linux Nightly only.
  <https://github.com/gpuweb/gpuweb/wiki/Implementation-Status>. Evaluated
  only; sets the notice's wording and the iOS finding below.
- **WKWebView follows WebKit's default, not Safari's feature flags**: a WebKit
  contributor, <https://developer.apple.com/forums/thread/770862>. So the iOS
  app's webview has WebGPU on iOS 26 and not on iOS 18. Evaluated only.
- **iOS 26.0–26.3 WebGPU canvas flicker**, fixed in 26.4:
  <https://bugs.webkit.org/show_bug.cgi?id=301627> (duplicate of 302711).
  Evaluated only; a known-bad range to note, not to work around.
- **Dawn on Mesa lavapipe** works headless and matches Metal within 4/255 on
  99.99% of pixels (`stage3/dawn-linux.md`). That probe used a newer Ubuntu
  (LLVM 21.1.8). Dawn on Debian bookworm's Mesa 22.3 (the Docker base image)
  and on Ubuntu 24.04's Mesa is unverified; C5 checks both.
- No prior art searched for the notice wording or the regeneration prompt:
  no decision depends on an outside premise there.

## Ontology

- **Figure card** (exists, `src/schemas/figure.ts:30`): a `.figure.card` with
  `runtime`, `entry`, `params`, body. Unchanged.
- **Sketch** (exists): the entry module's named exports plus the default
  factory. Unchanged shape; `draw` now records a scene.
- **`cl.mountSketch`** (exists, `canvas-loop/src/browser/mount.ts`): after
  (a), the one browser mount, backed by the scene renderer. `mountSceneSketch`
  stops existing as a separate name.
- **Renderer marker** `export const renderer = "scene"` (exists, chunk 6b):
  **removed**. Nothing reads it. A sketch that still exports it is unaffected.
- **Retired call error** (new, from (a)): the error a removed `View` member
  throws (`v.ctx`, `v.cache`, `v.sprite`, `v.image`, `v.paperTexture`; the
  draft's table, `scene-api-draft.md:27-38`). Identified by a stable error
  `name`. It is the card's "needs updating" signal.
- **No-WebGPU error** (exists as `SceneMountError`, `errors.ts:23`): (a) gives
  the no-WebGPU and no-adapter cases a stable `name` or `reason` so the card
  can tell them from a bad module.
- **Figure notice** (new UI, not a noun in code beyond a component): the
  card's message in place of a figure: "needs updating", "this browser
  can't draw", or today's "Figure error".
- **`bbx-figure-gpu-install`** (new): the deploy-time root helper that installs
  `mesa-vulkan-drivers` and checks Dawn finds an adapter as a box user.
- **Regeneration prompt** (new text, in this plan only): what the boxholder
  sends the courseware agent. Not a procedure or a card.

## Tracks / scope

### What (c) needs from (a), and the order

(c) builds on subplan (a) (`canvas-loop-scene-core.subplan.md`, written in
parallel). Before C2 and C3 start, (a) must provide:

1. **One browser mount named `mountSketch`** in `@ianbicking/canvas-loop/browser`,
   with today's options (`module`, `initialParams`, `autoplay`, `seed`,
   `panel`, `transport`, `onParamsChange`, `onEvent`, `onError`), backed by
   the scene renderer, loading the GPU code lazily. Old factories call it
   unchanged.
2. **Every failure after mount goes to `onError`** (no WebGPU, no adapter, a
   frame that throws, a retired call), once, as today's spike does
   (`mount.ts:233-242`).
3. **Stable error names**: the retired-call error, the no-WebGPU error and the
   no-adapter error are distinguishable without parsing messages, and the
   retired-call message names the replacement and the doc section.
4. **A headless entry** that takes a loaded module and the job's options
   (`frames`, `every`, `seed`, `events`, `initialParams`, `outDir`, optional
   scene outlines) and returns `{ transcriptPath, framesRun, imageCount,
   errors }`, as `teaRun` does (`run-one.ts:96-108`).
5. **Transcript parity with today's** for what box guidance promises: input
   lines (`mousedown (5,5) → dot`), `Δmodel`, `(unhandled)`, `activity {…}`,
   snapshot labels, text-overlap and off-font warnings, and a transcript even
   when `draw` throws. These are the chunk 6b gaps (`stage4-plan.md:259-261`)
   and today's test expectations (`test/cli/commands/figure/run.test.ts:53-56`).
6. **Docs:** `canvas-loop/TEA.md` and `BRUSHES.md` describe the scene API
   (they are copied into boxes as `canvas-loop.md` and
   `canvas-loop-brushes.md`).
7. **No `GPUDevice` reaches sketch code.**
8. **A Dawn no-adapter error** that beebox can reword (C2).

**Order.** (a) and (c) land on `main` in **one merge**. `canvas-loop/` is a
deployed path (`bin/deployed-paths.ts:21-22`), so (a) alone on `main` would
deploy a canvas-loop without the Canvas2D painter under a beebox that still
calls it. (b) (`canvas-loop-gpu-brushes.subplan.md`) is not needed by (c): the
courseware figures already run at 60 fps in the spike (`stage4-plan.md:143`),
and (b)'s changed ink outlines stay within the parity criteria, so figures
regenerated before (b) need no second regeneration. (b) can land before or
after, as its own deploy.

### C1. The dependency and the host driver

- **What:** beebox declares `webgpu`; the server, the cloud-init example and
  the Docker image install Mesa's software Vulkan driver; each deploy proves
  Dawn finds an adapter as a box user.
- **Why:** the bundled `bbx figure run` chunk imports `webgpu` as an external
  (`bundle.ts:59-62`); a packed install without it fails at the first figure
  run. Without a Vulkan driver Dawn finds no adapter (`runner.ts:200`).
- **Direction:**
  - `beebox/package.json` dependencies: `"webgpu": "0.6.2"` (the version
    canvas-loop pins). Use the repo's dependency process: edit, `pnpm install
    --lockfile-only`, check the lockfile diff holds only this, `pnpm
    install`.
  - A test that every runtime dependency of `canvas-loop/package.json` appears
    in `beebox/package.json` dependencies at the same version. It turns the
    convention in `bundle.ts:62` into a check.
  - `deploy/server-bin/bbx-figure-gpu-install <engine>` (bash, root,
    idempotent), modelled on `bbx-codex-sandbox-install`: install
    `mesa-vulkan-drivers` when `dpkg-query` says it is absent; then, as one
    existing box user with the `box-sandbox.conf` properties through
    `systemd-run`, run `node <engine>/dist/…` on a one-line check that opens
    Dawn and prints the adapter (`bbx figure gpu-check`, hidden, beside
    `run-one`). It must report an adapter of type CPU. Quiet on success,
    complete on failure. No box user yet: skip the check, as the Codex helper
    does.
  - `deploy.sh`: run it after the Codex sandbox step (`deploy.sh:1001-1002`),
    same stdin pattern.
  - `deploy/hetzner/cloud-init.yaml` packages: add `mesa-vulkan-drivers`
    with a comment naming the helper.
  - `docker/Dockerfile` runtime `apt-get install` (line 99): add
    `mesa-vulkan-drivers`. If C5 finds bookworm's Mesa does not work with
    Dawn, the base image moves to `node:24-trixie-slim` in this chunk; that
    choice is recorded in C5's notes before C1 is committed.
  - `docs/server/provisioning.md` and `deploying.md`: one paragraph each.
- **Vocabulary lock-ins:** helper name `bbx-figure-gpu-install`; hidden verb
  `bbx figure gpu-check`.
- **First chunk (no open questions):** the dependency, the dependency test,
  the helper, the deploy step, cloud-init and Dockerfile lines.

### C2. `bbx figure run` on the scene runner

- **What:** `run-one.ts` always uses (a)'s headless entry; the marker and the
  `teaRun` branch go.
- **Why:** one renderer (§8); the marker has no meaning once there is one.
- **Direction:**
  - Delete `figureRenderer` and `FigureRendererError` (`run-one.ts:36-55`) and
    the `teaRun` branch (`run-one.ts:96-108`); call (a)'s entry with the same
    job fields, `seed: 42`, ratio 1.
  - `run.ts:150-157`: keep one warning pattern, the one (a)'s transcript
    writes.
  - No-adapter reword: catch (a)'s no-adapter error and print "no GPU
    adapter: this machine has no Vulkan driver (on Linux, Mesa's
    mesa-vulkan-drivers). Ask the boxholder; rewriting the sketch will not
    help."
  - Timeout reword (`run.ts:179`): "stopped after 60 s: an endless loop in
    init, update or draw, or rendering too slow here (each captured frame is
    rendered; try fewer frames or --every larger, or --timeout)".
  - Add `--scene [first]`, passed to the runner, which writes scene outlines
    into the transcript (`runner.ts`, `scene` option). Document it in
    `bbx-commands.ts` and the schema instructions. The drawing round used
    outlines to find misplaced shapes (`checkpoint4.md:22-26`).
  - Tests: the existing four `run.test.ts` cases pass unchanged in meaning;
    replace `run-one.test.ts` (the marker) with a test that the starter
    sketch runs clean in a temp box (`figureStarterSketch("canvas-loop")`),
    and a test that a sketch calling `v.cache` fails with the retired-call
    text.
- **Vocabulary lock-ins:** `--scene`, `--scene first`, as in canvas-loop's
  own CLI (`runner.ts:212-219`).
- **First chunk:** the run-one switch, deletions, rewording, tests.

### C3. The card: one mount, errors to the card, two notices

- **What:** the browser wrapper wraps one `mountSketch`, forwards every mount
  failure to the card, and `FigureView` shows the right notice.
- **Why:** today a browser without WebGPU shows a blank shell (What already
  exists, "The gap"); an old sketch's retired call would only reach the
  console.
- **Direction:**
  - `figure-canvas-loop.ts`: delete `FigureRendererMismatchError`,
    `rendererMismatch`, `sceneMount` (lines 63-110) and the `renderer`
    harness field. `wrap` chains `opts.onError`: call the sketch's own, then
    `harness.onError(error)`.
  - `FigureMount.tsx`: drop `renderer` (lines 90-91, 105-106, 124-127, 142,
    145); `onError` takes `unknown` and passes it through.
  - `view.tsx`: drop `FigureModule.renderer` (lines 39-40) and the prop at
    line 130. Keep the error as a value, and pick the notice with a pure
    function `figureNotice(error): { kind: "outdated" | "no-webgpu" |
    "no-adapter" | "error"; detail: string }` keyed on (a)'s error names. The
    `outdated` notice also calls `console.warn` once with
    `figure <card path>: needs regenerating: <detail>`.
  - Notices use `<Notice tone="warning">` with the wording in the Design
    section; `error` keeps today's `FigureError`. Page and companion modes
    still show the body; embeds still show the caption.
  - Tests: `figureNotice` cases (pure); a frontend test that a mount
    rejecting with the no-WebGPU error reaches `FigureMount`'s `onError`;
    remove the marker tests in `figure-canvas-loop.test.ts`.
- **Vocabulary lock-ins:** notice kinds `outdated`, `no-webgpu`,
  `no-adapter`, `error`.
- **First chunk:** wrapper and mount changes with their tests; then the
  notice function and view.

### C4. Guidance and starter

- **What:** the figure instructions, the starter, the box note on the copied
  canvas-loop docs, the command summary, and knowledge audits describe the
  scene API.
- **Why:** box agents learn figures only from these (`host-boundaries.md:46-54`).
- **Direction:**
  - `src/schemas/figure.ts` canvas-loop section: the factory stays
    `cl.mountSketch(mount, { module, initialParams, autoplay })`. Replace
    references to brushes, sprites and caches with pictures, effects and
    lighting by section name in `canvas-loop.md`. Add two sentences:
    "canvas-loop figures draw with WebGPU. A browser without it shows a notice
    in place of the figure; do not switch a figure to another runtime for
    this unless the boxholder asks." Add `--scene` under "Checking a
    canvas-loop figure". The `bbx figure run` paragraph keeps its claims only
    where (a)'s transcript keeps them (the list in "What (c) needs from (a)",
    item 5).
  - `starters.ts:154-210`: the starter, rewritten only where the scene API
    differs; keep params `speed`, `show-ring`, `tone`, `reset` so
    `FIGURE_TEMPLATE_PARAMS` (`figure.ts:304-310`) and `test/schemas.test.ts:202-217`
    hold.
  - `canvas-loop-doc.ts:16-22`: update the box note if (a) renames the dev
    CLI commands it mentions.
  - Knowledge audits, added and run on the worktree's test box clone:
    `figure-outdated-sketch` ("A figure card shows 'This figure needs
    updating … v.cache was removed'. What do you do?": rewrite with
    `v.picture`/`v.place` per `canvas-loop.md`, run `bbx figure run`) and
    `figure-no-webgpu` ("A learner says a figure shows 'This browser can't
    draw this figure'. What do you do?": explains the browser lacks WebGPU,
    names browsers that have it, does not rewrite the figure). Re-run the
    existing `figure-canvas-loop-*` audits.
- **First chunk:** schema instructions and starter with the starter test.

### C5. Measure on a VM like the server (no source)

- In a local Lima VM (not production): Ubuntu 24.04 with
  `mesa-vulkan-drivers`, 3 CPUs to match the example `cpx21`; and the Docker
  image built from C1. Run `bbx figure run` cold (new process each time) on
  the starter and the chemistry port (`canvas-loop/src/examples/scene-ports/`)
  at the default 120 frames, `--every 30`. Record wall time, peak RSS, and
  the Mesa shader-cache size under `$HOME/.cache`.
- Pass: each under 15 s cold, RSS under 1 GB. A miss changes C2's defaults
  (fewer captured frames) before production, not the timeout.
- Notes go in `beebox/docs/plans/canvas-loop-scene/stage5/figures-timing.md`.
- An exhibit with the two notices (old sketch, no WebGPU) and a working
  chemistry figure, captured in the worktree's dev router.

### Production steps — each needs the boxholder's own yes

- **P0 (optional, needs a yes because it reads courseware content).** The
  boxholder, or an agent they name, runs the new engine's `bbx figure run`
  against a local clone of the courseware box to see which figures fail
  before the cutover. Nothing from it goes into public docs.
- **P1. Mesa on the server before the merge.** `deploy/prod-ssh` as root:
  `apt-get install -y mesa-vulkan-drivers`, then the C1 helper's check by
  hand as one box user, and a timing run of the starter in a throwaway
  directory (not box content) under the box sandbox properties. This gives
  the real CPU count and timing before any figure depends on it. Installing
  the package changes nothing that runs today.
- **P2. The merge to `main`.** This is the cutover; the post-commit hook
  deploys. Order inside the deploy: release prepared and installed (`webgpu`
  included), switch, restart, then `bbx-figure-gpu-install` (installs Mesa if
  P1 was skipped, and checks it). After it: open one figure in the boxholder's
  browser, and confirm `.claude/rules/card-figure.md` in the courseware box
  carries the new text after its next chat starts.
- **P3. Regeneration.** The boxholder sends the courseware agent the prompt
  below, when they choose.

### Regeneration prompt (for the boxholder to send)

> canvas-loop changed: `draw` now records a scene that WebGPU draws. Read
> `card-figure.md` and `canvas-loop.md` first. Run `bbx figure run` with no
> card to check every canvas-loop figure. For each figure that fails, rewrite
> its sketch against the current docs: keep what it teaches, its module
> params, the card's `params:`, its description and its events file. Run
> `bbx figure run <card>` until it has no errors, and look at the frames.
> Commit each figure on its own. Do not change figures that pass or figures
> in other runtimes; list the passing canvas-loop figures for me, and tell me
> anything you could not keep.

### Rollback

- **Engine:** `./deploy/deploy.sh --ref <sha before the merge>` (`deploy/AGENTS.md`,
  "Rollback"); a failed health check after the switch rolls back by itself
  (`docs/server/deploying.md:110-115`). The Mesa package stays installed and
  is inert.
- **Regenerated figures under the old engine:** sketches using only calls
  both APIs share still draw; ones using new calls (`v.picture`, `lighting`)
  fail with today's "Figure error". The courseware agent can `git revert` its
  per-figure commits in the box if the boxholder asks. One commit per figure
  keeps this exact.
- Rolling back after P3 is therefore a boxholder decision with a cost; the
  plan recommends fixing forward.

### Interaction with figure isolation

This plan adds no route, file helper or capability; `figure.file` stays
read-only (`FigureMount.tsx:36-48`). Sketch code builds scene data and never
holds the GPU device. When the isolation issue is taken up
(`issues/decisions/2026-11-13-isolate-view-and-figure-code.md`), an iframe per
figure would give each figure its own GPU device instead of one per page
(`scene-api-draft.md:586-587`), which costs memory per figure; whether a
cross-origin iframe needs a permissions grant for WebGPU is unverified. The
mount contract (`mountSketch(mount, opts)`) does not change for that work.

## Could this be simpler?

The simplest version is the smallest fix above: declare `webgpu`, install
Mesa, call the new runner, leave guidance for the agents to discover. It fails
on a learner's iPad without WebGPU, where the card is a blank shell (`mount.ts:237`),
against "a clear error on the card, not a blank" (`canvas-loop-scene.md:398`)
and `beebox/AGENTS.md`'s "no silent fallbacks". It also leaves the agent
writing figures from docs that describe removed calls.

Smaller still was considered for the notice: one generic "Figure error" with
the raw message. It works for the agent but tells a learner "SceneMountError:
mountSceneSketch: …", which does not say whose problem it is. The two
warning notices cost one pure function and two strings.

Two things were left out as over-builds: a server-rendered still image for
browsers without WebGPU, and a version marker that would let the card flag
every old sketch, including ones that still draw (see NOT in scope).

## Subplans

None. This is itself subplan (c).

## Failure modes

> **Critical gap (closed by C3):** the scene mount on a browser without
> WebGPU — the card shows an empty canvas shell and the error goes only to the
> console (`mount.ts:237`, `figure-canvas-loop.ts:98-104`). C3 routes it to
> the card; its test is listed below.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Browser without WebGPU (iOS 18 webview, Firefox on Linux) | C3 adds one | C3: "can't draw" notice | clear after C3 (silent today) |
| WebGPU present, no adapter (GPU blocklisted) | C3 adds `figureNotice` case | C3 notice | clear |
| Old sketch calls a retired member during `draw`, only on one branch (after a click) | C2 adds headless case | (a)'s error, C3 notice when it happens | clear, but only once reached |
| Old sketch draws without error but looks different (`v.paper` now scoped to its group) | no | none: the boxholder sees it, or asks for the rest to be regenerated | silent; accepted, see below |
| Packed install lacks `webgpu` | C1 dependency test | import error from `run-one` | clear |
| Server lacks Mesa | C1 helper check at deploy | deploy fails with the helper's output; at runtime C2's reworded error | clear |
| Mesa installed but Dawn rejects it (old Mesa, bookworm image) | C5 measurement | C1 base-image decision | clear at C5 |
| Software render too slow: run hits 60 s on a lit figure with many events | C5 measurement | C2's reworded timeout | clear |
| Several boxes run figures at once and contend for CPUs | no | none; runs take longer | clear (timeout message) |
| Box memory: Dawn and lavapipe in the child push the box past `MemoryMax=2560M` | C5 measures RSS | OOM kills the child; `run.ts:186` reports the exit | clear |
| Mesa shader cache grows in each box user's home | C5 measures | none planned | silent; small risk, measured in C5 |
| iOS 26.0–26.3 canvas flicker (WebKit bug) | no | none; fixed in iOS 26.4 | visible to the person; accepted |
| A regenerated figure drops a param an embed link sets | existing param-mismatch console warning (`figure-canvas-loop.ts:46-59`) | the prompt says keep params | clear in console only |
| Theme Studio screenshots (theme-check) in a browser without WebGPU | no | C3 notice shows instead | clear |

Accepted risk, one sentence: an old sketch that still draws may look
different, and the boxholder accepts this because regeneration is the plan
for every old figure and a version marker would flag figures that work.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** the agent keeps `export const renderer` or calls
  `cl.mountSceneSketch` from a spike-era copy. ADDRESSED: the marker is
  ignored; `mountSceneSketch` is not a function, so the card shows "Figure
  error" naming it; the starter and instructions never mention either.
- **Stale ref:** the agent regenerates a figure whose events file names an
  old param. ADDRESSED: `parseTeaEvents` refuses an undeclared param name
  (`run-one.ts:86`), and the prompt says keep params.
- **Two agents on one card:** a learner's chat and the regeneration run touch
  the same figure. DEFERRED: same as any card edit today; live refresh
  reloads the new entry (`view.tsx:99`).
- **Hand-edit drift:** the boxholder edits a sketch by hand with an old call.
  ADDRESSED: same retired-call notice.
- **Fabricated free-form value:** the agent claims a figure was checked. ADDRESSED
  in part: the prompt asks it to look at frames; `bbx figure run` exits
  non-zero on errors.
- **Validation error UX:** ADDRESSED: retired-call text names the replacement
  and the doc section (need 3 from (a)); no-adapter text says to ask the
  boxholder.
- **Partial migration / transition state:** between P2 and the end of P3,
  some figures draw, some show "needs updating". ADDRESSED: that is the
  designed state; the prompt finishes it.
- **Agent switches runtime to dodge WebGPU:** ADDRESSED by the instruction
  sentence and the `figure-no-webgpu` audit.

## NOT in scope

- **Server-rendered still image for browsers without WebGPU:** possible later
  (the server can render frame 0 with Dawn); not now because it adds a route
  and a cache for a case the boxholder may never meet. Boxholder override.
- **A version marker that flags every old sketch:** not now; the retired-call
  errors catch the ones that break, and old sketches that draw are better
  shown than blocked. Boxholder override.
- **Raising the iOS app's deployment target to iOS 26:** a separate iOS
  decision; the notice covers iOS 18.
- **A Canvas2D or WebGL fallback renderer:** the boxholder chose one WebGPU
  renderer (`checkpoint4.md:112`).
- **Figure isolation in iframes:** the open isolation issue owns it.
- **Automatic regeneration on deploy:** the boxholder triggers it.
- **GPU brush expansion:** subplan (b).
- **Changes to p5, three and d3 figures:** untouched.
- **The `mobile-contract.md` index:** no HTTP, bridge or URL change; the iOS
  webview loads the same pages (`ChatWebView.swift:264-268` uses a default
  `WKWebViewConfiguration`).

## Open design questions

- **Notice wording for learners.** Lean: neutral ("The box's agent can
  regenerate it"), with no invitation to ask, since the boxholder decides when
  regeneration runs. The boxholder may prefer "ask in chat".
- **Regenerate failing figures only, or all.** Lean: failing only, listing the
  rest. The boxholder may want all regenerated to pick up lighting and
  pictures.
- **P1 before the merge, or let the deploy install Mesa.** Lean: P1 first, for
  real timing before the cutover.
- **The live server's CPU count.** Unknown in the repo; P1 records it.

## Knowledge audits

- New: `figure-outdated-sketch`, `figure-no-webgpu` (C4), run on
  `~/src/box-worktrees/canvas-brushes/test1/`; status comments recorded in
  `src/dev/knowledge-audits.yaml`.
- Re-run: `figure-canvas-loop-runtime`, `-import-rule`, `-check`, `-api-docs`,
  `figure-shared-code`, `figure-in-view`, `figure-activity`, `figure-sound`
  (`knowledge-audits.yaml:1376-1440`), since the docs they read change.

## What will hold this after it ships

- **Unit tier:** `figureNotice` (pure) for each error kind; the dependency
  declaration test; the wrapper's error forwarding (frontend tests exist for
  this file, `src/frontend/test/lib/figure-canvas-loop.test.ts`).
- **CLI tier:** `test/cli/commands/figure/run.test.ts` runs real figures
  through Dawn on the developer's Mac (Metal); new cases for the starter and
  a retired call. Neither the hourly suite nor CI has lavapipe, so the Linux
  path is held by the deploy-time helper check (C1), which fails the deploy
  when Dawn finds no adapter as a box user.
- **No new test tier.** No mock of Dawn: the tests use the real one.

## Implementation order

1. Subplan (a) done in the worktree (needs 1–8 above).
2. C5 VM half: Ubuntu 24.04 and bookworm with Mesa, the spike's
   `bbx figure run` on the starter. Settles the Docker base image. Notes.
3. C1: dependency, dependency test, helper, deploy and image lines. Commit.
4. C2: `bbx figure run`. Commit.
5. C3: wrapper, mount, notices. Commit; cross-model review of C1–C3.
6. C4: instructions, starter, docs, audits run. Commit.
7. C5 timing and exhibit on the final code. Commit notes.
8. Checkpoint with the boxholder: exhibit, timing, the open questions.
9. **P1 (yes needed)**, then **P2 (yes needed)** as part of the one merge of
   the workstream with (a); then **P3** when the boxholder chooses. **P0** is
   optional, before P2, and needs its own yes.

## Rollout shape

Tests named while designing, done-when:

- `figureNotice` returns `outdated` for the retired-call error, `no-webgpu`
  and `no-adapter` for (a)'s two errors, `error` otherwise.
- A mount that fails with no WebGPU reaches `FigureMount`'s `onError`.
- `bbx figure run` on the starter in a temp box: `ok: true`, no warnings.
- `bbx figure run` on a sketch calling `v.cache`: `ok: false`, the error names
  `v.picture`.
- The four existing `run.test.ts` cases pass.
- Every canvas-loop runtime dependency is declared by beebox at the same
  version.
- `pnpm typecheck`, `pnpm lint:changed`, `pnpm layout-check`, `pnpm ui-check`
  pass; the knowledge audits pass on the test box clone.

No data migration: figure cards keep their shape (`bbx-migration` does not
apply; the sketches are regenerated by the box's agent, not by a script).

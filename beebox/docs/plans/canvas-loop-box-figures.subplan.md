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
- When Juni opens a lesson whose figure was written for the earlier
  canvas-loop and stops at a call that no longer exists, I want the figure's
  place on the page to say in plain words that this figure needs updating,
  with the lesson text and caption still around it, so she knows it is not
  her mistake and can keep reading.
- When Wren opens a figure on an older iPad in the iOS app (iOS 18, no
  WebGPU), I want the figure's place to say that this device cannot draw it
  and what might help, with the description and caption still shown, so he
  is not left with an empty box.
- When Priya (the boxholder) deploys the new engine, I want to give the
  courseware agent one message that brings every canvas-loop figure onto the
  new renderer the way she chose at Checkpoint 5, so she does not hunt for
  broken or changed figures herself.
- When the courseware agent rewrites a figure, I want `bbx figure run` to
  name each removed call with its replacement and to render on the server in
  seconds, so the agent fixes the sketch in one step.
- When a figure draws correctly, nobody wants to hear about renderers. The
  card says nothing about WebGPU, the scene or versions.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| A working figure | quiet | the figure card, embedded or page | none |
| An old sketch fails | show | a warning notice in the figure's slot; the page body, embed caption and surrounding lesson stay; one console warning with the card path, which reaches the box's `.beebox/client-debug.log` | waits to be found |
| No WebGPU on this device | show | a warning notice in the figure's slot, same layout | waits to be found |
| Other figure errors (compile, a draw that throws) | show | today's error notice, now also in the figure's slot | waits to be found |
| Regeneration after deploy | act, when the boxholder asks | the courseware box's chat | the boxholder starts it |

The notices take the figure's place at the moment someone opens it, the only
moment the figure matters, and nothing else on the page moves. The box does
not push a notification or start regeneration by itself: the boxholder
decides whether and when, and a learner reading a notice has nothing to do
right then.

### Spirit

- **Serves:** "You should be able to see the gears" — the notice says what
  happened and what fixes it, and the agent's run names the exact call.
- **Risks:** "It should feel like a place" — a learner meets a broken or
  changed spot. Guard: the boxholder prompts regeneration right after the
  deploy; the notice stays inside the lesson's layout in the warning tone;
  and Checkpoint 5 decides how far regeneration goes, including for old
  figures that still draw but may look different (Open design questions).

### Trust

The card only shows; it takes no action. Regeneration is a **question** rung:
the boxholder asks for it in chat, with the scope chosen at Checkpoint 5.
Nothing is recorded as standing trust; each regeneration is one chat request.

### When it goes wrong or does nothing

The wording below is a draft. **The final learner wording is the boxholder's
call** (Open design questions).

- **Old sketch:** warning notice, heading "This figure needs updating". Text:
  "It was made for an earlier version of the canvas-loop drawing library. The
  box's agent can regenerate it." Below, in small type, the technical line
  from canvas-loop's `RemovedCallError`, for example `v.cache was removed; use
  v.picture and v.place (TEA.md, "Pictures")`.
- **No WebGPU:** warning notice, heading "This figure can't draw on this
  device". Text: "It draws with WebGPU, which this browser or device does not
  offer. Updating the browser or the operating system may add it, or the
  figure may work on another device." With WebGPU present but no adapter:
  "This browser has WebGPU turned off, or has no graphics hardware it can use
  for it."
- **Lost GPU device:** unchanged from the spike, an on-figure notice that
  retries on click (`canvas-loop/src/scene-spike/browser/mount.ts:177`).
- **No GPU adapter on the server:** `bbx figure run` names possible causes
  and says to ask the boxholder (C2), so the agent stops rewriting.
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
The sketch's `draw` calls `v.cache(…)`; the recorder throws `RemovedCallError`
naming `v.picture`. The scene mount reports it to `onError`; with this plan
the wrapper hands it first to the card, then to the sketch's own handler.
`FigureView` puts "This figure needs updating" with the technical line in the
figure's slot; the caption "balance it" stays beneath it and the lesson text
stays around it. One console warning names the card path and lands in the
box's `.beebox/client-debug.log`. Juni reads on. Later, Priya sends the
regeneration message; the agent runs `bbx figure run`, sees
`Balance.figure.card` fail with the same line, rewrites the sketch, runs it
until clean, looks at the frames, and commits. The card's live refresh
(`view.tsx:99`) reloads the module when the entry changes, and the figure
draws.

## Smallest fix and budget

**Smallest fix:** add `webgpu` to beebox's dependencies and Mesa to the
server, make `bbx figure run` and the card call the new runner, and change
nothing else. It leaves a browser without WebGPU on a blank canvas (see
Failure modes), hides the lesson text when a figure fails (`view.tsx:113-118`
returns before the layout), and leaves the guidance describing the old API,
so it fails the boxholder's "a clear error, not a blank" requirement
(`canvas-loop-scene.md:394-398`).

**Chosen design, estimated changed lines (additions plus deletions).** The
removal of the chunk 6b marker in beebox is subplan (a)'s
(`canvas-loop-scene-core.subplan.md:618-623`) and is not counted here.

| Chunk | Source | Tests |
|---|---|---|
| C1 dependency, Dawn probe and host install (package.json, lockfile entry, `dawn-probe.ts`, `bbx-figure-gpu-install`, deploy.sh, cloud-init, Dockerfile) | ~130 | ~30 |
| C2 `bbx figure run`: no-adapter and timeout wording, `--scene` | ~60 | ~70 |
| C3 the card: errors to the card first, notices in the figure slot, layout split | ~175 | ~130 |
| C4 guidance and starter | ~120 (schema instructions, starter, doc notes) | ~30 |
| Total | ~485 | ~260 |

Authored docs (server docs, knowledge audits): ~90 lines. About 835 lines in
all: not a BIG CHANGE. The VM measurement (C5) and production steps (P1–P3)
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
  one mount function and one runner.
- **Figures should not have much power.** The boxholder: file-writing APIs for
  figures are "crazy", and the session risk of figure code is "a high
  priority" to revisit (`issues/decisions/2026-11-13-isolate-view-and-figure-code.md`).
  This plan adds no route, helper or capability for figure code; the sketch
  gets scene-building calls, never a `GPUDevice`.
- **Host steps follow the shipped precedent:** a deploy-time root helper that
  installs a distro package idempotently and proves it works as a box user
  inside the box sandbox (`deploy/server-bin/bbx-codex-sandbox-install`).
- **Production changes need the boxholder's own yes** (root `AGENTS.md`,
  "How much to do"). Steps P0–P3 are marked.

## What already exists

- **Chunk 6b host path.** `run-one.ts:89-95` runs `runSpike` when the entry
  exports `renderer = "scene"`; `figure-canvas-loop.ts:91-110` (`sceneMount`)
  lazy-loads `@ianbicking/canvas-loop/scene-browser`. Subplan (a) removes the
  marker, `sceneMount` and `rendererMismatch` and makes `run-one.ts` call the
  async `teaRun` (`canvas-loop-scene-core.subplan.md:364-365,618-623`).
- **The card's error notice (reuse).** `view.tsx:168-174`:
  `<Notice tone="error"> … <h3 …>Figure error</h3> <Pre size="sm" error>{message}</Pre>`.
  `<Notice>` also has `tone="warning"` (`frontend.md:240`: *"`tone="warning"`
  is `role="status"`"*), which the two new notices use.
- **The card's layout (rebuild around a slot).** `view.tsx:113-125` returns
  `FigureError` or the loading status *before* the page and embed layout at
  `view.tsx:139-155` is assembled, so a failure drops the card body
  (page/companion mode) and the `![caption]` (embed). C3 moves every state
  into one slot inside that layout.
- **The wrapper's harness (reuse).** `wrapCanvasLoopLib` (`figure-canvas-loop.ts:117-149`)
  already wraps each mount for param warnings and activity; it gains error
  forwarding.
- **The gap this plan closes.** After load, the scene mount reports failures
  only to the callback it was given: `mount.ts:237`
  *"if (opts.onError === undefined) console.error("canvas-loop: scene figure failed", error);"*.
  The wrapper forwards only a failed chunk load to the card
  (`figure-canvas-loop.ts:98-104`). So today a browser without WebGPU
  (`shared-gpu.ts:64`, *"this browser has no WebGPU (navigator.gpu is
  missing), and the scene renderer has no Canvas2D fallback"*) leaves an
  empty canvas shell on the card.
- **Headless no-adapter error today.** `runner.ts:200`:
  *"no GPU adapter (Dawn found none)"*, thrown before any transcript exists.
- **Headless result type.** `RunResult` (`canvas-loop/src/headless/recorder/frame-recorder.ts:13-16`)
  carries `errors` as strings, so a class cannot be recovered from it. Hence
  the thrown-error contract in C2.
- **Timeout (reuse, reword).** `run.ts:178-180` reports *"a sketch that never
  returns (an endless loop in init, update or draw?)"*. On a software driver a
  slow render can also hit it.
- **Bundling of canvas-loop's npm deps.** `bundle.ts:60-62`: *"canvas-loop is
  a private workspace package that exports TypeScript source … inline it (its
  own npm dependencies stay external, declared by beebox)"*. beebox declares
  `@napi-rs/canvas` (`package.json:158`) this way; `webgpu` follows. Because
  canvas-loop is inlined into the bundle, `instanceof` against canvas-loop's
  error classes works inside `run-one`.
- **Server install.** deploy.sh syncs canvas-loop (`deploy.sh:550`,
  `SHIPPED_DIRS=(personal-vibe-check tap-check canvas-loop beebox)`) and runs
  `pnpm install --frozen-lockfile` at the workspace root
  (`deploy.sh:454`). With `nodeLinker: hoisted` (`pnpm-workspace.yaml`),
  canvas-loop's own `webgpu` dependency is hoisted once the branch lands.
  `main` has no `webgpu` today (`git show main:canvas-loop/package.json`
  names none), so the live server has no Dawn before the merge. The beebox
  declaration matters for the packed install: the Docker image installs
  `/app/beebox.tgz` (`docker/Dockerfile:197,217-220`), which carries only
  beebox's own dependencies.
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
- **Rollback mechanics.** `docs/server/deploying.md:110-121`: after a failed
  check the deploy switches back to `previous` by itself, but *"Rollback
  refuses when a box applied a migration the previous engine does not know
  … when a box's manifest is missing or cannot be read, or when `previous`
  already failed"*; then *"fix forward, or deploy a chosen commit with
  `--ref`"*. `deploy/AGENTS.md`: deploy.sh *"requires a local
  `deploy/target.env` so deployment remains main-checkout-only"*.
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
- **Frontend component tests** render presentational parts with
  `renderToStaticMarkup` (`src/frontend/test/components/PdfCardView.pdf-card.test.ts:13-14`);
  that test notes the Markdoc container does not load under plain Node, so
  the container is covered by the browser pass. `FigureView` has no test today.
- **Theme Studio harness.** `src/frontend/src/pages/dev/components/ThemeStudioHarness/figure.tsx:8,28-31`
  mounts a sketch with `mountSketch`; its calls (`v.background`, `v.circle`)
  exist in the scene API.

## Prior art (external)

- **WebGPU in Safari is on by default from version 26** on macOS, iOS, iPadOS
  and visionOS; Chrome desktop since 113, Android 12+ since 121; Firefox on
  Windows since 141, on macOS from 145/147, Linux Nightly only.
  <https://github.com/gpuweb/gpuweb/wiki/Implementation-Status>. Evaluated
  only; it is why the notice gives device-neutral advice.
- **WKWebView follows WebKit's default, not Safari's feature flags**: a WebKit
  contributor, <https://developer.apple.com/forums/thread/770862>. So the iOS
  app's webview has WebGPU on iOS 26 and not on iOS 18. Evaluated only.
- **Other iOS browsers use WebKit unless they hold an alternative-engine
  entitlement**, which is regional:
  <https://developer.apple.com/support/alternative-browser-engines/>. So
  naming a desktop browser does not help an iPad user. Evaluated only.
- **iOS 26.0–26.3 WebGPU canvas flicker**, fixed in 26.4:
  <https://bugs.webkit.org/show_bug.cgi?id=301627> (duplicate of 302711).
  Evaluated only.
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
- **`cl.mountSketch`** (exists): after (a), the one browser mount, backed by
  the scene renderer.
- **Renderer marker** `export const renderer = "scene"` (exists, chunk 6b):
  removed by (a); an entry that still exports it is ignored
  (`canvas-loop-scene-core.subplan.md:621-622`).
- **`RemovedCallError`** (new, from (a)): thrown by a removed `View` member
  (`v.ctx`, `v.cache`, `v.sprite`, `v.image`, `v.paperTexture`;
  `scene-api-draft.md:27-38`), with `call` and `replacement` fields. The
  card's "needs updating" signal.
- **`NoWebGpuError`, `NoGpuAdapterError`** (new, from (a)): no `navigator.gpu`;
  no adapter (browser or Dawn). `SketchMountError` stays for a bad module.
- **Figure slot** (new, a layout idea in `FigureView`): the place in the page
  or embed layout where the figure, its loading status or a notice goes.
- **Figure notice** (new UI): the slot's message when a figure cannot draw:
  `outdated`, `no-webgpu`, `no-adapter`, or `error` (today's "Figure error").
- **Dawn probe** `deploy/server-bin/dawn-probe.ts` (new): a standalone Node
  script that opens Dawn from a given `node_modules` and prints the adapter.
  Used before the merge (P1) and by the deploy helper. Not a `bbx` verb.
- **`bbx-figure-gpu-install`** (new): the deploy-time root helper that installs
  `mesa-vulkan-drivers` and runs the Dawn probe as a box user.
- **Regeneration prompt** (new text, in this plan only): what the boxholder
  sends the courseware agent. Not a procedure or a card.

## Tracks / scope

### What (c) needs from (a), and the order

(c) builds on subplan (a) (`canvas-loop-scene-core.subplan.md`), whose
"Seams for subplans (b) and (c)" table answers these needs. Before C2 and C3
start, (a) must provide:

1. **One browser mount named `mountSketch`** in `@ianbicking/canvas-loop/browser`,
   with today's options, backed by the scene renderer, loading the GPU code
   lazily.
2. **Every failure after mount goes to `onError`**, once.
3. **Stable error classes**: `RemovedCallError` (message names the
   replacement and the doc section), `NoWebGpuError`, `NoGpuAdapterError`.
4. **A headless entry**: the async `teaRun` taking a loaded module, with
   `frames`, `every`, `seed`, `events`, `initialParams`, `outDir` and scene
   outlines, returning `RunResult`.
5. **Transcript parity** for what box guidance promises: input lines
   (`mousedown (5,5) → dot`), `Δmodel`, `(unhandled)`, `activity {…}`,
   snapshot labels, text-overlap and font warnings, and a transcript when
   `draw` throws (`test/cli/commands/figure/run.test.ts:53-56`).
6. **Docs:** `canvas-loop/TEA.md` and `BRUSHES.md` describe the scene API.
7. **No `GPUDevice` reaches sketch code.**
8. **The headless no-adapter contract**, shared with (a): when Dawn finds no
   adapter, `teaRun` **writes the transcript** (its header and the failure
   line) **and then throws `NoGpuAdapterError`**, with `transcriptPath` on the
   error. It is not returned in `RunResult.errors`, whose strings cannot carry
   a class. (a) states the same contract, `transcriptPath` included.
9. **The beebox marker removal** in `run-one.ts`, `figure-canvas-loop.ts`,
   `FigureMount.tsx` and their tests (`canvas-loop-scene-core.subplan.md:618-623`).

**Order.** (a), (b) and (c) reach `main` in **one merge**, or (b) lands on
`main` first and (a) with (c) in the next merge. In both cases subplan (b)'s
chunks 1–6 (GPU brush expansion) are in before the cutover: Checkpoint 4
chose GPU expansion for the missed browser targets (`checkpoint4.md:113-114`),
and (a) interleaves (b)'s chunks 1–6 before its own switch
(`canvas-loop-scene-core.subplan.md:684-696`). (a) never reaches `main`
without (c): `canvas-loop/` is a deployed path (`bin/deployed-paths.ts:21-22`),
so (a) alone would deploy a canvas-loop without the Canvas2D painter under a
beebox whose card and guidance still describe it. Regeneration (P3) runs after
the cutover, so courseware figures are regenerated once, against (b)'s ink.

### C1. The dependency, the Dawn probe and the host driver

- **What:** beebox declares `webgpu`; a standalone Dawn probe exists; the
  server, the cloud-init example and the Docker image install Mesa's software
  Vulkan driver; each deploy proves Dawn finds an adapter as a box user.
- **Why:** the bundled `bbx figure run` chunk imports `webgpu` as an external
  (`bundle.ts:59-62`); a packed install without it fails at the first figure
  run. Without a usable Vulkan driver Dawn finds no adapter (`runner.ts:200`).
- **Direction:**
  - `beebox/package.json` dependencies: `"webgpu": "0.6.2"` (the version
    canvas-loop pins). Use the repo's dependency process: edit, `pnpm install
    --lockfile-only`, check the lockfile diff holds only this, `pnpm
    install`.
  - A test that every runtime dependency of `canvas-loop/package.json` appears
    in `beebox/package.json` dependencies at the same version.
  - `deploy/server-bin/dawn-probe.ts`: `node dawn-probe.ts <node_modules dir>`
    imports `webgpu` from that directory, calls `create([])`, requests an
    adapter and a device, prints one line (`adapter: <description>, type:
    <cpu|gpu>`), exits 0; exits 1 with the reason when there is no adapter.
    Plain TypeScript run by Node's type stripping, as the deploy-releases
    helper is run (`docs/server/deploying.md:96-98`). It depends on nothing
    in beebox, so it runs against any directory that holds `webgpu`.
  - `deploy/server-bin/bbx-figure-gpu-install <engine>` (bash, root,
    idempotent), modelled on `bbx-codex-sandbox-install`: install
    `mesa-vulkan-drivers` when `dpkg-query` says it is absent; then, as one
    existing box user with the `box-sandbox.conf` properties through
    `systemd-run`, run the probe against the release's `node_modules`. It must
    report an adapter. Quiet on success, complete on failure. No box user yet:
    skip the check, as the Codex helper does.
  - `deploy.sh`: run it after the Codex sandbox step (`deploy.sh:1001-1002`),
    same stdin pattern; the probe file rides in the release.
  - `deploy/hetzner/cloud-init.yaml` packages: add `mesa-vulkan-drivers`
    with a comment naming the helper.
  - `docker/Dockerfile` runtime `apt-get install` (line 99): add
    `mesa-vulkan-drivers`. If C5 finds bookworm's Mesa does not work with
    Dawn, the base image moves to `node:24-trixie-slim` in this chunk; that
    choice is recorded in C5's notes before C1 is committed.
  - `docs/server/provisioning.md` and `deploying.md`: one paragraph each.
- **Vocabulary lock-ins:** `dawn-probe.ts`, `bbx-figure-gpu-install`. No new
  `bbx` verb.
- **First chunk (no open questions):** the dependency, the dependency test,
  the probe, the helper, the deploy step, cloud-init and Dockerfile lines.

### C2. `bbx figure run` on the scene runner

- **What:** after (a)'s change to `run-one.ts`, beebox catches the no-adapter
  error by class, rewords two messages, and passes `--scene` through.
- **Why:** the agent must tell "the server cannot render" from "my sketch is
  wrong", and a slow software render must not read as an endless loop.
- **Direction:**
  - In `runFigureOne`'s catch (`run-one.ts:109-112`): `error instanceof
    NoGpuAdapterError` prints `{ transcript: error.transcriptPath, errors:
    [text] }`, where text is: "no GPU adapter: Dawn found no GPU it can use
    here. Possible causes: no Vulkan driver is installed (on Linux, Mesa's
    mesa-vulkan-drivers), the driver does not load inside the box's sandbox,
    or the driver rejects this machine. Ask the boxholder; rewriting the
    sketch will not help." The mapping is a pure function,
    `runErrorText(error)`.
  - Timeout reword (`run.ts:179`): "stopped after 60 s: an endless loop in
    init, update or draw, or rendering too slow here (each captured frame is
    rendered; try fewer frames, a larger --every, or --timeout)".
  - `--scene [first]` on `bbx figure run`, passed to `teaRun`'s scene-outline
    option. Document it in `bbx-commands.ts` and the schema instructions.
  - `run.ts:150-157`: keep only the warning pattern (a)'s transcript writes.
  - Tests: `runErrorText` for a constructed `NoGpuAdapterError` and for other
    errors; the starter sketch runs clean in a temp box
    (`figureStarterSketch("canvas-loop")`); a sketch calling `v.cache` fails
    with text naming `v.picture`. **Integration case:** `run.test.ts` runs the
    real child with `VK_DRIVER_FILES` (and the older `VK_ICD_FILENAMES`) set
    to one isolated manifest path that does not exist, so the Vulkan loader
    loads no driver; the setup itself is checked first by asserting the
    child reaches `NoGpuAdapterError`, not some other failure. The test
    then checks the result has the reworded
    error and a transcript that exists. It applies on Linux only (macOS uses
    Metal) and is skipped on macOS with that reason; C5 runs it in the VM,
    and the deploy helper's probe covers the server.
- **Vocabulary lock-ins:** `--scene`, `--scene first`, as in canvas-loop's
  CLI (`canvas-loop-scene-core.subplan.md:366-367`).
- **First chunk:** the catch, the rewording, `--scene`, tests.

### C3. The card: errors to the card first, notices in the figure slot

- **What:** the wrapper hands every mount failure to the card first; the card
  shows the right notice in the figure's slot inside the existing page and
  embed layout.
- **Why:** today a browser without WebGPU shows a blank shell, and any card
  error drops the description and caption (`view.tsx:113-125`).
- **Direction:**
  - `figure-canvas-loop.ts` `wrap`: build `onError` as: first
    `harness.onError(error)` in its own `try`; then, if the sketch passed one,
    the sketch's `onError(error)` in a separate `try`, logging a throw with
    `console.error("figure sketch onError threw", e)`. The host always gets
    the error, whatever the sketch's callback does.
  - `FigureMount.tsx`: `onError` takes `unknown` and passes it through.
  - `view.tsx`: split the layout from the state. A presentational
    `FigureLayout({ mode, caption, description, children })` holds the
    existing page/companion and embed shapes (`view.tsx:139-165`); the
    container computes one slot (loading status, a notice, or the mounted
    figure) and always renders it through `FigureLayout`. The early returns
    at `view.tsx:113-125` become slot values. Unknown runtime, missing entry,
    compile error and no default export also show in the slot.
  - A pure `figureNotice(error): { kind: "outdated" | "no-webgpu" |
    "no-adapter" | "error"; detail: string }`, matching (a)'s classes by
    `name`, since the card receives errors from a lazily loaded chunk. The
    `outdated` case also calls `console.warn` once with
    `figure <card path>: needs regenerating: <detail>`.
  - Notices use `<Notice tone="warning">` with the Design section's wording;
    `error` keeps `FigureError`.
  - Tests: `figureNotice` per kind; `FigureLayout` rendered with a notice in
    the slot shows the description in page mode and the caption in embed
    mode (`renderToStaticMarkup`); the wrapper with a sketch `onError` that
    throws still delivers the error to the host, host first. The full
    container is checked in the browser in C5.
- **Vocabulary lock-ins:** notice kinds `outdated`, `no-webgpu`, `no-adapter`,
  `error`; `FigureLayout`.
- **First chunk:** the wrapper's error order and its test; then the layout
  split with its tests; then the notices.

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
    "canvas-loop figures draw with WebGPU. A device without it shows a notice
    in place of the figure; do not switch a figure to another runtime for
    this unless the boxholder asks." Add `--scene` under "Checking a
    canvas-loop figure". The `bbx figure run` paragraph keeps only claims
    (a)'s transcript keeps (need 5).
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
    `figure-no-webgpu` ("A learner says a figure shows 'This figure can't
    draw on this device'. What do you do?": explains the device or browser
    lacks WebGPU, suggests updating it or another device, does not rewrite
    the figure). Re-run the existing `figure-canvas-loop-*` audits.
- **First chunk:** schema instructions and starter with the starter test.

### C5. Measure on a VM like the server (no source)

- In a local Lima VM (not production): Ubuntu 24.04 with
  `mesa-vulkan-drivers`, 3 CPUs to match the example `cpx21`; and the Docker
  image built from C1. Run `bbx figure run` cold (new process each time) on
  the starter and the chemistry port at the default 120 frames, `--every 30`.
  Record wall time, peak RSS, and the Mesa shader-cache size under `$HOME/.cache`.
  Run C2's Linux integration case there.
- Pass: each under 15 s cold, RSS under 1 GB. A miss changes C2's defaults
  (fewer captured frames) before production, not the timeout.
- Notes go in `beebox/docs/plans/canvas-loop-scene/stage5/figures-timing.md`.
- An exhibit, captured in the worktree's dev router: a working chemistry
  figure; the "needs updating" and "can't draw on this device" notices, each
  in page mode with the description and embedded in a card with its caption.

### Production steps — each needs the boxholder's own yes

- **P0 (optional, needs a yes because it reads courseware content).** The
  boxholder, or an agent they name, runs the new engine's `bbx figure run`
  against a local clone of the courseware box to see which figures fail
  before the cutover. Nothing from it goes into public docs.
- **P1. Mesa and a Dawn probe on the server before the merge.** As root over
  `deploy/prod-ssh`: `apt-get install -y mesa-vulkan-drivers`; install the
  pinned `webgpu@0.6.2` with `npm install --ignore-scripts` into a root-owned
  throwaway directory a box user can read (for example
  `/usr/local/lib/beebox/dawn-probe/`); copy `dawn-probe.ts` there over stdin;
  run it as one box user through `systemd-run` with the `box-sandbox.conf`
  properties, as `bbx-codex-sandbox-install` does. Record the adapter line,
  `nproc`, and the probe's time. Then delete the directory. The live engine
  is not touched and no `bbx` verb is needed; installing Mesa changes nothing
  that runs today.
- **P2. The merge to `main`.** This is the cutover; the post-commit hook
  deploys. Inside the deploy: release prepared and installed (`webgpu`
  included), switch, restart, then `bbx-figure-gpu-install` (installs Mesa if
  P1 was skipped, and probes). After it: open one figure in the boxholder's
  browser, and confirm `.claude/rules/card-figure.md` in the courseware box
  carries the new text after its next chat starts.
- **P3. Regeneration.** The boxholder sends the courseware agent the prompt
  below, in the scope chosen at Checkpoint 5, when they choose.

### Regeneration prompt (for the boxholder to send)

Shared part:

> canvas-loop changed: `draw` now records a scene that WebGPU draws. Read
> `card-figure.md` and `canvas-loop.md` first. Run `bbx figure run` with no
> card to check every canvas-loop figure. When you rewrite a sketch, keep
> what it teaches, its module params, the card's `params:`, its description
> and its events file; run `bbx figure run <card>` until it has no errors and
> look at the frames. Commit each figure on its own. Do not change figures in
> other runtimes. Tell me anything you could not keep.

Then one of, per the Checkpoint 5 decision:

- **Failing only:** "Rewrite each figure that fails. Leave figures that pass,
  and list them for me."
- **All:** "Rewrite each figure that fails. For each figure that passes, look
  at its frames against its description; rewrite it where the drawing no
  longer shows what the description says, or uses a removed pattern, and
  list the ones you left with one line each on why."

### Rollback

- **Engine, automatic:** a failed check after the switch rolls back to
  `previous` by itself, except when a box applied a migration the previous
  engine does not know, a box manifest cannot be read, or `previous` already
  failed (`docs/server/deploying.md:110-121`). Then the services stay on the
  new release and the deploy fails.
- **Engine, by hand:** `./deploy/deploy.sh --ref <sha before the merge>`, run
  from the configured main checkout (deploy.sh refuses without a local
  `deploy/target.env`, `deploy/AGENTS.md`). It is a full deploy, so the same
  migration rule applies; this plan adds no box migration.
- **Mesa and the probe directory** stay installed and are inert.
- **Regenerated figures under the old engine:** sketches using only calls
  both APIs share still draw; ones using new calls (`v.picture`, `lighting`)
  fail with today's "Figure error". The courseware agent can `git revert` its
  per-figure commits if the boxholder asks. Rolling back after P3 is therefore
  a boxholder decision with a cost; the plan recommends fixing forward.

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

The simplest version is the smallest fix above. It fails on a learner's iPad
without WebGPU, where the card is a blank shell (`mount.ts:237`), against "a
clear error on the card, not a blank" (`canvas-loop-scene.md:398`) and
`beebox/AGENTS.md`'s "no silent fallbacks"; it drops the lesson's caption and
description whenever a figure fails; and it leaves the agent writing figures
from docs that describe removed calls.

Smaller still was considered for the notice: one generic "Figure error" with
the raw message. It works for the agent but tells a learner
"NoWebGpuError: …", which does not say whose problem it is. The two warning
notices cost one pure function and two strings. The layout split is the
smallest change that keeps the caption and description: the slot replaces
four early returns.

Two things were left out as over-builds: a server-rendered still image for
devices without WebGPU, and a version marker that would flag every old
sketch at load (see NOT in scope).

## Subplans

None. This is itself subplan (c).

## Failure modes

> **Critical gap (closed by C3):** the scene mount on a browser without
> WebGPU — the card shows an empty canvas shell and the error goes only to the
> console (`mount.ts:237`, `figure-canvas-loop.ts:98-104`). C3 routes it to
> the card, host first; its tests are listed below.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Browser without WebGPU (iOS 18 webview, Firefox on Linux) | C3 adds one | C3: notice in the slot | clear after C3 (silent today) |
| Any card error hides the description and caption (`view.tsx:113-125`) | C3 adds layout tests, both modes | C3: slot inside `FigureLayout` | clear after C3 |
| The sketch's own `onError` throws and the card never hears | C3 adds one | C3: host called first, each in its own `try` | clear |
| WebGPU present, no adapter (GPU blocklisted) | C3 adds `figureNotice` case | C3 notice | clear |
| Old sketch calls a removed member only on one branch (after a click) | C2 adds headless case | (a)'s error, C3 notice when it happens | clear, but only once reached |
| Old sketch draws without error but looks different (`v.paper` now scoped to its group) | no | depends on the Checkpoint 5 decision: "all" has the agent review every passing figure's frames; "failing only" leaves it to the boxholder | silent under "failing only" |
| Packed install lacks `webgpu` | C1 dependency test | import error from `run-one` | clear |
| Server has no usable Vulkan driver | C1 probe at deploy; C2 Linux integration case | deploy fails with the probe's output; at runtime C2's possible-causes text | clear |
| Mesa installed but Dawn rejects it (old Mesa, bookworm image) | C5 measurement | C1 base-image decision | clear at C5 |
| Software render too slow: run hits 60 s on a lit figure with many events | C5 measurement | C2's reworded timeout | clear |
| Several boxes run figures at once and contend for CPUs | no | none; runs take longer | clear (timeout message) |
| Box memory: Dawn and lavapipe in the child push the box past `MemoryMax=2560M` | C5 measures RSS | OOM kills the child; `run.ts:186` reports the exit | clear |
| Mesa shader cache grows in each box user's home | C5 measures | none planned | silent; measured in C5 |
| iOS 26.0–26.3 canvas flicker (WebKit bug) | no | none; fixed in iOS 26.4 | visible to the person |
| A regenerated figure drops a param an embed link sets | existing param-mismatch console warning (`figure-canvas-loop.ts:46-59`) | the prompt says keep params | clear in console only |
| Theme Studio screenshots (theme-check) in a browser without WebGPU | no | C3 notice shows instead | clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** the agent keeps `export const renderer` or calls
  `cl.mountSceneSketch` from a spike-era copy. ADDRESSED: (a) ignores the
  marker; `mountSceneSketch` is not a function, so the slot shows "Figure
  error" naming it; the starter and instructions mention neither.
- **Stale ref:** the agent regenerates a figure whose events file names an
  old param. ADDRESSED: `parseTeaEvents` refuses an undeclared param name
  (`run-one.ts:86`), and the prompt says keep params.
- **Two agents on one card:** a learner's chat and the regeneration run touch
  the same figure. DEFERRED: same as any card edit today; live refresh
  reloads the new entry (`view.tsx:99`).
- **Hand-edit drift:** the boxholder edits a sketch by hand with an old call.
  ADDRESSED: same `outdated` notice.
- **Fabricated free-form value:** the agent claims a figure was checked.
  ADDRESSED in part: the prompt asks it to look at frames; `bbx figure run`
  exits non-zero on errors.
- **Validation error UX:** ADDRESSED: removed-call text names the replacement
  and the doc section (need 3); no-adapter text lists possible causes and
  says to ask the boxholder (C2).
- **Partial migration / transition state:** between P2 and the end of P3,
  some figures draw, some show "needs updating". ADDRESSED: that is the
  designed state; the prompt finishes it, in the scope the boxholder chose.
- **Agent switches runtime to dodge WebGPU:** ADDRESSED by the instruction
  sentence and the `figure-no-webgpu` audit.

## NOT in scope

- **Server-rendered still image for devices without WebGPU:** possible later
  (the server can render frame 0 with Dawn); not now because it adds a route
  and a cache for a case the boxholder may never meet. Boxholder override.
- **A version marker that flags every old sketch at load:** not now; removed
  calls fail with a named error, and the Checkpoint 5 decision covers old
  sketches that still draw. Boxholder override.
- **Raising the iOS app's deployment target to iOS 26:** a separate iOS
  decision; the notice covers iOS 18.
- **A Canvas2D or WebGL fallback renderer:** the boxholder chose one WebGPU
  renderer (`checkpoint4.md:112`).
- **Figure isolation in iframes:** the open isolation issue owns it.
- **Automatic regeneration on deploy:** the boxholder triggers it.
- **GPU brush expansion itself:** subplan (b); this plan only requires its
  chunks 1–6 before the cutover.
- **Changes to p5, three and d3 figures:** untouched, except that their
  errors now also show inside the layout (C3).
- **The `mobile-contract.md` index:** no HTTP, bridge or URL change; the iOS
  webview loads the same pages (`ChatWebView.swift:264-268` uses a default
  `WKWebViewConfiguration`).

## Open design questions

- **Checkpoint 5 decision: how far regeneration goes.** Old sketches that do
  not call a removed member still draw, but may look different (for example,
  `v.paper` now applies to its group only). The chemistry port shows one such
  figure needed only small changes (`stage4-plan.md:137-139`); that is one
  example, not evidence about the rest.
  - *Failing only.* A learner meets a "needs updating" notice until the
    agent's run, then the rewritten figure. A figure that still draws stays
    as it is, and if its look changed in a way that matters to the lesson, the
    learner sees the changed drawing until someone notices. Cost: the
    fewest agent runs and the fewest changed figures.
  - *Regenerate or visually review every courseware figure.* A learner meets
    either the rewritten figure or one the agent looked at against its
    description. Cost: one agent pass over every canvas-loop figure in the
    courseware box, each with a `bbx figure run` (seconds to tens of seconds
    on the server, C5) and model time; more figures change.
  - Lean: **review all**. The box agent regenerates cheaply, and the
    boxholder said the figures "can be regenerated".
- **Learner wording of the notices.** The Design section has drafts; the
  final words are the boxholder's call. Lean: neutral, with no invitation to
  ask, since the boxholder decides when regeneration runs.
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

- **Unit tier:** `figureNotice` and `runErrorText` (pure); the dependency
  declaration test; the wrapper's error order with a throwing sketch
  callback; `FigureLayout` in page and embed modes.
- **CLI tier:** `test/cli/commands/figure/run.test.ts` runs real figures
  through Dawn on the developer's Mac (Metal); new cases for the starter and
  a removed call. The no-adapter integration case runs only on Linux, which
  the hourly suite does not have; on the server the deploy helper's probe
  holds the same path and fails the deploy when Dawn finds no adapter as a
  box user.
- **Browser:** the full `FigureView` container with a failing figure is
  checked in C5's exhibit, not by a kept test.
- **No new test tier.** No mock of Dawn: the tests use the real one.

## Implementation order

1. Subplan (a) through its switch, with (b)'s chunks 1–6 interleaved as (a)
   orders them (`canvas-loop-scene-core.subplan.md:684-696`); (a) delivers
   needs 1–9.
2. C1 drafted, uncommitted: dependency, dependency test, probe, helper,
   deploy and image lines.
3. C5 VM half, on the C1 draft: Ubuntu 24.04 and bookworm with Mesa; the
   Dawn probe and `bbx figure run` on the starter. Settles the Docker base
   image. Notes. Then C1 is committed with that image choice.
4. C2: `bbx figure run`. Commit.
5. C3: wrapper, layout, notices. Commit; cross-model review of C1–C3.
6. C4: instructions, starter, docs, audits run. Commit.
7. C5 timing and exhibit on the final code. Commit notes.
8. Checkpoint 5 with the boxholder: exhibit, timing, the regeneration scope,
   the notice wording.
9. **P0 (optional, yes needed)**, **P1 (yes needed)**, then **P2 (yes
   needed)** as the one merge of (a), (b) and (c), or after (b) has landed;
   then **P3** when the boxholder chooses.

## Rollout shape

Tests named while designing, done-when:

- `figureNotice` returns `outdated` for `RemovedCallError`, `no-webgpu` and
  `no-adapter` for (a)'s two errors, `error` otherwise.
- The wrapper delivers a mount error to the host when the sketch's `onError`
  throws, and calls the host first.
- `FigureLayout` with a notice in the slot keeps the description (page mode)
  and the caption (embed mode).
- `runErrorText` gives the possible-causes text for `NoGpuAdapterError`.
- `bbx figure run` on the starter in a temp box: `ok: true`, no warnings.
- `bbx figure run` on a sketch calling `v.cache`: `ok: false`, the error names
  `v.picture`.
- On Linux, `bbx figure run` with no Vulkan driver: the possible-causes error
  and an existing transcript.
- The four existing `run.test.ts` cases pass.
- Every canvas-loop runtime dependency is declared by beebox at the same
  version.
- `pnpm typecheck`, `pnpm lint:changed`, `pnpm layout-check`, `pnpm ui-check`
  pass; the knowledge audits pass on the test box clone.

No data migration: figure cards keep their shape (`bbx-migration` does not
apply; the sketches are regenerated by the box's agent, not by a script).

## Review round 1

Cross-model review by Codex (gpt-6-sol), 2026-11-15, 7 findings, each
checked against the source. All seven hold and are fixed:

1. Notices hid the description and caption (`view.tsx:113-125`): C3 now
   renders every state in a slot inside `FigureLayout`, tested in both modes.
2. Merge order let (b) land later: (b)'s chunks 1–6 are now required before
   the cutover, in one merge with (a) and (c) or landed first.
3. Visual drift was called accepted: now a Checkpoint 5 decision with both
   options, their outcomes for a learner, costs, and a lean (review all).
4. No-adapter could not be caught from `RunResult.errors` (strings): the
   shared contract is now "write the transcript, then throw
   `NoGpuAdapterError`", caught by class; the text lists possible causes;
   a Linux integration case is added.
5. P1 relied on a `bbx` verb the live engine lacks: replaced by a standalone
   `dawn-probe.ts` run against a pinned throwaway install; rollback now
   states `deploying.md`'s refusal cases and the main-checkout rule.
6. The sketch's `onError` ran first and could swallow the host's: the host
   is now called first, each in its own `try`, with a test.
7. No-WebGPU advice named desktop browsers: now device-neutral (update the
   browser or OS, or use another device), final wording the boxholder's.

Rejected: none. One change came from rechecking (a) during this round: the
beebox marker removal is (a)'s (`canvas-loop-scene-core.subplan.md:618-623`),
so C2 and C3 no longer repeat it, and the error names follow (a)'s
(`RemovedCallError`, `NoWebGpuError`, `NoGpuAdapterError`).

## Review round 2

Codex (gpt-6-sol) verified the round-1 fixes; six held. Fixed after it: the
no-adapter error's `transcriptPath` is now in (a)'s contract too; the Linux
no-driver test points the Vulkan loader at a missing manifest and checks it
reaches `NoGpuAdapterError`; C1 is drafted before the VM run and committed
after the image choice.

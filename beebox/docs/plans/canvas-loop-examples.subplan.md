---
title: "canvas-loop: one set of minimal, instructional examples"
status: active
workstream: canvas-brushes
issues:
  - ../../../issues/code-quality/2026-11-16-canvas-loop-gallery-check-has-no-subset.md
---
# canvas-loop: one set of minimal, instructional examples

A subplan of [canvas-brushes.md](canvas-brushes.md). canvas-loop has two
collections of sketches: `src/gallery/` (48 agent-exercise records) and
`src/examples/` (14 small sketches). This plan replaces both with one set of
thirteen minimal examples in `src/examples/`. Each example teaches one
thing that the API docs do not, or is a small realistic figure for one area
(input, sound, brushwork, effects, light). Each example's events file drives
its check: the run must be clean, warning-free, deterministic, and every
scripted input must engage. The gallery directory, its schema and its corpus tooling go; git history
keeps them.

The boxholder's words (2026-11-16): *"We should only have minimal examples.
Maybe it's worth thinking those through as a kind of instructional material
too, and gallery."* *"I can see some purpose for a gallery of realistic but
somewhat minimal examples. They might be 'minimal' in that some exercise just
interesting brushwork, some input, etc."* *"definitely intermediate things
like model comparisons don't make any sense."* *"You might use them as a way
to mine for the examples worth showing. If something is obvious to you when
reading, then it might not need explanation!"*

## Decisions and implementation notes

**Boxholder decisions (2026-11-16,** *"okay, sure, go for it"***):**

- Build the full plan at its size (BIG CHANGE approved); the gallery
  deletion and the fixture moves are separate and also approved.
- Open design question 1: commit the built example page as
  `dev/canvas-loop-examples.html` (precedent: `dev/canvas-loop.html`).
- Open design question 2: archived gallery entries live in git history only.
- Open design question 3: no fourteenth `v.pixels` example.
- Keep each example small and on one teaching point; prefer deleting to
  explaining (*"If something is obvious to you when reading, then it might
  not need explanation!"*).

**What implementation changed (2026-11-16):**

- **Fixture location.** The layout check places test support beside its
  importers, so the three fixtures moved to `test/gpu/<name>/`, not
  `test/fixtures/scenes/<name>/`. The lint globs follow (`test/gpu/*/*-tea.ts`).
- **Order.** Track D (the gallery deletion) landed before C1: doc-check
  failed C1 because gallery `task.md` files named the retired examples.
  AGENTS.md's Examples section and TEA.md's two gallery mentions moved into
  D for the same reason.
- **Closing snapshot.** The last frame must hold *a* snapshot; a `param` on
  that frame is allowed (set a look, then snapshot it). A later stray input
  still fails.
- **The check** also fails on framed `error:` log lines, and lints every
  example in one eslint run. It runs the thirteen in about 9 seconds, so the
  subset issue stays on this plan's list.
- **The playground page.** `build:playground` writes the tracked page
  instead of the ignored `src/browser/dist/`.
- **The knowledge audit entry** needs `expected_level` (`knows_about`); it
  passed on its first run.

**Issues addressed:**
`issues/code-quality/2026-11-16-canvas-loop-gallery-check-has-no-subset.md`
(*"`gallery:check` renders every exercise and takes 10–11 minutes"*). The
check over thirteen small examples should be short enough to run whole; this
plan adds no subset filter (see NOT in scope). Done-when gates that claim: if
the measured run exceeds two minutes, the issue is taken off this plan's list
and stays open. Related, not closed:
`issues/code-quality/2026-11-16-doc-code-blocks-are-not-checked.md` (fenced
blocks in TEA.md and BRUSHES.md stay unchecked; the examples they link become
checked) and
`issues/code-quality/2026-11-16-canvas-loop-compare-and-speed-harness-in-scratch.md`
(its tool would render the examples). Searched `issues/` for `gallery`,
`canvas-loop`, `examples`: no other open item matches.

## Design

No design section: the examples are developer and agent material, and nothing
here changes what a person meets in the box. The readers, and when they read:

- **A box agent writing a figure.** It reads `canvas-loop.md` and
  `canvas-loop-brushes.md` (TEA.md and BRUSHES.md shipped as box docs) when it
  writes a canvas-loop figure, and it reaches for an example when the API
  reference does not show how pieces fit (a drag, a sound, a lit room). Today
  it cannot read any example: see *What already exists*, box docs.
- **A dev agent changing canvas-loop.** It reads an example linked from the
  doc section it is working in, runs it as a test, and adds one when it adds a
  feature that the docs alone cannot teach.
- **The boxholder.** Browses the set in the playground to see what the
  library can do and to judge the brushwork by eye.

## Smallest fix and budget

**Smallest fix:** delete `src/gallery/` except the three renderer fixtures,
move those fixtures, and fix the links. It removes the experiment records but
leaves the examples as they are: two of them pre-date named hits, half build
their drawing with `out.push` (TEA.md:146-148 tells readers not to copy that
form), nothing renders most of them, and box agents still cannot read them.

**Chosen design:**

| Track | Source | Tests | Docs |
| --- | --- | --- | --- |
| A. Move the three renderer fixtures | ~15 (import paths, lint glob) | 0 | 0 |
| B. `examples:check` replaces `gallery check` | ~150 | ~40 | 0 |
| C. The example set: 3 new, 1 merged, 5 rewritten, 4 kept, 5 retired; events files; registry; dev demo | ~1,130 added or changed, ~760 deleted | ~80 | 0 |
| D. Delete `src/gallery/` | 0 authored | 0 | ~120 deleted (README) |
| E. Canvas-loop docs link the examples | 0 | 0 | ~150 |
| F. Box docs ship the examples | ~45 | ~20 | ~5 (figure.ts) |

Authored change, additions plus deletions, excluding the gallery deletion:
about 1,440 source, 140 test, 275 docs, so about **1,850 lines, plus about 760
deleted lines of retired examples: about 2,600 in all. BIG CHANGE.** The size
comes from writing three new examples and rewriting five. The boxholder
approved BIG CHANGE for this workstream on 2026-11-11 (canvas-brushes.md,
"Smallest fix and budget": *"Big change is fine anywhere here"*); this plan
names the size so the boxholder can say otherwise.

Listed separately, because they are pure deletions or moves:

- **Gallery deletion:** 45 directories, about 173,600 lines (539 files with
  the fixtures), of which about 133,000 are `history/` text. Pure deletion.
- **Fixture moves:** three directories, about 9,000 lines of `.ts`, moved
  unchanged (git renames).
- **Generated output:** `dev/canvas-loop.html` is rebuilt (Track C) and,
  if the boxholder agrees, a built playground page (Open design questions).

This plan file and its review are not counted.

## Stated preferences this plan trades against

- **The boxholder's examples rule** (quoted at the top). An example earns its
  place only by teaching something the docs do not, or by being a small
  realistic figure for one area. Model comparisons, reruns and intermediate
  records go.
- **Minimal invented concepts** (boxholder memory, "prefer primitives"). The
  set uses the existing flat `src/examples/<name>-tea.ts` +
  `<name>-tea-events.json` convention. No `meta.yaml`, no manifest: the run
  length comes from the events file (Track B).
- **Bias toward strict** (boxholder memory). `examples:check` requires an
  events file for every example and fails on any transcript warning, which
  `gallery check` did not.
- **No backward compatibility** (canvas-brushes.md, *"there's no outstanding
  uses of this"*). `gallery check` and `pnpm gallery:check` are renamed, not
  aliased. The CHANGELOG records it.
- **Lint rules unchanged.** The sketch exemptions in
  `canvas-loop/eslint.config.ts:44-60` (*"Boxholder-authorized loosening for
  sketches only (src/examples, src/gallery)"*) follow the moved fixture files
  to their new path; no rule is loosened for new code.
- **Byte determinism per runtime** (BRUSHES.md:476-481). The fixture moves
  must not change a pixel: the GPU tests' golden numbers depend on the walker
  frame.

## What already exists

- **The gallery check** — `canvas-loop/src/headless/gallery.ts:1-7`: *"renders
  every src/gallery/<slug> exercise, asserts run-twice byte-identical
  determinism, and lints its sketch file. Before rendering, one type check
  covers every sketch"*. It reads `meta.yaml` for `frames`
  (`gallery.ts:80-81`) and an optional `events.json` (`gallery.ts:111-112`).
  **Reuse:** keep the type check, the double run, the byte diff and the lint
  call; replace directory discovery and `meta.yaml` with flat files.
- **CLI entry** — `canvas-loop/src/headless/cli/main.ts:140-146` dispatches
  `gallery check`; `canvas-loop/package.json:41` *"gallery:check": "node
  --import tsx src/headless/cli/main.ts gallery check"*.
  `canvas-loop/src/exports/headless.ts:29-31` exports `checkGallery`.
- **Its tests** — `canvas-loop/test/headless/sketch-types.test.ts:127-147`
  build throwaway gallery directories with `meta.yaml` and call
  `checkGallery({ galleryDir })`. They change with Track B.
- **RunResult** — `canvas-loop/src/headless/recorder/frame-recorder.ts:15-20`
  has `errors` only; warnings exist only as transcript lines (TEA.md:163:
  *"the transcript warns with its line: `warn: v.circle made a drawing that
  was not returned …`"*). The warning check reads the transcript.
- **The playground registry** — `canvas-loop/src/browser/app/registry.ts:6-14`
  imports three gallery sketches (`clock`, `particles-opus`,
  `pelican-bicycle`) and six examples. `src/browser/dist/` is gitignored
  (`canvas-loop/.gitignore`, `src/browser/dist/`), so the playground is built
  locally with `pnpm --dir canvas-loop run build:playground`. No other gallery
  browsing page exists.
- **The dev demo** — `canvas-loop/src/dev-demo/main.tsx:17-18` imports
  `orbit-tea` and `fjord-tea`; its built page is the tracked
  `dev/canvas-loop.html` (*"canvas-loop · SketchFigure demo"*).
- **Tests that import examples** — `test/headless.tea-determinism.gpu.test.ts:9,12`
  (orbit and its events), `test/react-ssr.test.tsx:11-12` (orbit and fjord;
  lines 41-60 pass fjord's `tide` and `timeOfDay` params),
  `test/headless/tea-runtime.hits.gpu.test.ts:16,83` (scale and its events;
  line 7: *"gallery:check covers src/gallery/ only, so this test keeps it
  running"*).
- **Tests that import gallery entries as renderer fixtures** —
  `test/gpu/renderer.gpu.test.ts:40-42` (*walkerSheet*, *hallwayPort*,
  *chemistryPort*), `test/gpu/brush-pass.gpu.test.ts:39`,
  `test/gpu/mark-atlas.ink.gpu.test.ts:25`, `test/gpu/walker-frame.ts:13`.
  `brush-pass.gpu.test.ts:165-169` compares the walker's frame 0 against
  `goldenSamples("walker")`, so `intra-walk-styles` must move byte-identical.
  `renderer.gpu.test.ts:247-252` uses the Hallway and chemistry sketches only
  for warm/cold/off cache equivalence (no goldens). All three fixtures import
  only their own siblings (`grep 'from "\.\./'` over the three directories
  finds nothing), so each moves as a unit.
- **Box docs** — `beebox/src/core/docs-gen/package-docs/canvas-loop-doc.ts:1-7`:
  TEA.md and BRUSHES.md ship as box docs, and *"links into canvas-loop's
  source tree become plain text"* (`canvas-loop-doc.ts:30`:
  `.replace(/\[([^\]]+)\]\(\.\/[^)]*\)/gu, "$1")`). So a box agent sees
  `src/examples/orbit-tea.ts` as words with no file behind them. The box docs
  are registered in `beebox/src/core/docs-gen/package-docs/core.ts:69-70`.
  `beebox/src/schemas/figure.ts:189-191` points a figure writer at those two
  docs. **Reuse:** the same `shipped()` pattern
  (`canvas-loop-doc.ts:33-38`, with the packed-install fallback) for a third
  doc.
- **Doc-coverage test** — `canvas-loop/test/docs/view-members.test.ts:1-3`:
  every `View` member is named in TEA.md or BRUSHES.md. Unaffected.
- **Lint scope** — `canvas-loop/eslint.config.ts:30` applies the TEA rules to
  `src/examples/**/*-tea.ts` and `src/gallery/**/*-tea.ts`;
  `eslint.config.ts:54` applies the sketch budget to both trees.
  `canvas-loop/tsconfig.json:20` includes `src/**/*` and `test/**/*`, so moved
  fixtures stay type-checked.

## Prior art (external)

No design decision here depends on an external premise: the work moves and
rewrites files inside one package. No search was made.

## Ontology

- **Example** (existing name, `src/examples/`): one sketch file
  `<name>-tea.ts` and one events file `<name>-tea-events.json`, with one
  teaching point stated in the file's header comment. Identified by `<name>`.
  Not a gallery exercise: it records no task, model or run history.
- **Events file** (existing, README.md "Events file"): the script the
  example's check runs. The largest `frame` among its parsed entries sets the
  run length: the check renders frame indices `0 … maxFrame` (`frames =
  maxFrame + 1`). The entry at `maxFrame` must be a `snapshot`, so the final
  frame is shown on purpose and a stray late input cannot cut the run short.
- **Teaching point**: the one thing an example shows. It lives in the header
  comment and in the one doc section that links the example. Not a field
  anywhere.
- **Renderer fixture** (new location, existing files):
  `test/fixtures/scenes/<name>/`, a realistic sketch a GPU test renders. Not
  an example: no doc links it, no reader copies it.
- **`examples:check`** (renames `gallery check`): the CLI subcommand and pnpm
  script.
- **Playground** (existing): the browser page built from `registry.ts`. It is
  the one browsing view of the examples.
- **`canvas-loop-examples.md`** (new box doc): every example's header and
  source, generated from `src/examples/`.

Removed nouns: gallery, exercise, slug, `meta.yaml`, `task.md`, `runs.jsonl`,
`history/`, `gallery check`.

## Tracks / scope

### Inventory

Every current entry, read in full (sketch and helpers; `history/` skipped).
Lines are `.ts` totals. Verdicts: **keep** (stays, perhaps rewritten),
**mine** (the named technique goes into a target example; the entry goes),
**fixture** (moves to `test/fixtures/scenes/`), **archive** (goes; reason
given). "Obvious" means a reader of TEA.md and BRUSHES.md writes it without
help.

**`src/examples/` (14 sketches):**

| Example | Lines | Exercises | Verdict |
| --- | --- | --- | --- |
| alien-reference | 116 | flat-shape alien: the brush experiment's reference picture | archive: the brush experiment's input; flat shapes are obvious |
| answer-box | 112 | `text` param placed with `v.control`; `activity`; tiles sized by `u.textWidth` with a shared `tiles(measure)` for hit and draw | keep, rewrite: name the tiles and lay them out with `v.row`; the shared-measure hit test is the workaround named hits replaced |
| bounce | 128 | grab, drag, throw with a `hold` mode; `r` resets; README's worked example | keep, rewrite: name the ball, keep the grab offset in the mode (from lens-rays), `v.cursor` |
| brushes | 132 | brush playground: preset, pressure, weight, wobble, paper as params | keep; add an events file; return lists instead of `out.push` |
| brushes-sampler | 55 | every preset with two gestures, static | archive: `brushes` shows the same with params; its "reference images for BRUSHES.md" are not in BRUSHES.md (no image in the file) |
| effects | 115 | blur, glow with screen, shadow, mask fade, `tweenPoint` firefly, sepia | keep; add an events file |
| fjord | 469 | tide scene, port of gallery `fjord-tides` | archive: 469 lines, one scene; gradient-in-clip is a doc snippet. Its two users (dev demo, react-ssr test) switch to `brushes` |
| night-room | 157 | lit group, `castsShadow` heights, `toneCurve`, emissive window, spot light | keep, trim to the lesson; add `v.noise` flicker on the lamp (from scene-night-room-sol) |
| orbit | 277 | every param kind; `reset` trigger restores the model, not params; mode union; clicks a moving planet by position math | keep, rewrite with named planets (drops `hitTest`, about 120 lines) |
| paint-mixing | 69 | smudge, wet, colour jitter, paper | keep; add an events file |
| scale | 111 | names and nested targets; `row` and `column` | keep |
| sound | 111 | notes and samples, a voice id counter, `at` is frame + 1 | keep; name the bars instead of `barAt` |
| still-life | 80 | hatching on a tonal scene | mine → `looks` |
| washed-shapes | 36 | wash on and off | mine → `looks` |

**`src/gallery/` (48 entries):**

| Entry | Lines | Exercises | Verdict |
| --- | --- | --- | --- |
| alien-bezier | 494 | alien outlined with hand-placed beziers | archive: path-form comparison; the shading recipe is BRUSHES.md:388-403 |
| alien-curve | 560 | same alien with `v.curve`; hand-written curve-to-path | archive: comparison; `v.curvePath` replaced its helper |
| alien-polyline | 588 | same alien, straight segments, own samplers | archive: comparison; `curve`, `tube`, `offset` replaced the samplers |
| alien-scene-opus-a | 1,327 | dusk meadow, saucer, fireflies; randomness rolled in `init` | archive: model comparison, project-sized |
| alien-scene-opus-b | 1,106 | same brief | archive: model comparison; rolling randomness in `init` is TEA.md:49-51 |
| alien-scene-sol | 615 | same brief; airbrush dab as a moon glow | archive: model comparison |
| balance-reaction | 1,036 | equation with typed fields | archive: superseded by its rerun |
| balance-reaction-2 | 839 | equation, `v.control` fields inside the drawing | fixture (chemistry cache case); `v.control` in a box is TEA.md:705-716 |
| busy-town-opus | 3,236 | 20 clickable townsfolk; start frame per id; chain reactions from a queue | mine → `lamps` (a start frame per id: `sketch-tea.ts:50-62`, `start: { ...model.start, [id]: at }`) |
| busy-town-sol | 1,016 | same brief | archive: model comparison |
| clock | 152 | polar ticks and hands | archive: obvious; its playground slot goes to an example |
| fjord-tides | 451 | the fjord scene | archive: duplicate of `fjord` |
| game-world-tiles | 1,264 | position-pure `v.pixels` field drawn as seamless tiles | archive: tile-game specific; `v.pixels` is TEA.md:445-448 (see NOT in scope) |
| guitar-strings | 202 | `pluck` voices, strum by crossing strings | archive: `sound` covers the voice rules with the sounds TEA.md recommends; TEA.md:552-553 says use `pluck` *"only when nothing below fits"*. TEA.md:681 link moves |
| gull-market | 2,604 | brushed picture-book page; `form()` painter | archive: its `form()` (`kit-tea.ts:76-127`) is the BRUSHES.md:61-63 crescent and :388-403 clip recipe, composed; the rest is one picture |
| intra-atrium | 587 | per-pixel room, painted statues | archive: project-specific lighting math |
| intra-lounge | 1,121 | ray-traced bake relit per frame; depth-mask occlusion | archive: specialised (see NOT in scope) |
| intra-lounge-drawn | 775 | cached still room, multiply dim, screen glows | archive: the recipe is BRUSHES.md:444-447 |
| intra-lounge-side | 904 | the lounge from the side | archive: near-duplicate |
| intra-map | 1,016 | floor plan; one piece list drawn three ways | archive: project-specific |
| intra-rooms | 6,497 | 31 side-view rooms, camera pan | fixture (Hallway cache case) |
| intra-scale-reference | 396 | units chart | archive: obvious |
| intra-walk-study | 776 | gait with planted feet | archive: animation research, not a canvas-loop lesson |
| intra-walk-styles | 1,683 | keyboard walker, mocap gaits, clothes | fixture (walker goldens) |
| lens-rays | 953 | thin-lens diagram; drag with grab offset; snapping | mine → `bounce` (grab offset kept in the mode: `sketch-tea.ts:50-52`, `110-130`) |
| library-anim | 1,186 | animated story page | archive: model comparison, superseded by the next two |
| nell-anim | 1,941 | drag a lantern; damped swing; eyes follow | archive: hit tests by hand; the swing overlaps `pendulum` |
| open-opus-a | 1,382 | story page, tiled paint rows | archive: model comparison, project-sized |
| open-opus-b | 1,466 | story page, multi-file | archive: model comparison, project-sized |
| open-sol | 968 | story page | archive: model comparison |
| orbit-toy | 203 | click moving planets | archive: `orbit` supersedes it |
| paint-simple | 310 | paint program: strokes as data, speed to pressure, cached layer chain | mine → `paint` (`sketch-tea.ts:199-228` pressure, `265-283` layer chain) |
| particles-opus | 309 | particle fountain, attractor drag | archive: model comparison; its playground slot goes to an example |
| particles-sonnet | 321 | same | archive: model comparison |
| pelican-bicycle | 372 | one-off picture | archive: obvious; its playground slot goes to an example |
| pell-anim | 2,185 | click lights a lamp; every later effect eased from `frame - at` | mine → `lamps` (`sketch-tea.ts:268-273`: `smooth((model.frame - model.lamp.at) / 40)`) |
| pendulum-lab | 978 | RK4 lab with trials and a graph | archive: project-scale |
| periodic-trends | 1,140 | table and chart linked | archive: superseded by its rerun |
| periodic-trends-2 | 627 | linked views, colour ramp legend, arrow keys | archive: linked hover is obvious once "Names and hits" is read |
| scene-market-opus-a | 196 | one picture recoloured by `deps` | archive: model comparison; recolouring is the TEA.md:401-416 snippet |
| scene-market-opus-b | 230 | jointed arm; `toCanvas` hand | archive: model comparison; `toCanvas` is TEA.md:516-518 |
| scene-market-sol | 107 | stalls | archive: model comparison |
| scene-night-room-opus-a | 191 | panned room, flicker dip | archive: model comparison |
| scene-night-room-opus-b | 203 | same | archive: model comparison |
| scene-night-room-sol | 99 | lit, washed room; noise flicker on a light | mine → `night-room` (`sketch-tea.ts:76-86`: `energy: 1.4 * flicker`, emissive bulb) |
| scene-pendulum-opus-a | 170 | pendulum stepped in `update`, slider on the canvas, trail, measured label box | mine → `pendulum` (`sketch-tea.ts:30-48`) |
| scene-pendulum-opus-b | 203 | same | archive: model comparison |
| scene-pendulum-sol | 89 | same, closed form | archive: model comparison |

**Counts:** keep 9 (all in `src/examples/`), mine 8 (2 examples, 6 gallery
entries), fixture 3, archive 42 (3 examples, 39 gallery entries). 62 in all.

### Target set

Thirteen examples. Each is under about 150 lines, returns its drawing as lists
(no `out.push`), and names what a pointer hits. "Links from" names the doc
section that sends a reader to it.

| # | Example | Teaches | Links from | Source | Events file drives |
| --- | --- | --- | --- | --- | --- |
| 1 | `bounce` | A drag as a mode: grab with an offset so the ball does not jump, throw with the last move's velocity, a key reset | README "Worked example"; TEA.md "The `Msg` union" | rewrite + lens-rays | grab, drag, release, `r` (exists) |
| 2 | `orbit` | Every param kind; a `trigger` resets the model and leaves params; click a moving body by name | TEA.md "Worked example", "Params reference" | rewrite | click by `target`, key nudge, param edits, reset |
| 3 | `scale` | Names on nested drawings; `targets`; `row` and `column` | TEA.md "Names and hits", "Layout" | keep | exists |
| 4 | `answer-box` | A typed answer over the canvas (`text` param, `v.control`); `activity` | TEA.md "Inputs over the canvas", "Activity" | rewrite | typed answers, tile clicks by `target` |
| 5 | `sound` | Choosing sounds by meaning; a voice id per sound; `at` is the next frame | TEA.md "Sound" | light rewrite | bar clicks by `target` |
| 6 | `lamps` | Event-time animation: a click on a lamp records its frame in `start[id]`; everything after is a pure function of `frame - start[id]` (`v.tween`), so `update` keeps no animation state | TEA.md "Other `View` members" (`tween`); BRUSHES.md "Animation and pictures" | new, from pell-anim and busy-town-opus | clicks by `target`, snapshots mid-fade and after |
| 7 | `pendulum` | Physics stepped in `update`: each tick advances a fixed 1/60 s (the check's fps), split into substeps for a stable integration; a length slider placed on the canvas, whose change restarts the swing | TEA.md "Frame-N guarantee"; canvas-loop AGENTS.md "Use determinism to verify" | new, from scene-pendulum-opus-a | length changes; snapshots at period marks |
| 8 | `paint` | Strokes from the pointer kept as data, drawn through a chain of pictures (each picture places the previous one and adds one stroke), so a finished stroke costs one stroke, not the whole page. Pressure stays the `"taper"` preset; a stroke's `seed` is set as BRUSHES.md:438-440 says, without comment | BRUSHES.md "Gestures", "Animation and pictures"; TEA.md "Pictures" | new, from paint-simple | three drags; snapshot |
| 9 | `brushes` | Every preset under every pressure, interactively | BRUSHES.md "Brushes" | keep | param sweeps |
| 10 | `paint-mixing` | Smudge, wet paint, colour jitter, paper in one small landscape | BRUSHES.md "Colour variation", "Smudge and wet paint", "Paper" | keep | snapshot |
| 11 | `looks` | Wash and hatching on one scene: wash wants colour fields, hatching wants a tonal range | BRUSHES.md "Effects" | merge of washed-shapes and still-life | `look` param plain → wash → hatching |
| 12 | `effects` | Blur, glow, shadow, mask fade, tween, colour adjustment | BRUSHES.md "Effects", "Making something glow"; TEA.md "Scopes" (`mask`) | keep | snapshots across the firefly loop |
| 13 | `night-room` | A lit room: lights, materials, caster heights, tone curve, a flickering lamp | BRUSHES.md "Lighting", "Making something glow" | trim + flicker | param changes |

Why each earns its place, against the rule:

- **Input (1–4, 8):** the docs describe each message and call. They do not show
  a drag's states, the trigger-versus-param boundary, a typed answer checked
  as it is typed, or strokes built from pointer moves. Each is the smallest
  realistic figure for its kind of input.
- **Time (6, 7):** the docs give `tween` and the tick, but not the two ways a
  figure keeps time: derive from a recorded frame (6) or integrate in
  `update` (7). Box figures for teaching need both.
- **Sound (5):** the voice rules (new id, `at`, budget) are easy to get wrong;
  one running example shows them together.
- **Brushwork, effects, light (9–13):** the boxholder named brushwork as an
  area worth showing. These are the realistic small pictures; each section of
  BRUSHES.md links one, so a reader sees the look a parameter gives.

Mined and rejected (obvious, or not a canvas-loop lesson): an inked,
shaded character (gull-market `form()`, alien-reference; BRUSHES.md already
gives the recipe), held-key walker
(intra-walk-styles), planted-foot gait (intra-walk-study), depth-mask
occlusion and baked relighting (intra-lounge), position-pure pixel tiles
(game-world-tiles), linked views and ramp legend (periodic-trends-2),
`toCanvas` arm (scene-market-opus-b), seamless paint rows (open-opus-a),
analog clock (clock).

### A. Move the renderer fixtures

- **What:** move `intra-walk-styles`, `intra-rooms` and `balance-reaction-2`
  sketches and helpers (`*.ts` only) to `test/fixtures/scenes/<name>/`
  unchanged. Their `task.md`, `meta.yaml`, `runs.jsonl`, `history/`,
  `PLAN.md`, `ROOM-GUIDE.md` and `events.json` are not moved.
- **Why:** four GPU test files import them; the gallery cannot go until they
  have a home. The walker's frame 0 carries golden numbers
  (`brush-pass.gpu.test.ts:165-169`), so it moves byte-identical.
- **Direction:** `git mv` per file; update the imports at
  `renderer.gpu.test.ts:40-42`, `brush-pass.gpu.test.ts:39`,
  `mark-atlas.ink.gpu.test.ts:25`, `walker-frame.ts:13`; add
  `test/fixtures/scenes/**/*-tea.ts` to the TEA lint glob
  (`eslint.config.ts:30`) and `test/fixtures/scenes/**/*.ts` to the sketch
  budget (`eslint.config.ts:54`), with the comment's tree list updated.
- **Vocabulary lock-ins:** `test/fixtures/scenes/`.
- **First implementation chunk:** the moves and the four import edits in one
  commit; `pnpm --dir canvas-loop run typecheck` and `lint` pass;
  `pnpm --dir canvas-loop test` passes, GPU tests included, run alone on the
  machine (canvas-loop AGENTS.md "GPU").

### B. `examples:check`

- **What:** `src/headless/gallery.ts` becomes `src/headless/examples-check.ts`
  with `checkExamples({ examplesDir? })`. CLI `cli examples check`; pnpm
  script `examples:check`.
- **Why:** examples are the doc's evidence and nothing renders most of them;
  the gallery check renders only the gallery.
- **Direction:**
  - Discovery: every `src/examples/*-tea.ts`. Each needs
    `<name>-tea-events.json` beside it; a missing one fails that example.
  - Run length: `frames = maxFrame + 1` over the parsed events (the parser
    does not require sorted entries, `src/headless/tea-events.ts`). An empty
    file, or one whose `maxFrame` entry is not a `snapshot`, fails with
    `"end the events file with a snapshot at its last frame"`. Seed 42, fps 60, every 30: the CLI
    defaults.
  - Kept from `gallery.ts`: the one type check before any render, two runs
    and a byte diff, the eslint call.
  - New: after run A, any warning fails the example, with the line in the
    detail. Transcript log entries render as `**[frame N]** warn: …`
    (`src/headless/transcript.ts:71`); the check uses a pure
    `transcriptProblems(text)` that matches that form. An example teaches its
    look; a warning in it teaches a mistake.
  - New: any scripted input whose verdict is `(unhandled)` (TEA.md "Engagement
    verdicts", `**[frame N]** <event> → (unhandled)`, `transcript.ts:75`) fails
    the example. So each scripted click, drag or key must engage, and the
    events file tests the example's interaction, not only that it runs.
    `scale`'s deliberate miss at frame 75 moves out of its events file into
    `tea-runtime.hits.gpu.test.ts`, which appends it to the parsed events.
  - `meta.yaml`, `listExerciseSlugs`, `SKETCH_FILE_NAMES` go.
  - `tea-runtime.hits.gpu.test.ts` keeps its exact-transcript assertion and
    drops the line 7 sentence.
- **Vocabulary lock-ins:** `examples:check`, `checkExamples`,
  `ExampleCheckEntry`, `ExampleCheckResult`.
- **First implementation chunk:** the rewrite, the CLI and script rename, the
  export rename, and `sketch-types.test.ts:127-147` rewritten to flat
  temporary example directories (one case with a bad export, one with a type
  error in an imported helper, one with no events file, one with no closing
  snapshot). These cases stop before rendering. `transcriptProblems` gets a
  non-GPU unit test over sample transcript lines: a framed `warn:` line, an
  `(unhandled)` input line, and clean lines that mention neither. The current examples will fail the new check where they lack
  events files; that is expected until Track C, and this chunk does not run
  the full check.

### C. The example set

- **What:** the thirteen examples above, each with an events file; five
  retired; the registry, dev demo and react-ssr test moved off retired
  sketches.
- **Why:** the boxholder's rule; and the set must be runnable and current.
- **Direction:**
  - New: `lamps`, `pendulum`, `paint`. Merged: `looks`
    replaces `washed-shapes` and `still-life`. Rewritten: `bounce`, `orbit`,
    `answer-box`, `sound`, `night-room`. Kept: `scale`, `brushes`,
    `paint-mixing`, `effects` (lists instead of `out.push` in `brushes`).
    Retired: `alien-reference`, `brushes-sampler`, `fjord`, `still-life`,
    `washed-shapes`.
  - Each header comment opens with the teaching point in one sentence and
    names the doc section that links the example.
  - `registry.ts` lists all thirteen, in the target-set order. A new
    non-GPU test, `test/examples/registry.test.ts`, reads `src/examples/` and
    asserts the registry's ids equal the example names, so an example cannot
    be missing from the playground.
  - Dev demo: `fjord` → `brushes` (`main.tsx:18-101`: the persisted params
    become `brush`, `pressure`, `weight`, `wobble`, `paper`). Rebuild
    `dev/canvas-loop.html` with `build:dev-demo` (generated).
  - `react-ssr.test.tsx:12,17,41-60`: `fjord` → `brushes`, with its params.
  - `orbit` keeps its param names, so `react-ssr.test.tsx:64-77` and
    `headless.tea-determinism.gpu.test.ts` need no change beyond events now
    aimed by `target`.
- **Vocabulary lock-ins:** the thirteen names.
- **First implementation chunk:** retire the five, write `looks`, add events
  files to `brushes`, `paint-mixing`, `effects`, `night-room`, `looks`;
  switch the dev demo and the react-ssr test to `brushes`; registry and its
  test. `examples:check` passes over the nine that exist then. New and
  rewritten examples follow, one commit each, each with `examples:check`
  passing.

### D. Delete `src/gallery/`

- **What:** remove the 45 remaining directories and `src/gallery/README.md`.
- **Why:** model comparisons and intermediate records "don't make any sense"
  (boxholder). Git keeps them.
- **Direction:** after A and C, no code imports `src/gallery/` (`grep -rn
  "src/gallery\|/gallery/" canvas-loop/src canvas-loop/test` returns only the
  string literal in `test/scene/call-site.test.ts:29`, which is a fake path
  and stays). Drop `src/gallery/out/**` from `eslint.config.ts:15` and
  `tsconfig.json:21`, and the gallery globs from `eslint.config.ts:30,54`.
  The CHANGELOG entry names the last commit that holds the gallery, so
  `git show <sha>:canvas-loop/src/gallery/<entry>/sketch-tea.ts` finds one.
- **First implementation chunk:** the deletion and the config edits in one
  commit; typecheck, lint and the non-GPU tests pass.

### E. Docs link the examples

- **What and direction:**
  - **TEA.md:** line 9-10 command keeps `orbit`. Lines 53-54 drop
    `src/gallery/`. Lines 145-148 lose the gallery sentence (*"The gallery's
    sketches were converted to this form by a script …"*). Lines 681-682 link
    `sound` only. "Worked example" (817-848) is rewritten for the named
    `orbit`. Add one link per row of the target table to its section, as a
    single line: *"Example: [`pendulum`](./src/examples/pendulum-tea.ts) —
    physics stepped in `update`."*
  - **BRUSHES.md:** one such line in each section the target table names.
  - **README.md:** "Worked example" (142-169) follows the `bounce` rewrite;
    add an "Examples" section: what an example is, the run command, and the
    thirteen names with their teaching points.
  - **AGENTS.md:** replace "Gallery" (lines 35-40) with "Examples": add one
    only when it shows what the docs do not; one sketch and one events file;
    `pnpm --dir canvas-loop run examples:check` before commit. Line 10-11
    drops the gallery README link. Line 44 names `examples:check`.
  - **CHANGELOG.md:** one entry for the gallery removal, the check rename,
    the retired and new examples.
  - **LIBRARY-PLAN.md:** unchanged; it is a historical plan (its lines
    49-50, 133-153 describe the gallery as designed).
- **First implementation chunk:** lands with Track C's last commit, so every
  link points at a file that exists.

### F. Box docs ship the examples

- **What:** a third generated box doc, `canvas-loop-examples.md`.
- **Why:** box agents are the main readers, and today a link to an example
  reaches them as plain text (`canvas-loop-doc.ts:30`).
- **Direction:**
  - `generateCanvasLoopExamplesDoc()` in `canvas-loop-doc.ts`: a title, the
    `BOX_NOTE`, then for each example, in name order, a `## <name>`
    heading, the header comment as prose, the sketch in a `ts` fence and the
    events file in a `json` fence. Same packed-install fallback as `shipped()`.
    The generator lists `src/examples/*-tea.ts` sorted by name; it does not
    read the registry, so beebox does not import canvas-loop's browser code.
  - `boxLinks()` gains one rewrite before the catch-all:
    `](./src/examples/<name>-tea.ts)` → `](canvas-loop-examples.md#<name>)`.
  - `core.ts:69-70` gains `{ filename: "canvas-loop-examples.md", readWhen:
    "Looking for a whole canvas-loop figure to start from: drag, typed
    answer, sound, event-time animation, physics, painting, brushes,
    effects, lighting." }`.
  - `figure.ts:189-191` adds: *"Worked examples, one per technique, are in
    `canvas-loop-examples.md`."*
  - Test: the generated doc holds a `## <name>` section for every example
    file, and every `./src/examples/…` link in TEA.md, BRUSHES.md and
    README.md names an example that exists (TEA.md's and BRUSHES.md's links
    also resolve to anchors in the generated doc).
- **First implementation chunk:** the generator, the registration, the link
  rewrite, the test and the `figure.ts` line, after Track E.

## Could this be simpler?

- **Simplest:** delete the gallery, move the fixtures, fix links (*Smallest
  fix*). It fails the boxholder's request to *"mine for the examples worth
  showing"*, keeps examples the docs tell readers not to copy, leaves ten of
  fourteen current examples unrendered by any check, and leaves box agents with no
  example at all.
- **Without Track F:** box agents, the readers who write figures, still see
  example names with no file. F is about 70 lines.
- **Without the registry test:** the playground drifts from the set the first
  time an example is added; the test is about 25 lines and has no branches to
  get wrong.
- **Without the warning check:** an example could warn (a faint mark, an
  unreturned node) and teach the mistake. It is a few lines in the check.
- **Fewer examples:** `brushes` and `paint-mixing` both show brushwork, and
  `orbit` overlaps `scale` on hits. Each stays because it carries a point the
  others do not: comparing presets interactively; mixing paint; the
  trigger-versus-param boundary, which two tests and the dev demo also use.
  An inked, shaded character was cut in review: BRUSHES.md already gives its
  recipe.
- **Not done:** a manifest or `meta.yaml` per example (the events file sets
  the run length); a subset filter for the check (thirteen small examples
  run whole, gated in Rollout shape).

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A fixture move changes the walker's bytes (an import path that reaches a different file) | Yes: walker goldens in `brush-pass.gpu.test.ts`, `mark-atlas.ink.gpu.test.ts` | `git mv` of whole directories, no edits | Clear (golden mismatch) |
| An example has no events file, or an empty one | Planned: Track B case | Check fails the example with the reason | Clear |
| An example warns (faint mark, unreturned node, text overlap) | Planned: `transcriptProblems` unit test | Check fails on a framed `warn:` line | Clear |
| A scripted input is hit but ignored (`(unhandled)`) | Planned: `transcriptProblems` unit test | Check fails the example | Clear |
| A stray input after the last snapshot, or unsorted entries, shorten the run | Planned: Track B case | Run length from the parsed max frame; it must be a snapshot | Clear |
| An example is added but not to the playground | Planned: registry test | — | Clear |
| A doc links an example that was renamed or retired | Planned: Track F test over TEA.md, BRUSHES.md and README.md | — | Clear |
| A box agent copies an example's import of a sibling helper | No | Examples are single-file by rule (AGENTS.md "Examples") | Clear (box compile error names the import) |
| A rewritten `orbit` changes the determinism test's inputs (events by `target` instead of x, y) | Yes: `headless.tea-determinism.gpu.test.ts` | — | Clear |
| The box doc generator runs in a packed install with no sibling `canvas-loop/` | Existing fallback path (`canvas-loop-doc.ts:34`) | Reads the copy built into `box-docs/` | Clear (missing file throws at build) |
| An event aimed by `target` misses because the named drawing moved | Yes: the runtime stops the run (`tea-runtime.hits.gpu.test.ts:78`: *"lands on no named drawing; aim with x and y"*) | — | Clear |

No critical gap: every row is tested or fails loudly.

## Agent-flow / user-flow edge cases

- **Wrong example picked** (an agent copies `orbit` for a drag): ADDRESSED.
  Each doc section links the example for its point, and each header states
  its point in its first sentence (Track C).
- **Stale link** (an example renamed after a doc links it): ADDRESSED by the
  Track F link test over TEA.md, BRUSHES.md and README.md.
- **Two agents adding examples at once:** ADDRESSED. Flat files with distinct
  names; the registry test fails the second if it forgets the registry.
- **Hand-edit drift** (an example edited into `out.push` or position-math
  hits): GAP, accepted. Lint does not forbid `out.push`; review catches it.
  The AGENTS.md "Examples" rule states the form.
- **Fabricated value:** not applicable; examples hold no records.
- **Validation error UX:** ADDRESSED. Check failures name the example and the
  cause (missing events file, the warning line, the byte diff).
- **Transition state:** ADDRESSED. Track B lands before C, so for a few
  commits some examples fail `examples:check`; nothing runs it automatically,
  and Track C's first chunk restores a passing check before any doc link
  changes.
- **A box agent's figure fails where the example passes** (browser versus
  headless antialiasing): DEFERRED; BRUSHES.md:476-481 states it.

## NOT in scope

- **A subset filter for the check** (the issue's proposal): considered, not
  now, because the whole run over thirteen small examples should be short.
  If the measured run exceeds two minutes, the issue leaves this plan's
  `issues:` list and stays open (Rollout shape); the filter is then its own
  work.
- **Trimming the Hallway fixture** from 6,497 lines to a small panning
  sketch: no goldens depend on it, so it can shrink later; not now, because
  this plan moves fixtures without changing them.
- **Checking fenced code in TEA.md and BRUSHES.md**
  (`2026-11-16-doc-code-blocks-are-not-checked.md`): separate work.
- **A `v.pixels` example, held-key input, gait, occlusion, linked views:**
  mined and rejected above; each is obvious from the docs or specific to one
  project.
- **Keeping archived entries browsable:** git history only (Open design
  questions has the alternative).
- **LIBRARY-PLAN.md and the closed design issue:** historical records; left
  as written.
- **The showcase sketches in `scratch/showcases/`:** moved out already;
  untouched.

## Open design questions

1. **A committed gallery page.** The playground is built locally and
   gitignored. Lean: add `dev/canvas-loop-examples.html`, built by
   `build:playground` and committed like `dev/canvas-loop.html`, so the
   boxholder browses the set at `/<worktree>/dev/` with no build step. Cost:
   a large generated file in each commit that changes an example. Track C
   is complete without it.
2. **Archived entries browsable.** Lean: git history only, with the CHANGELOG
   naming the commit. Alternative: copy them to the ignored
   `scratch/showcases/` beside Thimble Quay.
3. **A `v.pixels` example.** The review argued that a position-pure field
   (colour from world coordinates, so separately filled rectangles join; see
   `game-world-tiles/field-tea.ts:208-229`) teaches something TEA.md:445-448
   does not. Lean: no; it serves tiled maps, which box figures rarely draw.
   It would replace no current target; it would be a fourteenth example.

## Knowledge audits

One new box-agent concept: worked examples live in `canvas-loop-examples.md`.
Add to `beebox/src/dev/knowledge-audits.yaml`, under "Figure Cards
(canvas-loop runtime)":

```yaml
- id: figure-canvas-loop-examples
  prompt: "You are writing a canvas-loop figure where the learner drags a weight and hears a sound when it lands. Where do you look for a whole working figure to start from?"
  watch_for: "Names canvas-loop-examples.md (bounce for the drag, sound for the voice)"
  correct_contains: ["canvas-loop-examples.md"]
  tags: [cards, figure]
```

Run it after Track F: `pnpm knowledge-audit run --box ~/src/boxes/test1
--filter figure-canvas-loop-examples`, and record the status comment.

## What will hold this after it ships

- `examples:check`: every example type-checks, runs warning-free, renders
  identically twice, and lints. It is the examples' test tier, the same one
  the gallery had, now over the set readers copy.
- `test/examples/registry.test.ts` (non-GPU): the playground lists every
  example.
- The Track F test: every example has a box-doc section and every doc link to
  an example resolves.
- The existing GPU tests hold the fixtures (walker goldens, cache
  equivalence) and `scale`'s and `orbit`'s exact behaviour.

No new test tier and no mocks.

## Implementation order

1. **A.** Fixture moves and imports. GPU tests pass.
2. **B.** `examples:check`, its tests, the renames.
3. **C1.** Retire five; `looks`; events files for the kept examples; dev demo
   and react-ssr on `brushes`; registry and its test; rebuild
   `dev/canvas-loop.html`. `examples:check` passes over the examples present;
   an old example whose scripted input reads `(unhandled)` gets its events
   file fixed here, before its rewrite.
4. **C2–C9.** One commit per new or rewritten example (`bounce`, `orbit`,
   `answer-box`, `sound`, `night-room`, `lamps`, `pendulum`, `paint`), each
   added to the registry, each passing `examples:check`.
5. **D.** Delete `src/gallery/` and its config entries.
6. **E.** Doc links, README "Examples", AGENTS.md "Examples", CHANGELOG.
7. **F.** Box doc, link rewrite, `figure.ts` line, test, knowledge audit run.

Commit boundaries, not ship boundaries: the plan ships whole, when the
boxholder says so.

## Rollout shape

Tests first: the Track B cases (missing events file, warning, type error,
bad export) and the registry test are written before the examples they check.
Done when:

- `pnpm --dir canvas-loop run examples:check` passes over the thirteen. Its
  time is recorded in the CHANGELOG entry (the issue's 10–11 minutes is the
  baseline). Over two minutes: take the subset issue off `issues:` and leave
  it open.
- `pnpm --dir canvas-loop test` passes, GPU tests included, run alone.
- `pnpm --dir canvas-loop run typecheck` and `lint` pass.
- The beebox docs-gen test passes and the knowledge audit is run and
  recorded.
- Each new or rewritten example has had one render read by eye
  (canvas-loop AGENTS.md "Audit norms").

No data migration: no box holds a gallery entry or example. Box agents get the
new doc on the next docs build.

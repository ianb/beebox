---
title: "canvas-loop: draw returns its scene"
status: implemented
workstream: canvas-brushes
issues: []
---
# canvas-loop: draw returns its scene

A subplan of `beebox/docs/implemented-plans/canvas-loop-scene.md`. Today a sketch's
`draw(v, model, params)` calls `v.rect(…)`, `v.group(opts, () => {…})` and so
on, and a recorder turns the calls into a tree of plain nodes. This plan
changes `draw` to build the tree as values and return it: `v.rect(…)` returns a
node, `v.group(opts, [children])` returns a node, and `draw` returns a node or
a list. The builder form goes away; no compatibility layer is kept.

Source citations are to commit `7e7c3b499`. The core subplan's chunk 6
merges `scene/api.ts` into `core/paint.ts` and `core/tea.ts`; read those
citations in their merged home.

**Issues addressed:** none filed. Searched `issues/` and `private-issues/`
for canvas-loop items that mention returned values, the builder or
type-checking: nothing open.

## Design

No design section: this changes a developer library's authoring API. A person
meets canvas-loop only through beebox's figure card, which subplan (c)
(`canvas-loop-box-figures.subplan.md`) owns; old courseware figures get a
clear error on the card (Failure modes), and (c) regenerates them.

## Smallest fix and budget

**The decision.** The draft chose the builder: `scene-api-draft.md:11-24`,
*"A sketch looks almost the same as today … A returned-value API (`h("rect",
…)`, as Elm and React do) rhymes with UI frameworks, not with drawing APIs"*.
The boxholder, after seeing how the recorder works (2026-11-15): *"a return
style just seems better. Sometimes it means more intermediate objects and
stuff, but it seems like we're already effectively doing it here"*, then
*"seems like return values will be the right way to go"*. This plan does not
reopen the choice.

**Smallest change.** Make each `v.*` drawing call return the node it now
pushes, take children as values in the scope calls, and have the recorder
read `draw`'s return value. Run a codemod over every sketch so the gallery
renders the same bytes. This plan is close to that smallest change. It adds
three things the smallest change lacks, each for a named failure:
- a post-draw walk that holds the checks that read the current transform,
  paper or lit scope, because a constructor no longer knows its parents
  (Track 1);
- an error for a `draw` that returns nothing and a warning for nodes made
  and not returned, because a forgotten `return` otherwise draws nothing,
  silently (Track 2);
- a type-check of the sketch and its exported contract before `cli run` and
  in `gallery:check`, because the boxholder wants types to carry shape
  validation and today nothing in the agent's loop type-checks a sketch
  (Track 4).

**Estimate** (additions plus deletions; revised after review round 1):

| Chunk | What | Source | Tests | Codemod output | Hand-written sketches |
|---|---|---|---|---|---|
| R1 | Resolve walk for the transform, lit and mask checks; builder unchanged | ~550 | ~350 | — | — |
| R2 | Constructors return nodes; paper becomes a scope; `draw` returns; codemod over gallery, examples, tests and internal drawers | ~650 | ~400 new | ~23,000 (gallery and examples ~21,200; tests ~1,800) | ~900 (hand fixes the codemod flags) |
| R3 | The four examples the docs cite, rewritten by hand; consumers; beebox starter and harness | ~70 | — | — | ~1,700 (orbit, fjord, bounce, sound: 968 lines today) |
| R4 | Two enum checks removed; type-check of the sketch and its exports | ~200 | ~150 | — | — |
| R5 | Speed measurement, review fixes | ~50 | ~50 | — | — |

- **Authored source and tests:** about 2,500 lines.
- **Hand-written sketch changes:** about 2,600 lines.
- **Codemod output:** about 23,000 changed lines, mechanical, checked by
  byte-identical renders and codemod fixtures. The codemod itself (about 450
  lines with its fixtures) is a one-off in `scratch/stage5/rs/codemod/` and
  is not committed.
- **Authored docs:** about 150 lines (a draft 2.11 section in
  `scene-api-draft.md`, the coverage-matrix row, notes in the core subplan's
  Track 7). The rewrite of `TEA.md` and `BRUSHES.md` stays in the core
  subplan's chunk 7, which runs after this plan, so it is written once, in
  the returned form.

**BIG CHANGE.** About 28,000 changed lines in all, about 5,100 of them
authored. What drives the size: the sketch corpus. `src/gallery/` and
`src/examples/` hold about 45,000 lines of sketch code outside `history/`
(`find src/gallery src/examples -name '*.ts' | grep -v history | xargs wc
-l`), with about 8,000 drawing statements to convert (from a grep:
`v.rect` 2,481 calls, `v.circle` 2,362, `v.curve` 2,027, `v.text` 1,022,
`v.line` 494, `v.path` 480, `v.clip` 444). The runtime change is small; the
corpus is large. Implementation needs the boxholder's approval at this size.

**Approved (2026-11-15).** The boxholder approved this size and the plan:
"that sounds fine, go ahead". The paper-scope change (R9 and decision 10)
is taken with it: the returned form has no current paper while it builds
nodes. Implementation starts after core chunk 6 and gpu-brushes chunk 9.

## Stated preferences this plan trades against

- **The boxholder's direction** (quoted above) and *"Don't worry about
  backward compatibility"*: one form, no adapter for builder sketches.
- **Validation by types first.** The boxholder: *"I think we can rely on
  types to handle a lot of the invalid-value stuff, and some runtime checks
  where that's not sufficient (e.g., maybe ints only somewhere, or stuff like
  that)."* TypeScript's structural typing does not refuse an extra key on an
  object held in a variable (`const s = { stroke: "red", wieght: 8 }` passes
  as a `Style`), so unknown-key checks are a case types cannot cover; they
  stay. Track 4 removes only checks a type fully states.
- **Principle 5, familiar APIs** (`canvas-loop-scene.md:43-45`). The
  constructors keep today's names and argument lists on `v`, so a sketch
  still reads like Canvas2D or p5 call by call; only composition changes
  (lists instead of statements). The draft's worry was `h("rect", …)`; this
  plan keeps `v.rect(x, y, w, h, style)`.
- **Principle 1, agent DX.** Every check of today survives (Track 1), with
  two stated exceptions: a draw that throws loses that frame's walk warnings,
  and browser warnings lose their call site. Warnings keep naming the
  sketch's line in testing mode.
- **Principle 4, speed.** Chunk 4b cut the record step from 11.5 to 2.0 ms
  per walker frame in Chromium (`canvas-loop-scene-core.subplan.md:776`
  *"11.5 / 8.9 / 4.6 / 2.1 / 1.0 | 2.0 / 8.3 / 4.5 / 2.0 / 1.2"*). The
  returned form adds one walk; acceptance is in Track 5.
- **Engineering principles** (`beebox/docs/engineering-principles.md`): §8,
  one way to do each thing (one constructor per node kind; frame outputs
  that are not drawing stay one call each); §4, never silent.
- **"Unused API is not dead API"** (`canvas-loop-scene.md:94-96`):
  `textBounds`, `keepInside` and `toCanvas` stay, in forms the returned style
  can answer (Track 2).
- **Precedent for migrating the gallery:** retired forms were *"rewritten
  mechanically"* with a `migrated` line in `meta.yaml`
  (`canvas-loop/src/gallery/README.md:32-35`); `runs.jsonl` has `ported`.

## What already exists

- **Nodes as plain data.** `canvas-loop/src/scene/nodes.ts:194`
  *`export type SceneNode = ShapeNode | BackgroundNode | AtNode | GroupNode |
  ClipNode | MaskNode | TextNode | PlaceNode | DebugNode | LightNode;`*. The
  recorder already builds one object per call and pushes it
  (`recorder/view.ts:120-126` `#add`). Reused as is: the renderer, lowering,
  hashing, outlines and diffs keep reading `Scene`.
- **The recorder's per-call context** (`recorder/view.ts:49-60`): matrix,
  paper, picture, lit depth, mask flag. Each read is a check or a resolution
  a returned-value constructor cannot make:
  - `resolveStyle(args.style, { call, paper: this.#paper })` (`view.ts:143`)
    puts the paper into each brushed stroke and, for every shape with
    effects, into `effectsPaper` (`style.ts:143`). Paper is set by a
    statement that emits no node (`view.ts:276-279`); it leaks out of `at`
    and `clip` bodies (`view.ts:234`, `:261`, `#inside(body, true)`), and a
    group takes the paper at the end of its body (`view.ts:248-253`). A
    walk over the recorded tree cannot recover these rules, so paper stays
    at the call until R2 changes the rule (Track 2).
  - `axisScales(this.#matrix, call)` (`view.ts:144`, `:242`);
  - the off-canvas audit (`view.ts:149`, `:210`, `:311`), whose API takes the
    matrix as an argument (`off-canvas.ts:149`);
  - text layout under the matrix for `keepInside` (`recorder/text.ts:43-44`;
    `core/text/measure.ts:71-74`), and the text checks (`view.ts:211`);
  - light warnings by lit depth and mask (`view.ts:151-154`, `:334-339`).
    They are not gated by testing mode, and the browser shows them
    (`browser/scene/surface.ts:139` *``for (const w of rec.warnings)
    this.#log([`warning: ${w}`]);``*);
  - `holdsNonReceiving(children)` and `hasOpenLight(children)`
    (`view.ts:252-253`), which already take a children list;
  - the placement-scale hint (`view.ts:312`);
  - `toCanvas` (`view.ts:221-224`).
- **Call sites.** `callSite()` keeps a stack and formats it only when read
  (`scene/call-site.ts:66-81`). Testing mode keeps one per brushed mark
  (`recorder/audit.ts:41`) and per text call (`text-checks.ts:154-156`);
  `RecorderNotes.warn` reads the stack at the moment it warns
  (`notes.ts:76`), in both runtimes.
- **Picture versions.** `PictureTable` across frames
  (`recorder/pictures.ts:90-144`), the frame check on handles
  (`pictures.ts:168-171`), the testing-mode re-record and compare
  (`recorder/picture-calls.ts:45-59`). Reused; the paper source changes.
- **Hash memo by identity** (`scene/hash.ts:6-7` *"Keys are memoised by
  object identity, so a picture's nodes, kept across frames, are hashed
  once"*; `:282-284`). Per-frame nodes are fresh objects today; kept picture
  nodes are the ones that hit.
- **Node paths for render errors** (`gpu/node-path.ts`, core chunk 3 as
  built). Reused for walk errors.
- **Removed-call errors** (`recorder/removed.ts`, `RemovedCallError` with
  `call` and `replacement`, which subplan (c) matches by class). Reused.
- **Where `draw` is called.** Headless `headless/scene/surface.ts:121-125`;
  browser `browser/scene/surface.ts:132-136`. Two internal drawers use the
  builder: the headless `--outline` overlay
  (`headless/scene/surface.ts:161-169`) and the control stand-ins
  (`recorder/controls.ts:65-80`, `drawStandIns`, whose `label` both draws
  and returns a number).
- **Type-checking today.** `pnpm --dir canvas-loop typecheck` covers
  `src/**/*` (`canvas-loop/tsconfig.json` `"include"`), but checks only what
  each file declares: the loader casts a sketch's exports to the runtime
  contract after checking only that `draw` is a function
  (`headless/tea-load.ts:164`), and naming `TeaModule` is optional
  (`core/tea.ts:290-301`). `cli run` and `gallery:check` load sketches
  through `tsx`, which strips types (`canvas-loop/package.json:35`;
  `headless/cli/main.ts:161`). beebox's `bbx figure run` (`figure/run.ts:128`
  `bundleView(entry, …)`) and the figure card route
  (`beebox/src/webapp/routes/figure.ts:153`) compile with esbuild, which
  strips types. beebox has a checker, `lib/typescript/check.ts`, used by
  `bbx view typecheck` (`view/typecheck.ts:42`), whose wrapper reports only
  its boundary assertion's errors (`view/typecheck.ts:95-97`).

## Prior art (external)

- **React children rules** (adapted). React skips `null`, `undefined`,
  `true` and `false` in children, flattens nested arrays, and renders a
  number, which makes `count && <X/>` print `0`
  (https://react.dev/learn/conditional-rendering, the pitfall "Don't put
  numbers on the left side of &&"). This plan takes the skip and flatten
  rules and refuses numbers. Chunk R2 adds an `ACKNOWLEDGEMENTS.md` entry.
- **Elm `Svg` / `Html` values** (evaluated only): view functions return
  values built by constructors with attribute and child lists. No code or
  rule is taken.
- No other external premise bears on a decision here.

## Ontology

- **Node:** one value a constructor returns: a `SceneNode`
  (`scene/nodes.ts:194`) before the walk resolves it. Sketches see it as the
  opaque type `DrawingNode` (a brand, as `Picture` has `pictureBrand`,
  `scene/api.ts:150-154`). Not a DOM `Node`, hence the name.
- **Drawing:** what a component and a scope's children may be:
  `DrawingNode | readonly Drawing[] | null | undefined | false`. New type.
- **Root drawing:** what `draw` returns: `DrawingNode | readonly Drawing[] |
  null | false`. It excludes `undefined`, so a `draw` with a return type and
  no `return` is a type error, and at run time `undefined` is the
  builder-form signal (Track 2).
- **Constructor:** a `v` member that returns a `DrawingNode`: the shape
  calls, `text`, `background`, `at`, `group`, `clip`, `mask`, `paper`,
  `place`, `light`, `debugBox`. Existing names; new return types.
- **Frame output:** `log`, `snapshot`, `cursor`, `control` (draft section
  8). Stay `v` calls returning `void`.
- **Resolve walk:** the pass after `draw` returns, from the root drawing to
  a `Scene` (`scene/nodes.ts:197-201`). New: `scene/recorder/resolve.ts`.
- **Frame stamp:** the frame a node was made in, under a symbol key on the
  node (invisible to `Object.keys`, so `sameData` and the hashes ignore
  it). New.
- **Paper scope:** `v.paper(settings, children)`, a node with no layer that
  sets the paper for everything inside it. Replaces the statement
  `v.paper(settings)`.
- **Picture, version, placement:** unchanged (draft section 5);
  `PictureOptions.paper` is new.

## Tracks / scope

Ordered by dependency: the walk first (it carries the checks whose inputs
survive recording, and lands under the builder), then the flip with the
corpus, then the hand-written sketches, then validation, then speed.

### Track 1: the resolve walk (chunk R1)

- **What:** one pass over the recorded tree that holds the checks needing a
  node's ancestors' transform, lit depth or mask. In R1 the builder still
  records, paper is still captured at the call, and `record` runs the walk
  over what was recorded, so the move is checked byte-identical before the
  API changes.
- **Why:** after R2, a constructor runs before its parents exist.
- **Direction:**
  - `resolve(nodes, ctx)`, called on the root after `draw` and on each new
    picture body when it is recorded. `ctx` holds `matrix`, `size` (the
    canvas, or the picture's box), `picture` (key, for messages), `lit`
    depth, `inMask` and the node path.
  - Moved into the walk, with the same functions: `axisScales` for shapes
    and groups with effects; the off-canvas audit including group `enter`
    and `leave`; the text checks and off-canvas text bounds; `keepInside`
    layout; `holdsNonReceiving` and the "lit group with no light" warning;
    light warnings; placement checks and the placement-scale hint.
  - **Text.** The text constructor keeps the inputs `keepInside` needs (the
    box and options, copied) under a symbol key, and the bounds it measured
    under the identity. For a `keepInside` node, the walk lays the text out
    again from those inputs under its matrix and `ctx.size` and makes a new
    `TextNode`; other text nodes are used as they are.
  - **Call sites.** In testing mode each node made by a constructor keeps
    `callSite()` in the frame's `WeakMap`. Walk warnings use
    `RecorderNotes.warnAt` (`notes.ts:59-62`) with that site, so their text
    keeps ` (at path:line:col)`. `off-canvas.ts:196` and
    `text-checks.ts:154-156` take the site from the map. In the browser no
    site is kept, so the light warnings it shows lose their ` (at …)`; they
    keep the node path.
  - **Draws that throw.** The walk runs only after `draw` returns. A frame
    whose `draw` throws gives its error line and none of the walk's
    warnings; today a light warning made before the throw is given
    (`view.ts:337`). Accepted: the error is what the agent fixes first, and
    the warning returns on the next run.
- **Vocabulary lock-ins:** none sketch-facing.
- **First implementation chunk:** `resolve.ts` and the moves above. Done
  when every test passes with the same warning texts (order within a frame
  may change: walk order against call order), `gallery:check` passes, and
  the three ports and the cache cases render the same bytes
  (`scratch/stage5/a4b/compare.sh`). The walker's record step plus walk is
  measured once in Chromium.
- **As built (R1).** Commits c614c6756 (the walk) and a2d7a9792 (the review fix).
  Scripts and logs are in `scratch/stage5/rs1/`.
  - **Baselines (item 0).** The Stage 4 speed pages, copied to
    `scratch/stage5/rs1/` and pointed at `mountSketch` and at the ports'
    gallery homes, measured at d1d08b5ee under the GPU lock. The machine
    was busy (Spotlight indexing, other sessions' builds), so fps moved
    widely between equal runs; the record step was steady. Medians:

    | | Walker fps | Walker record (rAF) | Record alone | Six figures fps | Pointer p95 ms |
    |---|---|---|---|---|---|
    | Before, run 1 | 55.1 | 2.2 | 1.9 | 20.3 | 75 |
    | Before, run 2 | 24.5 | 2.7 | 1.8 | 18.9 | 204 |
    | After R1 | 42.1 | 2.6 | 2.0 | 19.3 | 125 |

    So the walk adds about 0.1–0.2 ms to the walker's record step in
    Chromium. R5 measures again on a quiet machine.
  - **`out/rs-before/`.** Every gallery exercise (48) at its `meta.yaml`
    frames and every example (13) at the CLI's defaults with its events
    file, rendered at d1d08b5ee (`render-all.ts`). R1's tree renders all 61
    with the same PNG bytes and the same transcripts, warnings included
    (`out/rs-r1/`).
  - **What moved.** As planned, with two differences. `holdsNonReceiving`
    stays at the group call: it reads only the children, which R2's group
    constructor holds too. Text facts (the bounds, and for `keepInside` a
    copy of the box and options) live in a `WeakMap` on the recorder rather
    than under a symbol key, so nodes keep their shape and `deepEqual`
    ignores them. `v.text` lays text out under the identity; for a
    `keepInside` label it still returns where the walk will put it, since
    the builder knows the transform.
  - **Call sites.** Testing mode keeps a stack for each shape, text, place,
    light and group node. An effects-scale error found by the walk names
    the node path (`… in picture "b" [0.4] > at #1 > rect #1`) and, in
    testing mode, carries the stack of the call that made the node, so the
    transcript lists the sketch's lines as before. Light warnings outside
    testing mode have no ` (at …)`; in the browser's bundled stacks they had
    none already. `nodeName` moved from `gpu/node-path.ts` to
    `scene/outline.ts`, since layout-check refuses a recorder import of a
    gpu helper.
  - **Checkpoint.** canvas-loop typecheck, lint and tests pass (209, and
    198 with 3 todo on the GPU); `gallery:check` passes all 48; the three
    ports and the cache cases render the same bytes (raw RGBA over many
    frames at ratio 1 and 2, and the CLI's PNGs and transcripts);
    beebox typecheck and layout-check pass.
  - **Drift from the plan's citations.** The ports moved from
    `src/examples/scene-ports/` to `gallery/intra-walk-styles`,
    `gallery/intra-rooms` (room `hallway`) and `gallery/balance-reaction-2`,
    so `scratch/stage5/a4b/compare.sh` and `hashes.ts` no longer run;
    copies in `scratch/stage5/rs1/` point at the gallery. The browser
    surface's draw is at `browser/scene/surface.ts:140-147`, not
    `:132-139`. The recorder citations in `view.ts`, `off-canvas.ts`,
    `text-checks.ts` and `notes.ts` held at d1d08b5ee.
  - **Review.** Codex (`gpt-6-sol`) traced the placement, mask, text,
    re-record and stand-in paths and found no changed gate or transform.
    It found an error in a picture body named no picture; fixed, with a
    test that fails without it. It asked for `nonReceiving` to move into
    the walk; not taken, for the reason above.
  - **For R2.** Walk errors carry the node's stack only in testing mode.
    `TextFacts.keep` is where R2's text constructor puts its copied inputs.
    The walk returns the same array when nothing changed; R2's paper scope
    will be its first frequent replacement.

### Track 2: constructors return, `draw` returns (chunk R2)

- **What:** the API flip, paper as a scope, and the codemod over every
  sketch, test and internal drawer, in one commit series verified by
  identical bytes.
- **Why:** the boxholder's direction. The flip and the corpus change
  together: after the flip, a statement-form sketch draws nothing.
- **Direction:**
  - **Constructors stay on `v`.** Module imports were considered and
    refused. Text constructors and measurement need the runtime's fonts
    (`recorder/text.ts:44`), pictures need the sketch's `PictureTable`,
    `noise` needs the run's seed, and `v.width` changes inside a picture
    body; module functions would reach these through hidden module state.
    Keeping `v` keeps every call's text, so docs, the codemod and agents'
    habits change least, and the determinism guards wrap `draw` as today.
  - **Signatures.** `draw(v: View, model, p): RootDrawing`
    (`core/tea.ts:301` returns `void` today). Shapes, `text`, `background`,
    `light`, `debugBox`: same arguments, return `DrawingNode`.
    `at(options, children: Drawing)`, `group(options, children: Drawing)`,
    `clip(shape, children: Drawing)`, `mask(maskArt: Drawing, children:
    Drawing)`, `paper(settings, children: Drawing)`,
    `place(picture, x, y, options?)`: return `DrawingNode`.
    `picture(options, body: () => Drawing)` and `pixels(options, fill)`:
    return `Picture`, as today. A single node is a `Drawing`, so
    `v.at(opts, v.rect(…))` needs no brackets.
  - **Children are copied at construction.** A scope constructor flattens
    its `children` into a new array it owns: nested arrays are walked,
    `null`, `undefined` and `false` skipped. Any other value (a number, a
    string, `true`, a plain object, a node from an earlier frame) throws a
    `SketchUsageError` at the call, so the stack names the sketch's line; a
    function throws `RemovedCallError` (`call: "group(options, body
    function)"`, or `at`, `clip`, `mask`; `replacement: "a list of
    children"`). A sketch that changes its array afterwards does not change
    the node. This array replaces the recorder's `#inside` array
    (`view.ts:128-139`), so the count of arrays per container is the same as
    today.
  - **Loops and conditions.** Loops read as `items.map((it) => …)`;
    conditions as `cond && v.rect(…)` or `cond ? a : b`; components are
    functions of `v` and props returning `Drawing`. A loop with accumulating
    state pushes into a local `const out: Drawing[] = []` and returns it.
    `0 && x` is a type error (`number` is not a `Drawing`) and a construction
    error when types were not checked.
  - **Paper is a scope.** `v.paper(settings, children)` sets the paper for
    every brushed stroke and every effect inside it (`brush.paper` and
    `effectsPaper` resolved separately, so a plain shape with
    `effects: { paper }` gets it too). The walk carries it in `ctx`. It no
    longer leaks out of `at` or `clip`, and a group's `effects.wash` and
    `effects.paper` use the scope's paper at the group. This changes R9 and
    accepted decision 10 (`scene-api-draft.md:176-181`, `:389-391`); see
    Open design questions.
  - **Pictures.** The body is still a function, run when the version is new
    (and every frame in testing mode, for the stale-capture audit), as now.
    Its returned drawing is resolved at once under the picture's own `ctx`
    (its size, the identity, its paper). `PictureOptions` gains `paper?:
    PaperSettings`, part of the version; default the default paper. Reason:
    R9 has a picture use the paper *"where `v.picture` is called"*
    (`scene-api-draft.md:178-180`), and a constructor call has no scope.
    Five sketches call both `v.paper` and `v.picture` (`library-anim`,
    `pell-anim`, `nell-anim`, `busy-town-sol`, `scene-market-sol`); their
    pictures get the option by hand. A version holding brushed strokes,
    placed inside a paper scope whose paper differs from its own, gives a
    testing-mode hint once.
  - **Nodes belong to one frame.** Each constructor stamps the node with
    the frame. A node may appear more than once within its frame. The
    scope constructors and the walk refuse a node from an earlier frame:
    *"this drawing was made in an earlier frame; make it again in draw, or
    record it once as a picture"*. Reason: a kept `place` node would skip
    the stale-handle check (`pictures.ts:168-171`) and the stale-capture
    audit, and a kept text node would keep a layout from before a web font
    loaded (`browser/scene/surface.ts:124-129`). Pictures are the one way to
    keep drawing across frames.
  - **`toCanvas`.** There is no current transform while constructing. It
    becomes a pure helper over an explicit chain:
    `v.toCanvas(point, [outer, …, inner])`, each an `AtOptions`. Its one
    sketch use (`scene-market-opus-b/sketch-tea.ts:77`, the hand inside two
    `at` scopes) passes the two scopes it is inside. The picture-body error
    for `toCanvas` (`view.ts:222`) goes.
  - **Text.** `v.text(…)` returns a node; `v.textBounds` and `v.textWidth`
    measure through a path that makes no node. No sketch reads `v.text`'s
    return value (searched `= v.text(`, `return v.text(` and `v.text(…).`
    in gallery, examples and tests: none). `textBounds` with `keepInside`
    keeps today's measurement under the identity transform, kept inside the
    canvas, or the picture's box inside a body (`core/text/measure.ts:71-74`
    takes the transform and size as arguments). Under an `at`, the drawn
    text may move differently from what `textBounds` returned, since the
    drawn move needs the parents. No sketch uses `keepInside` (grep: 0
    outside `history/`).
  - **Frame outputs.** `log`, `snapshot`, `cursor`, `control` stay `void`
    calls on `v`, made during `draw` before it returns. A node form would sit
    inside `at` scopes and suggest a transform `control` does not take
    (`view.ts:344` *"in canvas coordinates whatever scope it is called
    in"*). `void` is not a `Drawing`, so `[v.log("x")]` is a type error. The
    coverage matrix's open note (`coverage-matrix.md:115` *"A `draw` that
    returns a scene has no place to call `log`. Keep `u.log`; decide if
    `v.log` stays."*) is answered: `v.log` stays. `debugBox` stays a node
    (`nodes.ts:185-192`).
  - **A `draw` that returns `undefined`** throws `RemovedCallError` (`call:
    "drawing calls as statements"`, `replacement: "return the drawing from
    draw"`), in both runtimes, whatever it constructed. An empty frame
    returns `null`, `false` or `[]`. This is stricter than `Drawing` allows
    inside lists, on purpose: `undefined` from `draw` is the one signal that
    tells a builder-form sketch from a returned-form one, whatever its cache
    state. An old box figure therefore fails with this, or
    with the function-child error above, instead of a blank card.
  - **Made but not drawn** (testing mode). Each public constructor call
    registers its node for the frame. Every resolve in the frame (the root
    and each picture body recorded) marks the original nodes it reaches,
    before any replacement. After the frame resolves without an error, nodes
    never reached give one warning per line, at most 8 a frame:
    *"v.circle made a drawing that was not returned; put it in the list
    draw returns (at …)"*. On a throw the frame's registrations are dropped
    and the original error stands. Nodes made during the testing-mode
    re-record of a kept picture are not registered. `textBounds` and
    `textWidth` make no registered node. Cases: a frame-made node returned
    by a picture body, and a node made inside a picture body and returned
    by the frame, give no warning.
  - **The codemod** (`scratch/stage5/rs/codemod/`, TypeScript compiler API,
    run with the new types in place):
    1. In each function whose body has an expression statement of type
       `DrawingNode` or `Drawing`, add `const out: Drawing[] = [];`, turn
       each such statement into `out.push(…)`, turn bare `return;` into
       `return out;`, end with `return out;`, and set the return type to
       `Drawing` (`RootDrawing` for the exported `draw`). Repeat until no
       file changes.
    2. A scope call's function body becomes its children: an expression body
       is used directly; a block body becomes `((): Drawing => { … })()` with
       step 1 applied inside. A picture body stays a function.
    3. It changes nothing, and lists for hand-fixing: `v.paper(…)`
       statements (13 files); `toCanvas` (1); functions that draw and also
       return another value (`arm` in `scene-market-opus-b`, `label` in
       `recorder/controls.ts`); a function now returning `Drawing` passed
       where a `void` function type is expected (`Tint` in
       `pell-anim/sketch-tea.ts:1237`, called as `extra(pts)` in
       `litShape`), whose result a statement would drop without a type
       error; every scope call whose options argument is not an object
       literal of constants, where the children contain an assignment, an
       update expression or a call to anything but a `v` member or a
       drawing helper. Reason: the options expression was already evaluated
       first, but the recorder read and checked its contents (the matrix,
       `view.ts:229-230`) before running the body; the constructor now
       reads them after the children are built, so a change made while
       building the children (directly, through an alias or in a helper)
       moves into the drawing. An invalid parent's error now comes after its
       children's side effects (`v.log` lines, picture recording); accepted,
       since only the order of messages before the same error changes.
       Every type error left after the passes is also listed.
    4. Fixtures, one per case above, with expected output, run before the
       corpus, including an options object changed by a property write,
       through an alias, and inside a helper.
    The hand fixes are idiomatic; the rest of the gallery keeps the
    codemod's `out.push` form, as a corpus of what agents delivered,
    rewritten mechanically.
  - **Verification.** Before R2, render every gallery exercise and example
    at its `meta.yaml` frames into `out/rs-before/`; after, into
    `out/rs-after/`. Every PNG byte-identical, except frames in the 13 paper
    files where the paper rule change shows; each such difference is listed
    with its cause in the commit message and judged by eye. Transcript
    differences allowed: line numbers in ` (at …)` and warning order within
    a frame. Each exercise gets a `ported` line in `runs.jsonl` and a
    `migrated` line in `meta.yaml`. Captured frames do not exercise every
    branch, so the codemod fixtures and the hand-fix list carry the cases
    PNGs cannot.
- **Vocabulary lock-ins:** `Drawing`, `RootDrawing`, `DrawingNode`; the
  scope signatures; `PictureOptions.paper`; `v.paper(settings, children)`;
  `v.toCanvas(point, scopes)`; the error and warning texts.
- **First implementation chunk:** codemod and fixtures; then types,
  constructors, children copying, frame stamps, paper scope, the two checks,
  the two internal drawers; then the codemod over `src/gallery`,
  `src/examples`, `test/`; then hand fixes; then the byte comparison. No
  commit leaves `gallery:check` failing.
- **As built (R2).** Commits 456feaa08 (a per-test timeout for `pnpm
  test`), 03b97a4c5 (the runtime), 8775ff685 (the tests), 047b4088f,
  a551a667e and a63a37996 (the gallery in three batches), eef2890dd (the
  examples), and the records commit after them. The codemod, its 10
  fixtures and the hand-fix scripts are in `scratch/stage5/rs2/`, not
  committed.
  - **Order.** The runtime commit breaks the tests and the gallery until the
    commits after it land; `gallery:check` passes at the end of the series.
    A commit holding everything at once was too large to review.
  - **Bytes.** All 48 exercises and 13 examples render the same PNG bytes as
    `out/rs-before/`, the 13 files with paper statements included, so no
    frame needed a visual judgement. Transcripts match except one
    off-canvas warning in `scene-night-room-opus-b` that lists moved line
    numbers.
  - **Paper.** Each `v.paper` statement set paper before any drawing that
    reads it, so a scope around the frame's drawing (or a picture's `paper`
    option for pictures made under it) gives the same bytes. `pell-anim`
    passes one `PAPER` constant to the frame and its ten pictures.
  - **Codemod, beyond the plan.** A types phase changes declared `=> void`
    function types in the corpus to `=> Drawing` when a drawing callback is
    passed to them (render props such as `shade: () => void`, `Tint`, case
    tables), then the main pass runs again. A function body or scope body
    made only of drawing statements becomes one returned list; only bodies
    that mix statements use `out.push` or an immediately called function.
    `forEach` over a drawing callback becomes `map`.
  - **Listed and fixed by hand.** Ten functions that drew and returned a
    value now return `{ drawing, value }` (`drawSlot`, `cabinet`, `junk`,
    `stack`, `paintRow` twice, `drawEquation`, `chip`, `arm`,
    `paintSpecial`); `arm` passes its two scopes to `toCanvas`. Test
    modules whose `draw` drew nothing return `null`; these are outside every
    tsconfig, so only the runtime error found them. Five comma expressions
    in tests (`(base(v), line(v))`) dropped a drawing and became lists.
  - **Differences from the plan.** The made-not-returned count removes a
    node when a scope, a picture body or the root takes it, so a node inside
    an unreturned scope warns only for the scope. The paper scope is an
    identity `at` node marked in a `WeakMap`, which the walk replaces with
    its children; `SceneNode` gains no kind. The paper hint fires only
    inside a `v.paper` scope. `v.paper(settings)` without children throws
    `RemovedCallError`.
  - **Review.** Codex (`gpt-6-astra`) found two faults in the
    made-not-returned count: a re-record of a kept picture did not take
    outer nodes, and warnings given in earlier frames used up the frame's
    8. Both fixed with tests that fail without them; a verification round
    confirmed them.
  - **Size.** Runtime source about 640 changed lines (estimate ~650); new
    tests about 300 (~400); test corpus about 1,660 (~1,800); gallery and
    examples about 23,000 (~21,200), hand fixes included.
  - **Corpus patterns for R3 and the docs chunk.** 144 immediately called
    functions `((): Drawing => { … })()` where a scope body mixed
    statements with drawing; about 5,200 `out.push` lines; picture bodies
    written `() => { return [a, b]; }` where `() => [a, b]` reads better.
    The plan keeps the gallery in this form; R3's four examples and (a)'s
    chunk 7 should teach `.map`, `&&` and components instead, and say why
    the gallery does not.
  - **Checkpoint.** canvas-loop typecheck and lint pass; 223 non-GPU tests
    and 198 GPU tests pass (3 todo, as before); `gallery:check` passes all
    48; beebox typecheck and layout-check pass.

### Track 3: hand-written sketches and consumers (chunk R3)

- **What:** the examples the docs cite are rewritten by hand in the
  idiomatic form; the browser consumers and beebox compile.
- **Why:** agents learn from the examples the docs point at
  (`examples/orbit-tea.ts`, `fjord-tea.ts`, `bounce-tea.ts`, `sound-tea.ts`
  are named in `TEA.md`, `BRUSHES.md`, `README.md` and `AGENTS.md`); the
  codemod's `out.push` form is correct but is not the form the docs teach.
  The other nine examples keep the codemod's form.
- **Direction:**
  - The four examples: `.map` for loops, `&&` and `?:` for conditions,
    components returning `Drawing`, a local array only where state
    accumulates. Same bytes as `out/rs-after/`.
  - Playground, dev demo, React `SketchFigure`: type changes only (they
    mount modules and call no drawing).
  - beebox: the starter (`beebox/src/templates/builtins/starters.ts:195-201`)
    and the theme harness figure
    (`beebox/src/frontend/src/pages/dev/components/ThemeStudioHarness/figure.tsx:27-28`)
    return their drawing, so `test/cli/commands/figure/run.test.ts` and
    `test/webapp/routes/figure.test.ts` pass. The starter's wording and the
    guidance stay (c)'s.
- **First implementation chunk:** the four examples, then the consumers and
  beebox; `pnpm typecheck` and `pnpm layout-check` from `beebox/`.
- **As built (R3).** Commit a3da3f2e0. Logs are in `scratch/stage5/rs34/`.
  - **The four examples.** Each `draw` returns one list literal. Loops are
    `.map` over the model's data (orbit's planets, sound's bars and balls,
    fjord's cliff layers and ripple rows); conditions are `cond && node`
    (orbit's rings, selection ring and focus line; fjord's beach). Small
    components return drawings: `drawPlanet` in orbit, `barShape` in sound,
    `ripple` in fjord. No `out.push` and no immediately called function is
    left. Fjord's two ripple loops became two constant lists of rows and
    columns.
  - **Bytes.** All 13 examples render the same PNG bytes and transcripts as
    `out/rs-before/` (`out/rs-r3/`, compared with R2's `compare.ts`).
  - **Consumers.** The playground, dev demo and `SketchFigure` needed no
    change: the runtime types `draw`'s result as `unknown` and checks it at
    run time, so `PlaygroundModule` keeps that type. beebox's starter, the
    theme harness figure, and the sketches in
    `test/cli/commands/figure/run.test.ts` and
    `test/webapp/routes/figure.test.ts` return their drawing. The run test's
    expected warning lines moved down by one.
  - **Checkpoint.** canvas-loop typecheck, lint and tests pass (223, and 198
    with 3 todo on the GPU); `gallery:check` passes all 48; beebox typecheck
    and layout-check pass; the two figure tests and `test/schemas.test.ts`
    pass.

### Track 4: types carry shape; the sketch's contract is checked (chunk R4)

- **What:** runtime checks that a type fully states are removed; the CLI
  and `gallery:check` type-check each sketch and its exported contract.
- **Why:** the boxholder's validation direction, and the gap in What already
  exists: no step of the agent's loop runs the type checker, and checking a
  file does not check its exports against the runtime contract.
- **Direction:**
  - **Removed:** the `cap` and `join` value checks (`recorder/style.ts:126-127`).
    A literal or a variable of type `string` both fail the type.
  - **Kept**, because no type states them: unknown keys in styles, gestures,
    paper, effects, materials, lights and lighting (`style.ts:80`, `:122`;
    `brush-style.ts:24`, `:54`; `light.ts`), since TypeScript does not refuse
    extra keys on a non-literal object; finite numbers (`checks.ts:23-75`);
    ranges (`weight ≥ 0`, paper `contrast` 0..1, `wobble ≥ 0`); integers
    (`pixels` sizes, `pictures.ts:179`); cross-field rules (a dashed brushed
    stroke, `style.ts:114`; smudge or wet with effects, blend or erase,
    `brush-style.ts:42-44`); CSS colour parsing (`checks.ts:133-139`); plain
    `deps` (`pictures.ts:31-37`); the children rules (Track 2).
  - **The contract check.** One function, `checkSketchTypes(files)`, builds
    a TypeScript program over the sketch files and, per sketch, a virtual
    boundary file that imports the module and checks its exports together
    against `TeaModule<D, M>` (`core/tea.ts:297-301`), with `M` taken from
    `init`'s return type and `D` from `typeof params`. So `update` and
    `draw` must agree with `init` on the model and with `params` on the
    parameters, and `draw` must return `RootDrawing`. It reports every
    diagnostic in the sketch, its imports and the boundary file. The
    TypeScript API is loaded lazily, as `view/typecheck.ts:39-42` does.
    - `cli run` calls it before loading the sketch; errors go to the
      transcript and the run stops with exit 1. `--no-typecheck` skips it,
      for runs that time the renderer.
    - `gallery:check` calls it once over every exercise before rendering.
    - Exported from `./headless` for subplan (c).
- **Vocabulary lock-ins:** `cli run --no-typecheck`; `checkSketchTypes`.
- **First implementation chunk:** the removal and the checker, with tests:
  a sketch whose unannotated `draw` returns `0 && …` fails; one whose
  unannotated `draw` returns nothing (inferred `void`) fails; one whose
  `draw` expects a different model from `init`'s fails; one whose `draw`
  reads a parameter `params` does not declare fails; one with a
  type error in an imported helper fails; a clean one runs; `--no-typecheck`
  runs a sketch with a type error; `gallery:check` fails on an exercise
  with a boundary error. Timed on `pell-anim` (2,104 lines).
- **As built (R4).** Commits cf40c0243 (the check) and the review fix after it.
  Measurement scripts and logs are in
  `scratch/stage5/rs34/`.
  - **Removed:** the `cap` and `join` value checks, and their line in
    `test/scene/recorder.test.ts`. Every other check listed above stays.
  - **The check.** `checkSketchTypes(files)` in
    `src/headless/sketch-types.ts`, exported from `./headless` with
    `formatSketchTypeError` and `SketchTypeError`. It uses the TypeScript 7
    compiler through its API (`@typescript/native/unstable/sync`, loaded on
    first use), in the compiler's Go process. The config and one boundary
    file per sketch are virtual: the API's file system callbacks serve them,
    and every other read goes to the disk, so nothing is written. The
    program holds the sketches, what they import, canvas-loop's root export
    and the ES2023 library. Options: canvas-loop's `tsconfig.json`, with
    `module: preserve` and `moduleResolution: bundler` (as `tsx` and esbuild
    resolve), `types: []`, and `paths` for `@ianbicking/canvas-loop`, so a
    sketch outside the package (a temp directory, a box) resolves it.
  - **The boundary.** `M` is `ReturnType<typeof sketch.init>`; `D` is
    `typeof params` when it is a `ParamsDecl`, else no params. `init`,
    `update` and `draw` are each assigned to the `TeaModule<D, M>` member on
    their own line, so an error names its export. `TeaModule`'s members are
    methods, which TypeScript compares both ways, so a `draw` that wants
    more model than `init` gives would pass; the boundary converts each
    member to a function type (`Fn<F>`), which is compared strictly. A test
    fails without that conversion. `params`, `canvas`, `sound` and
    `activity` are checked when present; `TeaModule` gains `activity`.
  - **`cli run`** checks before it imports the sketch. On an error it
    empties `--out`, writes a transcript that lists the errors and names
    `--no-typecheck`, prints them to stderr, and exits 1.
    `canvas-loop/AGENTS.md` says so in place of "`run` does not type-check".
  - **`gallery:check`** checks every exercise in one program before it
    renders. After any type error no exercise is rendered: an exercise with
    errors in its directory lists them, an error outside every exercise gets
    its own entry, and every other exercise fails as not run. A file one
    exercise owns may be imported by another, so the run stops for all.
  - **Cost** (native compiler; `measure.sh`, `write-probe.ts`):

    | Program | Wall time | Compiler memory |
    |---|---|---|
    | `pell-anim` alone (2,185 lines; 82 files, 16,000 lines in all) | 82-89 ms per call, API start included | 18 MB heap, 49 MB peak RSS |
    | 48 exercises and 13 examples in one program (294 files) | 359 ms | 139 MB heap, about 160-190 MB peak RSS |
    | For scale: `tsc --noEmit -p canvas-loop` | 0.27 s | 256 MB heap, 349 MB peak RSS |

    The 1–2 GB figure is the JavaScript compiler's; canvas-loop's
    `typecheck` runs the native one. A `cli run` pays under 0.1 s and one
    short-lived process of about 50 MB.
  - **Gallery and examples.** All 61 sketches pass the contract check as
    they are; none needed a change.
  - **Tests.** `test/headless/sketch-types.test.ts`: in one program, an
    unannotated `draw` returning `model.n && …`, one returning nothing, one
    wanting a model `init` does not return, one wanting an undeclared
    param, and a helper with a type error each fail where they should, and
    a clean sketch has none; a missing `init` is named; `cli run` stops
    with the error on stderr and in the transcript; `checkGallery` fails an
    exercise with a boundary error without rendering it, and renders no
    exercise when a helper outside the gallery has a type error.
    `test/headless/cli/main.no-typecheck.gpu.test.ts`: `--no-typecheck` runs a
    sketch that fails the check.
  - **Review.** Codex (`gpt-6-sol`) traced the four R3 drawings (same
    nodes, same order) and the strict model check, and found two faults.
    First, a gallery exercise rendered while a helper it imports, in
    another directory, had a type error; fixed as above, with a test that
    fails without the fix. Second, with the `cap` and `join` checks gone, a
    box figure with `cap: "triangle"` draws a butt cap with no error,
    because `bbx figure run` and the card route do not type-check yet. Not
    taken: Track 4 removes these checks, and this plan merges only with
    (c), whose need 10 adds the check to both routes. If (c) drops that
    need, these two checks come back.
  - **For (c).** Need 10 in `canvas-loop-box-figures.subplan.md` records
    that `bbx figure run` and the card route need the same check, and that
    the check has no DOM types while a figure entry's default export calls
    `matchMedia`. R4 does not implement it there.
  - **Checkpoint.** canvas-loop typecheck, lint and tests pass (228, and
    199 with 3 todo on the GPU); `gallery:check` passes all 48 with the
    contract check (506 s wall; `time -l` gives 4.5 GB peak RSS for the
    whole run, with no figure from before R4 to compare; the check's
    compiler alone measured under 200 MB); beebox typecheck and
    layout-check pass.

### Track 5: speed and review (chunk R5)

- **What:** measure, compare, fix what the cross-model review finds.
- **Direction:** the walker and six-figure pages with the
  `scratch/stage5/a4b/` scripts, quiet machine, under the GPU lock. The
  baseline is the tree just before R1, measured in the same session (not
  chunk 4b's figures, since chunk 6 and (b)'s chunks 7–9 land between).
- **Allocation.** Added: the arrays sketches build for children (`.map`
  results, literals), the frame stamp (one property per node), and in the
  walk a new node for each `keepInside` text. Unchanged: one owned children
  array per container (it replaces `#inside`'s), and every per-frame node is
  a fresh object in both forms, so hash memo hit rates do not change. Per
  `keepInside` text occurrence: the copied inputs at construction, and in
  the walk a new `TextNode` with its glyph and position arrays
  (`recorder/text.ts:15-24`) and a new ancestor container. In R2,
  a brushed stroke's paper comes from the walk's `ctx`: the walk makes a new
  `ShapeNode`, `ShapeStyle` and `BrushStroke` for a brushed or effected
  shape inside a non-default paper scope, and a new ancestor container for
  each such replaced child. `geom` and `gesture` objects are shared, so the
  geometry and gesture memo still hit. These are counts, not measured costs;
  the acceptance below decides.
- **Acceptance** against the baseline: walker record plus walk at most
  0.5 ms more (median, Chromium); walker fps and six-figure fps each within
  1 fps of the baseline; input-to-frame p95 within 10 ms of it; output
  byte-identical to `out/rs-after/`. A miss goes to the boxholder with the
  profile.
- **As built (R5).** Scripts and logs are in `scratch/stage5/rs5/`
  (`alternate.sh`, `runs.log`, `medians.py`, `profile.py`).
  - **Method.** The baseline is a separate checkout of d1d08b5ee; the
    current tree is HEAD with R5's two review fixes. Both use R1's walker
    and six-figure pages. The six-figure page now returns `draw`'s value,
    so it runs on both trees. Ten runs of each, alternated, under the GPU
    lock. Load average was 2.6 to 4.3 at each run start, with no build or
    indexing in the top processes and no `vcmiclient`. Spotlight indexed the
    new checkout before the first run; the runs started after it stopped.
  - **Result: two misses.** Medians of ten runs:

    | | Baseline | Now | Change | Limit | Verdict |
    |---|---|---|---|---|---|
    | Walker record plus walk (rAF) | 2.1 ms | 2.2 ms | +0.1 ms | +0.5 ms | pass |
    | Record alone | 1.8 ms | 1.9 ms | +0.1 ms | — | — |
    | Walker fps | 57.6 | 56.4 | −1.2 | ±1 | **miss** |
    | Six-figure fps | 24.2 | 24.2 | 0.0 | ±1 | pass |
    | Pointer input-to-frame p95 | 66.5 ms | 98.0 ms | +31.5 ms | +10 ms | **miss** |
    | Output against `out/rs-after/` | | 61 of 61 identical | | | pass |

  - **Profile.** Each value is the median over the ten runs. The walk adds
    about 0.1 ms per walker frame; every other part of the frame is
    unchanged:

    | Per frame (ms) | Baseline | Now |
    |---|---|---|
    | Walker record | 2.1 | 2.2 |
    | Walker lower / brush / atlas / encode | 8.5 / 4.55 / 2.0 / 1.2 | 8.4 / 4.5 / 2.0 / 1.2 |
    | Walker frame p95 (rAF) | 21.1 | 22.05 |
    | Walker frame to GPU done, median / p95 | 21.85 / 25.45 | 22.15 / 26.15 |
    | Six-figure walker draw / lower | 2.3 / 9.9 | 2.3 / 9.9 |
    | Chemistry draw | 0.3 | 0.3 |
    | Pointer input-to-frame median | 55.65 | 56.6 |

    The walker's frame is at the 16.7 ms vsync edge: its median frame is
    16.7 ms in every run. So 0.1 ms more pushes more frames to the next
    vsync. Across the runs the walker's fps falls by about 1.2 (2%). The
    pointer p95 has two values: about 64 ms or about 105 ms. The
    difference, about 41 ms, is one frame of the six-figure page at 24 fps.
    In two of ten baseline runs the p95 was the higher value; in six of ten
    current runs it was. The median latency is unchanged (55.65 against
    56.6 ms). Folding the walk into lowering is the lever the plan names
    (Could this be simpler?). It is not taken here; the boxholder decides.
  - **Review.** Codex (`gpt-6-astra`) reviewed the whole diff from R1 to
    R4. It did not review the 48 converted gallery exercises or the nine
    converted examples. It found two faults, both fixed, each with a test
    that fails without its fix:
    - The contract check refused a sketch that exports only `init`,
      `update` and `draw` (TS2559). The boundary's target for the optional
      exports was a weak type. An index signature on that target fixes it.
    - The picture-paper hint fired for a picture whose body has its own
      paper scope, when that scope matches the paper the picture is placed
      in. The hint now fires only when a stroke or effect draws on the
      picture's own paper.

### Seams

- **Core subplan (a).** This plan starts after (a)'s chunk 6, so there is
  one `View` and one runner to change. (a)'s chunk 7 (docs) starts after
  this plan and writes `TEA.md` and `BRUSHES.md` in the returned form; its
  doc probe is the first fresh-agent test of the form. `scene-api-draft.md`
  gets a draft 2.11 section here (R2), replacing §1's stance and the R9
  paper rules.
- **GPU brushes (b).** If the boxholder takes (b) past its stop point, this
  plan starts after (b)'s chunk 9, which deletes the CPU expansion and its
  tests; otherwise after (a)'s chunk 6. (b) touches lowering and
  `scene/brush/`, not the recorder's API.
- **Box figures (c).** Two needs besides (c)'s list
  (`canvas-loop-box-figures.subplan.md:338-367`):
  1. **Type-checking on both box paths:** `bbx figure run` and the figure
     card route (`webapp/routes/figure.ts:153`) run `checkSketchTypes` (or
     beebox's `lib/typescript/check.ts` with all diagnostics, not the view
     wrapper's boundary-only filter at `view/typecheck.ts:95-97`) and report
     type errors: in `bbx figure run`'s output, and as the card's error.
     Both routes run it; a fixture with a type error in an imported helper
     goes through each. The runtime checks Track 4 keeps are shared and
     apply on both routes as well.
  2. Starters, `card-figure.md` and box audits teach the returned form; an
     old figure's card shows the `RemovedCallError` from Track 2.

## Could this be simpler?

- **The flip with no walk:** constructors read a scope stack the recorder
  holds. It cannot work: `v.group(o, [v.rect(…)])` evaluates `v.rect`
  before `v.group` runs, so the scope is unknown at construction.
- **No codemod; agents rewrite every sketch by hand.** About 45,000 lines,
  each judged by eye. The codemod gives identical bytes, a stronger check
  than a visual read, for about 450 throwaway lines.
- **Leave the gallery in builder form** through a test-only builder.
  Refused: a second API (§8), and `gallery:check` would stop exercising the
  shipped one.
- **Rewrite all 13 examples by hand** (the first draft of this plan). Cut
  after review: only the four the docs cite are read as teaching material.
- **Fold the walk into lowering** (`gpu/lower.ts:40` already walks). Saves
  a pass in the browser, but outlines, diffs, hashing and the picture audit
  also read `Scene`; each would learn nested lists and paper scopes. Not
  now; Track 5 measures the walk.
- **Allow nodes to be kept across frames.** It would skip picture freshness
  and font invalidation (Track 2); pictures already do this job.
- **Skip the made-but-not-drawn warning.** A statement-form helper then
  draws nothing with no message (§4); it costs one `WeakMap` entry per node,
  in testing mode only.
- **Skip the contract check** and keep every runtime shape check. It
  ignores the boxholder's validation direction and leaves `draw` returning
  `0` unchecked; it is about 200 lines.
- **A trial with agents** before fixing details was considered. Each
  decision above follows from code facts, so none is planned; (a)'s chunk 7
  doc probe is the first agent read.

## Subplans

none.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A helper draws as statements and its caller drops the result | new (R2) | type error when the helper's result is placed in a list; testing-mode warning naming the line | clear headless; silent in the browser |
| A `Drawing`-returning callback passed where `void` is typed; its caller ignores the result | codemod fixture (R2) | codemod lists it; made-not-drawn warning | clear headless |
| An old builder-form box figure meets the new runtime | new (R2) | `RemovedCallError` for a function child or a `draw` returning `undefined` | clear |
| `count && v.rect(…)` with `count` 0, untyped | new (R2) | construction error with the sketch's stack | clear |
| A sketch mutates a children array after constructing the scope | new (R2) | children copied at construction | not reachable |
| A kept `place` or text node returned in a later frame | new (R2) | frame-stamp error | clear |
| A plain shape with `effects.paper` inside a paper scope keeps default paper | new (R2: no-brush case) | `effectsPaper` resolved apart from `brush.paper` | not reachable |
| A brushed picture inside a paper scope has no `paper` option | new (R2: hint) | testing-mode hint once per key | clear headless |
| `keepInside` text placed under two transforms lays out once | new (R1) | walk lays out per occurrence from kept inputs | not reachable |
| A draw throws after `v.light` outside a lit group | new (R1) | error line given; the light warning is not | the warning is lost for that frame (accepted) |
| The codemod reorders evaluation, changing a frame | byte comparison and fixtures (R2) | listed for hand-fixing | clear |
| An unannotated `draw` returns a number | new (R4) | contract check | clear |
| A misspelled key in a style held in a variable | existing (`style.ts:122`) | runtime check kept | clear |
| Walk cost lowers browser fps | R5 measurement | levers: skip work outside testing mode, fold into lowering (own plan) | clear |
| A box figure with a type error reaches the card unchecked | (c)'s need 1 | (c) type-checks or keeps runtime checks | clear once (c) lands |

## Agent-flow / user-flow edge cases

- **Wrong form of two similar things** (`v.paper(s)` as a statement, from
  habit): ADDRESSED. It is a type error (children missing); untyped, the
  `paper` constructor refuses a missing `children` argument.
- **Stale ref** (a `Picture` or node from an earlier frame): ADDRESSED,
  `pictures.ts:168-171` for pictures, the frame stamp for nodes.
- **Two agents touching the same card:** not applicable; one sketch file.
- **Hand-edit drift** (forgetting `return` in `draw`): ADDRESSED, the type
  of `RootDrawing` and the `RemovedCallError`.
- **Fabricated free-form value:** not applicable.
- **Validation error UX:** ADDRESSED. Construction errors carry the stack
  at the sketch's call; walk errors name the node path and, in testing mode,
  the call site; type errors name the file and line.
- **Partial migration:** ADDRESSED. R1 lands under the builder; R2 flips the
  API and the corpus together; nothing merges until the plan is done.

## NOT in scope

- **Idiomatic rewrites of the gallery and the other nine examples:** they
  keep the codemod's form, as before.
- **Folding the walk into lowering:** only if Track 5 shows a need.
- **Showing testing-mode warnings in the browser**, or call sites there.
- **A lint rule for a discarded constructor result:** the root type, the
  runtime error and the warning cover it; a type-aware rule can follow if
  the doc probe shows a need.
- **Writing `TEA.md` and `BRUSHES.md`:** (a)'s chunk 7.
- **Type-checking on beebox's paths and box guidance:** (c).
- **A node form for frame outputs:** considered and refused (Track 2).
- **Nodes kept across frames:** refused (Track 2); pictures do this.

## Open design questions

- **Paper becomes a scope** (Track 2), a change to R9 and accepted decision
  10. For a sketch: a `v.paper(…)` that wraps its drawing applies to all of
  it; it no longer leaks out of an `at` or `clip`; a group's wash uses the
  paper around the group, not one set at the end of its body; a picture
  uses its own `paper` option, default the default paper, and a hint fires
  when it is placed in a scope with other paper. Cost: one option and hand
  fixes in 13 files, with possible frame differences in them. Lean: accept.
  Keeping today's rule needs paper state while constructing, which the
  returned form does not have, and taking a picture's paper from where it is
  placed breaks *"A picture never depends on where it is placed"*
  (`scene-api-draft.md:180`).

## Knowledge audits

Skipped here: box agents learn the returned form from `TEA.md`, written in
(a)'s chunk 7, and (c) carries the box audits for figures.

## What will hold this after it ships

- Recorder tests (`test/scene/recorder*.test.ts`), ported by the codemod,
  plus new walk and construction tests: children rules (nested lists,
  skipped values, each refused value), a children array changed after
  construction, a node returned twice in a frame, a node returned in a
  later frame, paper scope with brushed and effect-only shapes, the picture
  paper option and its hint, `keepInside` under two transforms and in a
  picture, made-not-drawn (including a picture body and a throwing draw),
  the `RemovedCallError` cases, `toCanvas` over a scope chain.
- `gallery:check`, which now runs every exercise through the returned form
  and type-checks its contract.
- The dev-loop cases (`test/gpu/dev-loop/cases.ts`) keep every warning text.
- The contract-check tests (Track 4).

## Implementation order

Each chunk ends with `pnpm --dir canvas-loop typecheck`, `lint` and `test`
passing, and `pnpm typecheck` and `pnpm layout-check` from `beebox/`.

0. **Placement.** After (a)'s chunk 6, and after (b)'s chunk 9 if (b) goes
   past its stop point. Before (a)'s chunks 7 and 8 and before (c).
   Baseline speed measured here.
1. **R1, the walk.** Checkpoint: same warning texts, `gallery:check`, same
   bytes for the ports and cache cases.
2. **R2, the flip.** Checkpoint: codemod fixtures pass; every exercise and
   example byte-identical to `out/rs-before/` except the listed paper
   differences, judged by eye; `runs.jsonl` and `meta.yaml` lines; the
   `ACKNOWLEDGEMENTS.md` entry; draft 2.11 section; coverage-matrix row 115
   answered; Codex review of the runtime diff.
3. **R3, hand-written examples.** Checkpoint: the four examples
   byte-identical; beebox figure tests pass.
4. **R4, types.** Checkpoint: its tests; `gallery:check` with the contract
   check.
5. **R5, speed and review.** Checkpoint: Track 5 acceptance; cross-model
   review of the whole diff.

## Rollout shape

- **Tests first:** the walk tests are written in R1 against the builder and
  hold through R2; the codemod fixtures before the corpus run.
- **No data migration:** box figures are regenerated by (c).
- **Merge:** with (a) and (c), on the boxholder's go-ahead
  (`canvas-loop-scene-core.subplan.md`, Rollout shape). This plan never
  lands alone: without (c), every courseware figure would show an error with
  no regenerated sketch behind it.

## Review round 2

Codex (gpt-6-astra), `scratch/cross-model/rs-plan-r2.answer.md`: findings
2, 3, 4, 8 and 10 hold; the frame stamp's symbol key is confirmed invisible
to the hashes (`hash.ts:93`) and to `sameData` (`pictures.ts:47`). Fixed:
- 5: the contract check relates `init`, `update`, `draw` and `params`
  through `TeaModule<D, M>`, with mismatch cases.
- 6: the evaluation-order reason corrected (the options' contents are now
  read after the children); the codemod's flag widened to aliases and
  helpers, with fixtures; the exported `draw` gets `RootDrawing`.
- 7: `textBounds` with `keepInside` keeps today's measurement.
- 9: made-not-drawn accounting is per frame across all resolves, checked
  after the frame; `false` is allowed at the root. Refusing `undefined` at
  the root stays, with its reason (the builder-form signal).
- 11: (c) type-checks both routes, with no fallback.
- 12: `keepInside` allocations counted; the stale 2.5 ms reference removed.
- 1: the paper rule stays an open question for the boxholder.

## Review round 1

Codex (gpt-6-astra), `scratch/cross-model/rs-plan.answer.md`. Twelve
findings; each checked against the source.

1. **R1 cannot recover statement paper from the tree.** Holds:
   `v.paper` emits no node (`view.ts:276-279`), leaks out of `at` and `clip`,
   and a group takes end-of-body paper. R1 now keeps paper at the call; R2
   changes the rule to a scope, as an open question with frame differences
   allowed in the 13 files.
2. **Caller-owned children arrays.** Holds. Children are now flattened into
   an owned array at construction.
3. **Nodes kept across frames skip picture and font checks.** Holds. Nodes
   are stamped with their frame and refused in a later one.
4. **Unknown-key checks are not covered by types.** Holds (structural
   typing of variables). Kept; only `cap` and `join` checks go.
5. **Checking a file does not check its exports.** Holds
   (`tea-load.ts:164`, `tea.ts:290`). A virtual boundary file per sketch;
   `gallery:check` runs it too.
6. **Codemod misses `void` callbacks and changes evaluation order.** Holds
   (`pell-anim` `Tint`). Both are listed for hand-fixing, with fixtures.
7. **Text lacks the inputs to resolve `keepInside`.** Holds. The
   constructor keeps them; `ctx` carries the box size.
8. **`effectsPaper` without a brush.** Holds (`style.ts:143`). Resolved
   separately, with a case.
9. **A frame-wide construction count misclassifies.** Holds. The error is
   now "`draw` returned `undefined`", with `RootDrawing` excluding it in
   the type; the warning uses per-scope accounting checked after a
   successful resolve.
10. **Diagnostics on failed draws and in the browser.** Holds. The lost
    warning on a throwing draw is accepted and stated; the browser keeps
    light warnings without call sites, stated.
11. **The card route is not type-checked.** Holds
    (`webapp/routes/figure.ts:153`). Assigned to (c), with the view
    wrapper's filter named as not reusable.
12. **Budget and speed omissions.** Holds: internal drawers
    (`controls.ts:65-80`) added; the examples' second rewrite cut to four
    files; acceptance now against a baseline taken just before R1, with
    six-figure and input thresholds.

**Decision on the R5 misses (2026-11-16).** Accepted, under the
boxholder's standing "Accept for now" on desktop numbers
(`stage4/checkpoint4.md`, answer 7). The walk adds 0.1 ms; the walker sits
at the 60 fps edge, so that tips a few more frames past a refresh. The
pointer p95 alternates between two values one six-figure frame apart, and the
median moved 0.9 ms. Moving the walk into lowering is not started.

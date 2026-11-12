---
title: "Figure verification: bbx figure run, the figure log, and teaching"
status: implemented
workstream: canvas-brushes
issues:
  - ../../../issues/bugs/2026-07-18-canvas-loop-figure-post-merge-followup.md
---
# Figure verification: `bbx figure run`, the figure log, and teaching

A box agent rebuilt the courseware box's hardware scale as a canvas-loop
figure and filed feedback (`_config/feedback/Canvas_Loop_Figure_In_A_Box.doc.card`
in that box): it could not render the figure headlessly from the box, nothing
checked the entry, hit-testing was hand-rolled, the figure could not report
learner activity, and the factory's arguments were untyped.
The boxholder added two asks from a screenshot: a canvas-loop figure is
clipped at phone width, and a centred label should stay centred "until it
hits the edge". This plan answers
it mostly with tools the box already has: it teaches the box browser, and
exposes canvas-loop's replay and log through it. It adds figure activity.

**Issues addressed:** item 1 of the follow-up below (narrow-width overflow).
Related, not resolved:
`issues/bugs/2026-07-18-canvas-loop-figure-post-merge-followup.md` (item 1,
the narrow-width overflow, is fixed here; its pixel-verification item gets a
tool; the issue's other items stay open, so finish amends it rather than
closing it),
`issues/code-quality/2026-07-15-figure-compile-cache-and-attach-guard.md`
(untouched). Searched `issues/` for "figure" and "canvas-loop".

## Decision log

- **2026-11-12, boxholder:** "you shouldn't need the browser at all with
  canvas-loop, right?" and then "yes, that's fine as a new dependency". The
  browser-replay design below (Tracks A's `script` option and B) is replaced
  by `bbx figure run`, a wrapper over canvas-loop's headless runner, shipped
  with beebox: canvas-loop as a devDependency inlined into the CLI bundle,
  `@napi-rs/canvas` and `perfect-freehand` as beebox dependencies, canvas-loop
  in the deploy sync list, `bin/bbx` rebuilding when canvas-loop source
  changes. The run happens in a child process (`figure run-one`) under a
  timeout. `teaRun` gained validated `initialParams` so the card's param
  defaults and `--params` apply as in the browser. The browser `script`
  replay was removed again before landing. Track A's console log, the
  narrow-column fit and `keepInside` stay, as do Tracks C, D (rewritten for
  `bbx figure run`) and E.
- **2026-11-12, second feedback card** (`Code_Reuse_Across_Figures_And_Views`
  in the courseware box): figure entries and views already bundle relative
  imports and JSON (verified with `bbx figure run`); the gap is guidance.
  Track D adds "Sharing code and data between figures and views" (`src/lib/`,
  JSON imports, purity) and a box-docs copy of canvas-loop's TEA.md and
  BRUSHES.md (`canvas-loop.md`, `canvas-loop-brushes.md`), whose
  sibling-only import rule is the checkout's lint.

## Design

The person-facing change: a figure open beside the chat tells the agent what
the learner did, as a view does.

- **When** a learner works a figure in the companion pane, **I want** the
  agent to know what they tried (a control they set, a thing they pressed),
  **so I can** ask about it without describing it.
- It rides the existing `card-activity` channel, latest-wins per kind
  (`src/core/chat/card-activity.ts:14-21`), seen on the agent's next turn.
  Nothing is shown to the learner. The detail is an allowlist: handled names
  and declared param values, bounded in length; never coordinates, raw keys
  or model state.

The rest is box-agent tooling.

## Smallest fix and budget

**Smallest fix:** docs only, pointing at `bbx browser`. It leaves two real
gaps: the figure harness drops canvas-loop's log
(`canvas-loop/src/browser/mount.ts:93-94`: *"Figures surface frames +
recorded events, not the transcript log."*), so style notes, overlap
warnings and `v.log` never reach the console; and there is no way to replay
a scripted session in the box.

**Chosen design**, about 350 source lines, 250 test lines, ~100 lines of docs
and audit entries:

- A: canvas-loop browser runtime: log to the console; `script` replay option;
  figures fit a narrow column; text `keepInside`.
- B: beebox figure view: `?events=<path>&frame=N` replays a box file; param
  mismatch warning.
- C: figure activity.
- D: docs (teach the verify loop and the factory's arguments) and knowledge
  audits.
- E: canvas-loop transcript collapses repeated `(unhandled)` lines.

Not a BIG CHANGE.

**Rejected first draft:** a `bbx figure check` command running canvas-loop's
headless runner inside `bbx`. A cross-model review found it needs
canvas-loop, `@napi-rs/canvas` and `perfect-freehand` shipped with beebox
(the CLI bundle uses `packages: "external"`,
`src/scripts/build-cli/build/bundle.ts:50`), a declaration-shipping path for
types, a child-process sandbox for authored code, and a deploy sync change.
The box browser already runs the figure with the frontend's canvas-loop.

## Stated preferences this plan trades against

- **Minimize invented concepts** (boxholder memory): no new verb. Reuse
  `bbx browser` (`open`, `screenshot --card`, `console`, `errors`), the
  existing events-file format, the runtime's own event recording
  (`eventsJSON`, `canvas-loop/src/browser/runtime/engine.ts:238`), and
  `card-activity` kind `"explored"` (`src/shared/card-activity-kinds.ts:12`).
- **Use existing tools, teach them** (boxholder, this session): the feedback
  agent did not know `bbx browser` could open its own figure; that arrived on
  2026-11-08 (`box-docs/agent-changes.md:15`).
- **Bias toward strict:** a replay with a malformed events file is an error
  on the page and in the console, naming the line.
- **No features beyond the task** (beebox/AGENTS.md): type-checking figures,
  a typed context export, and hit regions are deferred (NOT in scope).

## What already exists

- **Box browser:** `bbx browser open /views/<card path>`, `screenshot
  --card` (`box-docs/bbx-commands.md`, "bbx browser"). Refused subcommands
  are only `connect, batch, dashboard, install, upgrade, plugin, mcp`
  (`src/core/browser/exec-args.ts:52`), so agent-browser's `console`,
  `errors` and `eval` work. **Teach.**
- **Figure compile errors** reach the page: the route returns
  `export const figureError = …` (`src/webapp/routes/figure.ts:40-42`) and
  FigureView shows it (`FigureView/view.tsx:118-121`). **Reuse**: a
  screenshot or `errors` shows a bad import.
- **Embed params** reach FigureView as `params` from the query
  (`FigureView/view.tsx:44,57-58`). **Extend** with `events` and `frame`
  (verify `/views/<card>?…` passes the query through).
- **Runtime stepping:** `#doFrame` folds pending events then the tick
  (`engine.ts:297-302`), the same order as headless. **Reuse** for a
  synchronous replay.
- **Activity plumbing:** `ViewProps.reportActivity`
  (`src/core/views/types.ts:90`); `ActiveFileRenderer.tsx:50` passes it only
  to agent views; `RendererProps` (`src/frontend/src/file-type-registry.ts:49-77`)
  lacks it; the store replaces a latest-wins value synchronously
  (`src/frontend/src/components/chat/conversation/card-activity-store.ts:16`).
  **Extend.**
- **Event stream:** `MountSketchOptions.onEvent` (`mount.ts:146`),
  `EmittedEvent` (`engine.ts:72`); param events carry no `handled`/`changed`
  (`engine.ts:334`). **Reuse.**

## Prior art (external)

No decision depends on an external premise.

## Ontology

- **`script` option** (new, `mountSketch`): `{ events, frame? }`. The runtime
  steps synchronously through frames 0..`frame` (default: last event frame +
  1) applying the events, draws once, and pauses. Each scripted interaction
  logs a verdict line.
- **Figure query keys** `events` (a path in the card's attach scope, like
  `entry`) and `frame`.
- **Console lines:** `[canvas-loop] frame N: <message>` for `v.log`, notes,
  warnings and replay verdicts.

## Tracks / scope

### Track A: canvas-loop browser runtime

- **What:** `onLog` default writes `[canvas-loop] frame N: …` to
  `console.log` (warnings to `console.warn`); `script` replay as above, with
  verdicts using the headless verdict function and Track E's collapse.
  Replay errors (bad events) throw through `onError`.
- **Fit (bug, boxholder screenshot 2026-11-12):** a canvas-loop figure is
  clipped at phone width. `.cl-figure` is `inline-flex` with no width cap
  (`canvas-loop/src/browser/figure.css:10`), so `.cl-stage { max-width: 100% }`
  (`:42`) resolves against a container as wide as the canvas. Cap
  `.cl-figure` and the canvas at 100% with `height: auto`; over-canvas inputs
  already place by percentage (`src/browser/controls.ts:289-292`) and pointer
  mapping divides by the drawn width (`mount.ts`). Verify at 390px. This is
  item 1 of `issues/bugs/2026-07-18-canvas-loop-figure-post-merge-followup.md`.
- **`keepInside` (boxholder request: "centered, until it hits the edge"):** a
  text option; the laid-out text keeps its alignment but slides back inside
  the canvas (4px margin) when it would cross an edge. Works under `at`
  transforms by measuring in canvas space. `textBounds` returns the moved
  box.
- **Why:** the log is the agent's main headless signal; replay gives the
  feedback's "scripted events, frames I could read, verdicts" in the box.

### Track B: figure view replay and param check

- **What:** FigureView reads `events`/`frame` from the query, reads the file
  with the figure file helpers, parses it with canvas-loop's
  `parseTeaEvents`, and the canvas-loop harness wrapper injects `script` into
  the factory's `mountSketch` call. The wrapper also compares the card's
  `params:` with `options.module.params` and console-warns on a mismatch.

### Track C: figure activity

- **What:** `reportActivity` on `RendererProps`, passed by
  `ActiveFileRenderer` bound to the card it renders; FigureView hands it to
  FigureMount; the canvas-loop wrapper chains `onEvent`: param events report
  `set <name> = <value>`; other events report only with handled names
  (`pressed <names>`); no throttle (the store is latest-wins and
  synchronous). Detail capped at 200 characters. Replays do not report.

### Track D: docs and audits

- **What:** in the figure schema instructions (canvas-loop section): the
  verify loop (`bbx browser open "/views/<card>?events=attach/<stem>-events.json"`,
  `bbx browser console`, `bbx browser errors`, `bbx browser screenshot
  --card`); the sibling events-file convention and format; how to get an
  events file by playing it (the toolbar's recorded events); the factory's
  arguments (`mount`, `figure.params/data/meta/file`, `onEvent`). Fix the
  starter comment that points at "the canvas-loop CLI"
  (`src/templates/builtins/starters.ts:155-156`). An `agent-changes.md` entry.
  Knowledge-audit entries (below).

### Track E: transcript noise

- **What:** the first `(unhandled)` line per msg type prints; later ones
  collapse into one closing line per type, in the headless transcript and the
  replay console.

## Review decisions (second cross-model review, 2026-11-12)

- **Replay lives in `Runtime`:** `replay(events, { frame })` steps
  synchronously, drawing after every frame's events and tick as headless does
  (`canvas-loop/src/headless/tea-runtime.ts:225`); `frame` is the inclusive
  last frame (default: the last event's frame). Events dispatch through the
  same fold as headless, with no browser clamping. A test compares a replay's
  final model and pixels with the headless run of an accumulating sketch.
- **Parser in the browser:** `parseTeaEvents` is exported from
  `@ianbicking/canvas-loop/browser`; the beebox wrapper parses inside its
  `mountSketch` wrapper, where `options.module.params` is known. Errors name
  the event index.
- **Query keys** are `replay` (a path) and `replayFrame`; a card that declares
  a param with either name gets an error. Both join the mount key.
- **The replay file** must resolve inside the figure card's own attach
  directory; anything else is an error shown in the figure.
- **Events files are written by hand** (the format is in TEA.md); the docs do
  not promise a recorder.
- **Error channels:** compile and replay errors show in the figure (page text
  and screenshot); `bbx browser console` carries canvas-loop log lines;
  `errors` only uncaught exceptions.
- **Attribution:** `ActiveFileRenderer` hands each card a reporter bound to
  that card's activity source key; activity covers figures in the companion
  pane only (nested embeds omit it, as for views).
- **Labels:** handled names are strings the figure's author chose, the same
  trust as a view's `reportActivity` detail; sent as-is, capped at 200
  characters. Raw keys, coordinates and model state are never sent.
- **`keepInside` geometry:** project the text box's corners to canvas space,
  compute the shift there, map it back through the inverse transform. Text
  wider or taller than the canvas aligns to the left/top edge. A singular
  transform skips the adjustment.

## Could this be simpler?

- **Docs only:** misses the dropped log and replay (above).
- **Replay at real speed** instead of synchronous stepping: the agent would
  have to wait and time screenshots; synchronous stepping makes the final
  frame deterministic.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Events file missing or outside the attach scope | new | figure shows the error; console error | clear |
| Events file malformed | existing `parseTeaEvents` | error names the line | clear |
| Sketch throws during replay | existing onError | figure error; loop stopped | clear |
| Query `/views/<card>?events=` not passed through | verify in A/B | — | checked before docs claim it |
| Activity from a background figure mislabels the focused card | new | report bound to the rendering card | clear |
| Console flooded by `v.log` every frame | — | sketch's own choice; same as headless | visible |

## Agent-flow / user-flow edge cases

- **Learner opens a link with `?events=`:** it replays then pauses; harmless.
  Replays never report activity.
- **Two figures on a page:** each wrapper reports for its own card.
- **Hand-edit drift between card and module params:** console warning.

## NOT in scope

- Type-checking figure entries (needs canvas-loop's types shipped to boxes).
- A typed `FigureContext` export (documented in prose instead).
- Hit regions (`v.region`): a separate canvas-loop plan; needs a design
  round with the boxholder.
- Glyph warnings in the browser (headless only; the browser draws with the
  learner's real fonts).

## Open design questions

- Hit regions, deferred above.

## Knowledge audits

New entries in `src/dev/knowledge-audits.yaml`, tag `figure`: how to verify
a canvas-loop figure from the box (expects `bbx browser open /views/…`
with `events`, `console`, `screenshot --card`); where its warnings appear
(console); whether figures report learner activity (yes, automatically).
Run `--filter figure` on the worktree's test1 clone after the docs change.

## What will hold this after it ships

- canvas-loop tests: replay reaches the same model and pixels as headless for
  one sketch; console line format; unhandled collapse.
- beebox tests: FigureMount wrapper (script injection, activity details,
  param mismatch), RendererProps plumbing.
- The knowledge-audit entries.

## Implementation order

1. Track E, then Track A (canvas-loop).
2. Track B, verified in a real browser with `bbx browser` against the test1
   clone.
3. Track C.
4. Track D, audits, cross-model review.

## Rollout shape

Done when a copy of the hardware-scale figure replays from an events file
through `bbx browser` with its console lines, tests and typecheck pass, and
the figure audits pass.

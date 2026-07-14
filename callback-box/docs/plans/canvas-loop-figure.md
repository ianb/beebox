# canvas-loop figure runtime

**Status:** active — designed 2026-07-14, implementation starting in worktree quick-seeing-p5js

Add `canvas-loop` as a figure-card runtime: a figure card whose attach-scope
`.ts` entry is a canvas-loop TEA sketch, rendered in the box UI by
`<SketchFigure>` from `@ianbicking/canvas-loop/react`, with the boxholder's
param adjustments persisted back into the card's `params` frontmatter. This
gives boxes deterministic, interactive, agent-authorable figures whose
authoring loop (write → headless render → read frame-tagged transcript) the
agent can run without a browser — the capability validated in
`../../issues/exploration/2026-07-13-canvas-tight-loop-agent-programming.md`.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — traced throughout: #3 validate at
  boundaries, #4 resilient AND never silent, #8 one way to do each thing,
  #11 enforcement beats convention, #12 the maintainer is usually an agent.
- `callback-box/CLAUDE.md` — "don't add features beyond what the task
  requires"; Phase-2 cards format (YAML frontmatter + one markdown body).
- `code-style.md` — locked RMW for same-file card writes; no `any`; cast
  conventions.
- **Shipped precedent (densest):** the figure card itself —
  `docs/implemented-plans/figure-card-type.md` and its implementation.
  This plan is deliberately a *fourth runtime* on that precedent, not a
  parallel mechanism (#8).

## What already exists

Everything load-bearing exists; this plan is mostly wiring:

- **Figure schema** — `src/schemas/figure.ts:28-115`: `cardSchema("figure",
  { fields: { runtime, entry, data?, params?, width?, height?, body } })`,
  with template helpers (`figure.ts:226,242`). REUSED: `runtime` gains a
  `"canvas-loop"` value; `params` is exactly where SketchFigure's controlled
  values persist.
- **Runtime compile + serve** — `src/webapp/views/compiler.ts:134`
  (`bundleView`, esbuild at request time, mtime cache) and
  `src/webapp/routes/figure.ts:41-99` (`GET /api/figure/module.js`,
  path-guarded to `.ts/.tsx` inside an `.attach` scope, compile errors
  returned as a `figureError` module export rather than a thrown 500).
  REUSED with one addition: externalize `@ianbicking/canvas-loop` to a
  window shim (below), following `reactExternalPlugin`
  (`compiler.ts:56-97`) which already does this for React.
- **Viewer** — `src/frontend/src/components/FigureView.tsx:63-95`: client
  `useEffect` + dynamic `import()` with cache-busting, `ViewErrorBoundary`
  (`FigureView.tsx:20,122`), embed/page modes threading `params` + captions
  (`file-type-registry.ts:39-62`). REUSED: a `runtime === "canvas-loop"`
  branch mounts `<SketchFigure>` instead of the FigureMount factory
  harness.
- **`<SketchFigure>`** — `canvas-loop/src/react/SketchFigure.tsx`: SSR-safe
  by construction (server renders placeholder; runtime starts in a client
  effect), controlled `params` + `onParamsChange` designed for exactly this
  persistence composition, `onEvent` for watching. REUSED unchanged.
- **Param persistence precedent** — `src/webapp/trpc/routers/todos.ts:50-63`
  (`updateItem`: zod input, type guard, serialized locked RMW on the card
  file) and its frontend usage `TodoListView.tsx:225-242`. REUSED as the
  model for a `figure.updateParams` mutation.
- **Validation** — parse boundary `src/core/card-io.ts:107,128` (fail-closed
  frontmatter), lint hook surface `src/core/card-lint.ts:185`. The figure
  schema has no `validate` hook; the sketch's real check is compilation,
  same as views (`compiler.ts:307`). REUSED; plus canvas-loop's own
  `gallery check`-style determinism check stays a canvas-loop concern, not
  a card-lint concern (NOT in scope).

Nothing is rebuilt.

## Prior art (external)

- **esbuild erases `import type` without resolving it** — verified in
  esbuild docs/behavior (TS type-only imports are dropped at parse; no
  resolution attempted). Load-bearing for compiling sketches that live in
  boxes *outside* the monorepo where `@ianbicking/canvas-loop` is not
  resolvable. Belt-and-braces: the runtime shim below also handles a plain
  value import.
- The broader external research for canvas-loop itself (headless canvas,
  determinism, declared-params prior art) is already recorded in the
  exploration issue; not repeated here.
- No additional external search needed: every dependency in play (esbuild,
  React, tRPC) is used in an already-shipped identical pattern in this
  codebase (the figure card). Skip-with-rationale.

## Tracks / scope

Single track, five chunks (order = dependency):

**Chunk 1 — frontend dep + window shim.** Add `@ianbicking/canvas-loop:
workspace:*` to `src/frontend/package.json`. Expose the module for compiled
sketches: `window.__cbCanvasLoop` set alongside `window.__cbReact`
(`view-host.tsx` / wherever `__cbReact` is assigned), so a sketch that
value-imports the package (against instructions, but possible) still
resolves to the host's single copy instead of failing.

**Chunk 2 — compile route.** In `routes/figure.ts`, when the entry's card
declares `runtime: canvas-loop`, call `bundleView` with
`external: ["@ianbicking/canvas-loop"]` plus an esbuild shim plugin mapping
that specifier to `window.__cbCanvasLoop` (clone of `reactExternalPlugin`,
`compiler.ts:56-97`). Type-only imports erase anyway; the shim is the
resilient path (#4: a wrong-import sketch degrades to working, and the
compile-error module channel already reports anything else, `figure.ts:91-97`).

**Chunk 3 — schema + instructions + template.** `figure.ts`: `runtime` enum
gains `"canvas-loop"`; `instructions` gain a terse canvas-loop section — TEA
contract pointer (the sketch module shape: `params`/`init`/`update`/`draw`),
`import type ... from "@ianbicking/canvas-loop"` (type-only, spelled out),
the headless authoring loop (`pnpm --dir canvas-loop run cli run` is
monorepo-dev only; in boxes the agent uses the `canvas-loop-sketch` skill /
`cb`-provided runner — see Open questions), and that `params` frontmatter
holds the persisted values. `createFigureTemplate`/starter gains a
canvas-loop starter sketch (a small TEA example with one param).

**Chunk 4 — viewer branch + params persistence.** `FigureView.tsx`: when
`runtime === "canvas-loop"`, dynamic-import the compiled module and render
`<SketchFigure module={mod} params={cardParams} onParamsChange={persist}
showControls>` inside the existing `ViewErrorBoundary`; embed mode maps to
`showControls={false}` unless `?controls=1` (embed syntax precedent,
`figure.ts:104-114`). `persist` = debounced (~1s) call to a new
`figure.updateParams` tRPC mutation: zod input `{cardPath, params:
record}`, guards `typeFromFilename === "figure"` AND declared runtime,
locked RMW updating only the `params` frontmatter key (model:
`todos.ts:50-63`). Loop-guard: skip the mutation when values deep-equal the
card's current `params` (controlled echo would otherwise write on mount).

**Chunk 5 — knowledge audit + docs.** Audit entries (below) run against the
worktree test box; `docs/adding-schemas.md` untouched (no new card type);
figure reference doc gets the runtime row; CHANGELOG entry in canvas-loop
noting first host integration.

**Vocabulary lock-ins:** the runtime value string `canvas-loop`; the window
shim name `__cbCanvasLoop`; frontmatter `params` as the persisted-values
field (already the schema's name).

**First implementation chunk:** Chunk 1 — no open questions inside it.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Sketch fails to compile (syntax/type) | route test to add (chunk 2) | `figureError` module channel `figure.ts:91-97` | Clear — viewer shows compile error |
| Sketch compiles but has no `update` export (not a TEA module) | viewer test to add (chunk 4) | SketchFigure module validation → error boundary | Clear — boundary message names the missing export |
| Sketch throws in `init`/`update`/`draw` at runtime | canvas-loop tests cover runtime errors; viewer relies on `ViewErrorBoundary` `FigureView.tsx:20` | yes | Clear — boundary |
| Sketch value-imports `@ianbicking/canvas-loop` | shim test (chunk 2) | window-shim external | Clear-or-working — resolves to host copy |
| `params` frontmatter has stale keys after sketch edit (param renamed) | canvas-loop declaration validation | SketchFigure applies known keys, ignores unknown | **Silent-ish** — accepted: unknown persisted keys are inert; declared defaults win. Documented in instructions. |
| Persist mutation races an agent editing the same card | todos-pattern locked RMW | `withCardLock` serialization | Clear — last write wins on the `params` key only |
| Persist loop (mount echo re-writes card → invalidate → re-render → write) | chunk-4 test | deep-equal skip before mutate | Clear by design |
| Infinite/pathological `update` loop hangs the tab | none | none | **Documented risk** — same exposure as existing p5/three figures (arbitrary code already runs in FigureView); a frame-budget watchdog is future hardening for all runtimes, not this plan |

**Critical gap:** none unresolved — the two accepted risks (stale param keys,
pathological loops) are documented above with rationale; both are shared
with or strictly no worse than the shipped figure runtimes.

## Agent-flow / user-flow edge cases

- **Wrong runtime value** (`runtime: canvasloop`) — ADDRESSED: enum in the
  schema fails the parse boundary fail-closed (`card-io.ts:128`) (#3).
- **Stale ref** (entry file deleted/renamed in attach scope) — ADDRESSED:
  existing route 404 path-guard behavior + viewer error state
  (`routes/figure.ts:55-70`).
- **Two agents touching the same card** — ADDRESSED: locked RMW confined to
  the `params` key (chunk 4); body/field edits ride existing card locking.
- **Hand-edit drift** (boxholder hand-edits `params` to out-of-range value)
  — ADDRESSED: SketchFigure clamps/validates against the declaration;
  out-of-range persisted values coerce to legal ones on next interaction.
- **Fabricated free-form value** — minimal surface: `params` values are
  machine-written; the only free-form field is the card body (unchanged).
- **Validation error UX** — ADDRESSED: compile errors return through the
  `figureError` channel and render in-view where the authoring agent (via
  browse) or boxholder sees them; parse errors read as standard card lint.
- **Partial migration / transition state** — none: purely additive enum
  value; existing figure cards unaffected.

## NOT in scope

- **A new card type or viewer** — the figure card + FigureView already are
  the one way (#8); we extend, not parallel.
- **Headless render/CLI inside boxes** (`cb figure check`, determinism
  checks on box sketches, events-file demo playback in the viewer) — the
  agent-authoring loop inside a box needs its own design (how canvas-loop's
  CLI ships to box environments); deferred to a follow-up issue filed at
  plan completion. In the monorepo dev context the loop already works.
- **Sandboxed-iframe isolation** — figure runtimes already execute
  agent-authored code in-origin; canvas-loop adds no new exposure. Iframe
  isolation is a figure-wide hardening question, tracked separately.
- **Recording mode in the viewer** (`showRecorder`) — playground-only for
  now; box UX for "record a session as an events file" is future work.
- **npm publishing of canvas-loop** — unchanged from LIBRARY-PLAN.

## Open design questions

- How the box-side agent runs the headless loop (bundle canvas-loop's CLI
  into `cb`? a box devDependency?) — deferred with the NOT-in-scope item;
  lean: a `cb figure render` subcommand wrapping the headless runner, so
  boxes don't grow node_modules. Does not block any chunk.

## Knowledge audits

New agent-facing concept: "canvas-loop is a figure runtime; sketches are TEA
modules; params persist in frontmatter." Two entries in
`src/dev/knowledge-audits.yaml` (run before plan completion, per skill):

- `figure-canvas-loop-runtime` — prompt: "You want an interactive
  deterministic canvas figure the boxholder can tweak with sliders. What
  card do you create and what does its runtime field say?" —
  `knows_directly`, correct_contains: ["figure", "canvas-loop"].
- `figure-canvas-loop-params-persist` — prompt: "Where do a canvas-loop
  figure's slider values live after the boxholder adjusts them?" —
  `knows_directly`, correct_contains: ["params", "frontmatter"].

## Implementation order

Chunks 1 → 2 → 3 → 4 → 5 as above; 1–2 are independent of 3 and could land
in either order, 4 depends on all prior, 5 last. Each chunk is a commit;
the plan ships as one unit (worktree merge is the boxholder's explicit
call, per plan discipline).

## Rollout shape

- **Tests first, per chunk:** route test (canvas-loop entry compiles; shim
  externalizes; compile error → `figureError`), viewer test (non-TEA module
  → boundary message; params round-trip with deep-equal skip), mutation
  test (locked RMW touches only `params`; rejects non-figure cards). The
  done-when: a canvas-loop figure card in the worktree test box renders
  interactively at its card page, slider changes survive reload via
  frontmatter, and `git diff` on the box shows only the `params` key
  changing.
- **Knowledge audits:** the two entries above, run (`pnpm knowledge-audit
  run --box <worktree test1 path> --filter figure-canvas-loop`) with status
  recorded in the yaml.
- **Migration:** none (additive enum).
- **Demo:** one canvas-loop figure card added to the worktree's test box
  (orbit or a param-rich starter) as the living verification artifact —
  test1 is a manual playground, so adding a card is safe; no schedules
  touched.

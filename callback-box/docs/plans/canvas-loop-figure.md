# canvas-loop figure runtime

**Status:** active — designed 2026-07-14, revised same day after firsthand
reading of the figure implementation (v1 of this plan was written from a
scout's report and got `params` semantics and the module contract wrong;
this version is grounded in the cited lines).

Add `canvas-loop` as a fourth figure-card runtime alongside p5js/three/d3: a
figure whose attach-scope entry is simultaneously a headless-runnable
canvas-loop TEA sketch (named exports) and a standard figure factory
(default export), rendered through the existing FigureMount harness. This
gives boxes deterministic, interactive, agent-authorable figures whose
authoring loop (write → headless render → read frame-tagged transcript) the
agent runs without a browser — validated in
`../../issues/exploration/2026-07-13-canvas-tight-loop-agent-programming.md`.

## Stated preferences this plan trades against

- `docs/engineering-principles.md`: #2 exhaustiveness (the runtime union
  grows a member; every dispatch must fail to compile until handled), #3
  validate at boundaries, #4 resilient AND never silent, #8 one way to do
  each thing (the deciding principle for the module-contract choice below),
  #12 the maintainer is usually an agent.
- `callback-box/CLAUDE.md`: "don't add features beyond what the task
  requires" (drives the persistence deferral); read-before-writing (this
  revision exists because v1 violated it).
- `code-style.md`: max 2 positional params (the figure contract's
  two-argument shape exists because of this), no barrels, cast rules.
- **Shipped precedent:** the figure card —
  `docs/implemented-plans/figure-card-type.md`. This plan adds a runtime to
  it and changes nothing about its shape.

## What already exists (firsthand citations)

- **Uniform entry contract** — `src/frontend/src/components/FigureMount.tsx:41-44`:
  every figure module default-exports
  `(lib: unknown, ctx: {mount, figure}) => FigureTeardown`; the runtime
  library is handed in ("**Do not import it** — it arrives as this
  argument", `src/schemas/figure.ts:79-80`). REUSED unchanged: canvas-loop
  is a new `lib`, not a new mount path.
- **Per-runtime lib loading** — `FigureMount.tsx:52-61` `loadRuntimeLib`:
  lazy `import()` per runtime, own Vite chunk, off the SSR path. EXTENDED:
  one more branch returning the canvas-loop browser-runtime namespace.
- **Runtime vocabulary** — schema enum `figure.ts:17`
  (`z.enum(["p5js","three","d3"])`), frontend union `FigureMount.tsx:15`,
  duplicate literal check `FigureView.tsx:36-38` `parseRuntime`, starter map
  `figure.ts:126` (`Record<FigureRuntimeType, string>` — exhaustive, will
  not compile without a new starter), label map `figure.ts:230`. EXTENDED
  with `"canvas-loop"` in each; exhaustiveness does the enforcement (#2).
- **`params` semantics (v1's error)** — `figure.ts:20-26,70-72`: `params`
  is an array of *declared embed parameters*; "Values are supplied by the
  embed link's query string, not by the card itself." Coercion at
  `FigureView.tsx:51-52` (`parseDeclaredParams` + `coerceFigureParams`),
  remount-on-change via `paramsKey` (`FigureView.tsx:53,123`). REUSED
  unchanged: embed query values flow to the sketch as
  `figure.params`, exactly like other runtimes.
- **`data`** — `figure.ts:34,67-69`: the card's free-form author-config
  object, passed as `figure.data` (`FigureView.tsx:102`). This — not
  `params` — would be the home of any future card-held state.
- **Compile route** — `src/webapp/routes/figure.ts:41-99`: attach-scope
  path guard, esbuild `bundleView`, compile errors returned as a
  `figureError` module export (`FigureView.tsx:76`). REUSED; see the
  import-type note below for why it needs no externals change.
- **Error handling** — `ViewErrorBoundary` + harness onError
  (`FigureView.tsx:122`, `FigureMount.tsx:98-99`), teardown-failure logging
  (`FigureMount.tsx:106-112`). REUSED unchanged.
- **canvas-loop side** — browser runtime + declaration-generated controls
  already exist (`canvas-loop/browser/runtime.ts`, `controls.ts`,
  `controls-model.ts`), consumed today by the playground and
  `<SketchFigure>` (`canvas-loop/src/react/SketchFigure.tsx`). EXTENDED: a
  `./browser` subpath packaging these as an imperative
  `mountSketch(mount, opts) => teardown` with no React dependency;
  `<SketchFigure>` becomes a wrapper over it (one implementation).

## Prior art (external)

- **esbuild erases `import type` without resolving it** — load-bearing:
  box sketches type-import `@ianbicking/canvas-loop`, which is not
  resolvable from a box directory; erasure means the compile succeeds with
  no resolution attempted. Verified by a route doctest in chunk 2 (a
  fixture sketch with the type-only import compiles; the same import as a
  value import fails with esbuild's resolve error — which is the desired
  enforcement message, see Failure modes).
- Everything else in play is an already-shipped in-repo pattern (figure
  card); the canvas-loop-side research is recorded in the exploration
  issue. No further external search — skip-with-rationale.

## Tracks / scope

Single track, four chunks:

**Chunk 1 — canvas-loop `./browser` subpath.** In `canvas-loop/`:
`src/browser/mount.ts` exporting
`mountSketch(mount: HTMLElement, opts) => () => void` — opts:
`{ module, seed?, autoplay?, showControls?, initialParams?, onParamsChange?,
onEvent? }` — an imperative wrapper over the existing browser runtime +
generated controls (shared `controls-model.ts`); `"./browser"` added to the
exports map; `<SketchFigure>` refactored to call it (behavior-preserving —
its SSR test and props contract unchanged); dependency-isolation test
extends to `./browser` (no React, no napi). The entry-file duality is a
canvas-loop docs addition (TEA.md): a sketch module may ALSO default-export
a figure factory; the headless CLI ignores the default export (verify: it
detects the TEA tier by the `update` export, `canvas-loop/src/headless/tea-load.ts`).

**Chunk 2 — callback-box schema + route test.** `figure.ts`: enum +
starter + label gain `canvas-loop`; instructions gain a terse section — the
entry is a TEA module (named exports; `import type` ONLY, spelled out with
the one-line reason: the package resolves nowhere inside a box) plus the
one-line default factory:

```ts
export default ((cl, { mount, figure }) =>
  cl.mountSketch(mount, { module: { params, init, update, draw, canvas }, initialParams: figure.params })) satisfies FigureFactory;
```

(exact shape settled in-chunk against the real types; `satisfies` clause
optional for boxes). Instructions also state: declare interactive controls
in the module's `export const params` (canvas-loop's own declaration —
sliders/checkbox/select/trigger render automatically); the card-level
`params` field remains what it always was — embed-query declarations — and
maps onto module params by name; and the agent SHOULD verify headlessly
(the canvas-loop-sketch skill) instead of "open it and screenshot it".
Route doctest: fixture canvas-loop entry compiles via
`/api/figure/module.js`; value-import variant surfaces esbuild's resolve
error through the `figureError` channel.

**Chunk 3 — frontend wiring.** `@ianbicking/canvas-loop: workspace:*` in
`src/frontend/package.json`; `FigureRuntime` union + `parseRuntime` +
`loadRuntimeLib` gain the member (the lib = lazy
`import("@ianbicking/canvas-loop/browser")` namespace, own chunk, SSR-safe
like p5's). No FigureView changes beyond what exhaustiveness forces.

**Chunk 4 — demo card + knowledge audits + docs.** A canvas-loop figure
card in the worktree's test box (param-rich starter; test1 is a manual
playground — adding a card is safe, no schedules touched); the two audit
entries below run and statused; figure reference docs + canvas-loop
CHANGELOG updated; live browser verification of the card page and an
embed.

**Vocabulary lock-ins:** runtime string `canvas-loop`; subpath
`@ianbicking/canvas-loop/browser`; `mountSketch` as the imperative browser
API name.

**First implementation chunk:** Chunk 1 — no open questions inside it.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Sketch value-imports the package (box can't resolve it) | chunk-2 route doctest | esbuild resolve error → `figureError` channel `routes/figure.ts:91-97` | Clear — error names the module; instructions pre-empt with the import-type rule |
| Entry lacks the default factory (pure TEA file dropped in) | chunk-2/3 test | existing guard `FigureView.tsx:117-119` ("no default-exported sketch") | Clear |
| Module passed to mountSketch isn't a TEA module (no `update`) | chunk-1 unit test | mountSketch validates and throws → harness onError `FigureMount.tsx:98-99` | Clear |
| Sketch throws in init/update/draw | canvas-loop runtime tests + harness onError | yes | Clear — error state replaces figure |
| Embed query param name doesn't match a module-declared param | chunk-1 test | mountSketch ignores unknown initialParams keys, logs console.warn | Clear-ish — warn, not silent (#4) |
| Teardown leak (rAF keeps running after unmount) | chunk-1 test (teardown cancels rAF) | FigureMount teardown contract `FigureMount.tsx:103-117` | Clear — and logged if teardown throws |
| Pathological update loop hangs the tab | none | none | Documented risk — identical exposure to shipped p5/three figures; a frame-budget watchdog is figure-wide future hardening |

**Critical gap:** none — the one accepted risk is pre-existing across all
figure runtimes and inherited knowingly.

## Agent-flow / user-flow edge cases

- **Wrong runtime value** — ADDRESSED: schema enum fails parse fail-closed
  (`card-io.ts` boundary) (#3).
- **Wrong contract style** (agent writes a p5-style default factory that
  ignores TEA, or a TEA file with no factory) — ADDRESSED: the two "no
  default export" / "not a TEA module" failure rows above; instructions
  show the exact dual-export shape.
- **Stale ref** (entry deleted/renamed) — ADDRESSED: existing route path
  guard + viewer error state (`routes/figure.ts:55-70`, `FigureView.tsx:64-67`).
- **Two agents touching the same card** — no new writes introduced (no
  persistence in this plan); existing card locking covers edits.
- **Hand-edit drift** (malformed `params` declaration in the module) —
  ADDRESSED: canvas-loop validates the declaration at mount and the
  headless CLI validates it at run; errors are typed and named.
- **Validation error UX** — ADDRESSED: compile errors render in-view via
  `figureError`; the value-import error message is the instructive one.
- **Partial migration / transition state** — none; additive enum value.

## NOT in scope

- **Param-value persistence into the card.** v1 of this plan got this
  wrong: `params` frontmatter is embed *declarations*, not state, and no
  figure runtime persists interaction state today. `mountSketch` exposes
  `onParamsChange` (host hook, already built), so a future decision can
  wire it — most plausibly into `data` — but that's a boxholder design
  call about what a figure *is*, not wiring. Filed as an open question
  below rather than built.
- **A new card type, viewer, or window shim** — the uniform lib-injection
  contract makes all three unnecessary (#8).
- **Headless loop inside boxes** (`cb figure render`-style subcommand) —
  needs its own design (how the runner ships to box environments);
  follow-up issue filed at plan completion. In monorepo dev the loop works
  today.
- **Recorder UI in the box viewer; sandboxed-iframe isolation; npm
  publishing** — unchanged deferrals from v1/LIBRARY-PLAN.

## Open design questions

- Should boxholder param adjustments persist per-card (via `data`), stay
  per-embed (query string, the current figure model), or stay ephemeral?
  Lean: ephemeral now; the `onParamsChange` hook keeps every option open.
  Boxholder call when a real use surfaces.
- Controls visibility default in embeds: v1 ships controls-on wherever the
  module declares params (they're the point of the runtime); revisit with
  usage.

## Knowledge audits

Two entries in `src/dev/knowledge-audits.yaml`, run before completion:

- `figure-canvas-loop-runtime` — "You want an interactive, deterministic
  canvas figure with auto-generated slider controls. What card do you
  create and what runtime do you declare?" — `knows_directly`,
  correct_contains: ["figure", "canvas-loop"].
- `figure-canvas-loop-import-rule` — "In a canvas-loop figure's entry
  source, how do you import the canvas-loop types, and why that way?" —
  `knows_directly`, correct_contains: ["import type"], watch_for: names
  the box-can't-resolve-the-package reason.

## Implementation order

Chunk 1 (canvas-loop, self-contained) → 2 (schema + route test) → 3
(frontend wiring; depends on 1 for the subpath, 2 for the enum) → 4 (demo +
audits + docs; depends on all). Each chunk a commit; ship (worktree→main
merge) only on the boxholder's explicit call.

## Rollout shape

- **Tests first:** chunk-1 mountSketch unit tests (mounts, controls
  render, teardown cancels rAF, non-TEA module throws, unknown
  initialParams warn); chunk-2 route doctest (compiles; value-import →
  clear `figureError`); chunk-3 rides typecheck exhaustiveness + existing
  FigureView tests. Done-when: the demo card renders interactively on its
  card page in the worktree box, an embed with a query param shows the
  param applied, and the value-import fixture shows the instructive error.
- **Audits:** the two entries, run with status recorded.
- **Migration:** none.

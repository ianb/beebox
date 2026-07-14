# canvas-loop: sandbox → library plan

Status: DRAFT for cross-model review, 2026-07-14. Boxholder direction: turn
the validated sandbox into a monorepo library — eslint plugin, Claude plugin
(skill + maybe rule), React display component, usable as a figure in
callback-box **without being bound to callback-box**. Treat as experimental:
the library presentation is real but the API is expected to move as agent
exercises teach us more. Design record:
`issues/exploration/2026-07-13-canvas-tight-loop-agent-programming.md`.

## Status (2026-07-14): all implementation tracks shipped

The package move + subpath split, ESLint plugin extraction, snapshot event +
CLI, gallery migration, React `<SketchFigure>` + dev demo, and the Claude
plugin all landed. Per-change detail and any deviations from this plan are in
`canvas-loop/CHANGELOG.md` (the authoritative record; each `## Status` line
below points there). Open questions at the bottom remain open — unchanged.

## Package

**Status (2026-07-14): shipped** — see `canvas-loop/CHANGELOG.md` (0.1.0).

- **Move** `sandbox/canvas-loop/` → **`canvas-loop/`** (top-level, peer of
  `agent-doctest/`), workspace package **`@ianbicking/canvas-loop`**,
  version `0.1.0`, `private: true` for now (workspace consumers only; npm
  publishing is a later decision).
- README gains an **EXPERIMENTAL** banner: API moves with evidence from
  agent exercises; changes recorded in `CHANGELOG.md` (hand-written, terse).

## Subpath layout (dependency isolation is the point)

**Status (2026-07-14): shipped** — `.`/`./headless`/`./react`/`./eslint`
exports live; isolation verified by `test/self-reference.test.ts`. Deviation:
the browser runtime sits in `browser/` and the demo in `dev-demo/` rather than
a single `src/react/`. See `canvas-loop/CHANGELOG.md`.

```
canvas-loop/
  package.json        exports: ".", "./headless", "./react", "./eslint"
  src/core/           TEA contract types, params, Msg, painter (ctx-generic),
                      prng, event-log types — ZERO runtime deps
  src/headless/       @napi-rs/canvas runner, recorder, transcript, CLI
  src/react/          <SketchFigure> — browser runtime + generated controls
                      as a React component (react as optional peer dep)
  src/eslint/         the tea/* rules as a real plugin export (no deps)
  cli.ts → bin: "canvas-loop" (run, and new: gallery check)
  claude-plugin/      Claude Code plugin dir: sketch-authoring skill (+ rule)
  examples/           worked examples (orbit-tea, fjord-tea, bounce)
  gallery/            the agent-exercise corpus (below)
  TEA.md  README.md  CHANGELOG.md
```

- `@napi-rs/canvas` becomes a dependency reachable only via `./headless`;
  `react` an optional peerDependency for `./react`; core and eslint import
  nothing. Enforced with a small `pnpm exec` check in CI/test: importing
  `@ianbicking/canvas-loop` (root) and `./eslint` in a bare node process must
  not resolve `@napi-rs/canvas` or `react`.
- Sketches switch from `../src/tea.js` relative imports to
  `import type { … } from "@ianbicking/canvas-loop"` — the eslint
  `no-restricted-imports` pattern updates accordingly (framework import =
  the package name only).

## React figure component (`./react`)

**Status (2026-07-14): shipped** — `<SketchFigure>` (uncontrolled + controlled,
`onEvent`, SSR-safe), demo at `dev/canvas-loop.html`. See `canvas-loop/CHANGELOG.md`.

- `<SketchFigure module={sketchModule} seed? autoplay? showControls?
  showRecorder? height?/>` — wraps the existing browser TEA runner + the
  declaration-generated controls (plain HTML inputs restyled minimally; no
  widget libraries). SSR-safe: no window/document access at module
  scope (callback-box renders with SSR machinery around).
- **Inputs are initializable, watchable, and persistable — optionally**
  (boxholder requirement, 2026-07-14). Uncontrolled mode:
  `initialParams` (partial record overriding declaration defaults), state
  lives inside. Controlled mode: `params` + `onParamsChange(values)` — the
  host owns values, so persistence is composition at the host (a
  callback-box card, localStorage, anything), not a component feature.
  `onEvent(entry)` optionally streams the same `{frame, type, …}` log
  entries the recorder captures — watching generalizes past params because
  every input is already a logged msg, and saving a full replayable session
  is likewise a host-side choice. Param changes injected by the host in
  controlled mode dispatch through the normal `param` msg path.
- The **figure-in-callback-box** goal is an interface constraint, not a
  deliverable: nothing in `./react` may import callback-box, and the demo
  proves embeddability outside it — a page in the monorepo `dev/` directory
  (served at `/<worktree>/dev/`) embedding two sketches via the component.
  Actual callback-box card-view integration is future work (its own issue).

## ESLint plugin (`./eslint`)

**Status (2026-07-14): shipped** — `src/eslint/index.mjs` with
`configs.recommended`; the package self-hosts it. See `canvas-loop/CHANGELOG.md`.

- `tea-lint.mjs` rules move to `src/eslint/` as TS with the standard plugin
  shape (`rules`, `configs: { recommended }` exporting the whole TEA
  discipline block — rules + no-restricted-imports + exhaustiveness
  requirements documented). RuleTester tests move with it.
- The package's own eslint.config.mjs consumes the built plugin (self-host).

## Claude plugin (`claude-plugin/`)

**Status (2026-07-14): shipped** — `claude-plugin/.claude-plugin/plugin.json`
+ `skills/canvas-loop-sketch/SKILL.md`; wired into `.claude/skills/` by copy
(`pnpm run sync:claude-skill`, source-of-truth banner in the canonical file —
the harness reads real files, so a symlinked skill dir isn't reliably
traversed). No always-on rule shipped (deferred; recorded in
`canvas-loop/CHANGELOG.md`). See `canvas-loop/CHANGELOG.md`.

- Standard Claude Code plugin layout so it can be installed anywhere; wired
  into this repo's `.claude/` so sessions here get it.
- **Skill `canvas-loop-sketch`**: when to reach for it (visual/interactive
  figure work, agent needs to SEE output), the TEA contract by reference
  (points at TEA.md — no duplication, per skill-body-not-deduped memory),
  the run→Read-transcript loop, events-as-tests, gallery conventions.
- **Rule (maybe)**: a short always-on rule is probably unearned; start
  skill-only and let exercise experience decide (record decision in
  CHANGELOG).

## Gallery: the agent-exercise corpus

**Status (2026-07-14): shipped** — six exercises migrated into the schema;
`gallery check` CLI + `pnpm run gallery:check` enforce determinism + lint. See
`canvas-loop/CHANGELOG.md`.

Purpose: exercises (agent-made examples) are how the library gets evaluated
and evolved — save them with enough history/metadata to understand
performance across time, tasks, and models.

```
canvas-loop/gallery/
  README.md                 schema + how to add an exercise
  <slug>/                   e.g. fjord-tides/
    task.md                 the exact prompt the agent received
    sketch-tea.ts           the sketch as delivered (post-audit)
    events.json
    meta.yaml               slug, title, created, model (e.g. sonnet-5),
                            driver (who orchestrated), cycles, harness-commit,
                            audit (verdict + notable gaps), self-report-summary,
                            features-exercised [params, pointer, trails, …]
    runs.jsonl              append-only re-exercise log:
                            {date, commit, model?, action: authored|rerun|ported,
                             cycles?, outcome, notes}
```

- **No PNGs/transcripts committed**: output is deterministic and
  reproducible from (sketch, events, seed, harness-commit); committing
  sources + metadata keeps the corpus reviewable and light. (Trade-off
  noted: reproducing *old* outputs requires checking out the old harness
  commit — acceptable; runs.jsonl records what was observed at the time.)
- `canvas-loop gallery check` CLI: renders every gallery sketch, asserts
  run-twice determinism, lints them, and appends nothing (read-only check;
  suitable for the package test step).
- **Migrate the five existing experiments** (orbit, particles ×2, clock,
  pelican, fjord) into the schema with their real metadata from the issue's
  experiment records; `experiments/` directory retires.

## Hardening folded in (from unanimous experiment feedback)

**Status (2026-07-14): snapshot event shipped**; contact-sheet / golden
assertions / protractor / `lineJoin` remain deferred (issue notes). See
`canvas-loop/CHANGELOG.md`.

- **Scripted snapshot event**: `{frame, type: "snapshot", label?}` in events
  files — captures without perturbing state. (Do now; gallery examples
  otherwise fossilize the no-op-param workaround.)
- Deferred, recorded as issue notes: contact-sheet mode, `assertNear`/golden
  pixelmatch assertions, protractor overlay, `lineJoin`.

## Execution order

**Status (2026-07-14): all seven steps executed** (per-track detail in
`canvas-loop/CHANGELOG.md`).

1. Package move + subpath split + import migration (biggest churn first,
   everything else lands on the new layout).
2. ESLint plugin extraction (depends on 1).
3. Snapshot event + CLI rename (small, unblocks gallery).
4. Gallery schema + migration of the five experiments (depends on 1, 3).
5. React `<SketchFigure>` + dev/ demo page (depends on 1).
6. Claude plugin skill (depends on stable paths from 1–4).
7. Issue + docs sweep: update the exploration issue, retire stale paths.

Each track is a subagent task; every track ends with package tests + lint +
root typecheck green; commits at track boundaries.

## Open questions (flagged, not blocking)

- npm publishing (name is scoped and available) — not until the API stops
  moving.
- Does the mutable tier survive library-ification? Verdict from experiments
  says TEA-only is plausible; KEEP mutable for now (bounce example, zero
  maintenance cost) and decide at the first breaking change.
- Gallery re-exercise cadence (when do we rerun old tasks against new
  models?) — manual for now; runs.jsonl is the substrate.

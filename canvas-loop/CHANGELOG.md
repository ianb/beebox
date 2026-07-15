# Changelog

`@ianbicking/canvas-loop` is EXPERIMENTAL: the API moves as agent exercises teach
us more. Every change lands here — hand-written and terse.

## Unreleased

- **Figure hardening (review fixes).**
  - `<SketchFigure>` keys the creation effect on the module's stable
    sub-references (`init`/`update`/`draw`/`params`), not the wrapper object — so
    an inline `module={{…}}` literal built from module-scope functions no longer
    resets the sketch (frame 0, reseed) on every parent re-render.
  - A throwing `update`/`draw` no longer recurs uncaught every animation frame:
    the loop is caught, stopped (pending rAF cancelled), and the error surfaced
    exactly once via a new optional `onError(e)` on `RuntimeDeps`/`attachSketch`/
    `mountSketch` (default `console.error`). `<SketchFigure>` renders a small
    inline `.cl-error` box.
  - `<SketchFigure>` no longer runs a full-log `JSON.stringify` on every input:
    the recorded-events JSON is computed only while the recorder panel is open
    (via `recorderJson`), keeping the per-event cost O(1) when it is closed.
  - Initial-param overrides are now finiteness-checked and clamped: a non-finite
    number (NaN/±Infinity) warns and falls back to the default; an out-of-range
    number is clamped into the declared `[min, max]` (with a warning).
  - Param validation has one definition (`param-validate.ts`) enforced at one
    point per path: `attachSketch` for initial overrides (so `mountSketch` and
    `<SketchFigure>` validate identically), `Runtime.setParam` for every live
    change (widget edits, controlled host dispatch, scripted events).
- **`./browser` subpath — React-free `mountSketch`.** New `browser/mount.ts`
  exports `mountSketch(mount, opts) => teardown`, an imperative wrapper over the
  browser TEA runtime + declaration-generated controls (shared
  `controls-model.ts`), with no React dependency. Opts: `module`, `seed?`,
  `autoplay?`, `panel?`, `transport?`, `initialParams?` (validated against the
  module's param declaration — unknown keys or type mismatches warn and fall
  back to the declared default), `onParamsChange?`, `onEvent?`. Control styles
  ship as an importable stylesheet (`@ianbicking/canvas-loop/browser/figure.css`)
  — no runtime `<style>` injection, so a strict host CSP can't blank them.
  `<SketchFigure>` delegates to it (one browser implementation); the
  dependency-isolation test extends to prove `./browser` pulls in neither React
  nor the native canvas backend.
- **First host integration: callback-box figure runtime.** A TEA sketch module
  may also default-export a host figure factory
  (`(cl, { mount, figure }) => cl.mountSketch(...)`); the headless CLI ignores
  the default export (TEA detection keys on the named `update`). callback-box
  adds `canvas-loop` as a fourth `figure` runtime that lazy-imports `./browser`
  and mounts the sketch through this factory. See TEA.md's dual-export section.

## 0.1.0

First release as a workspace library (was `sandbox/canvas-loop`).

- **Library-ified.** Moved `sandbox/canvas-loop/` → top-level `canvas-loop/`;
  renamed the package `canvas-loop` → `@ianbicking/canvas-loop` (private, version
  0.1.0). Added an EXPERIMENTAL banner to the README.
- **Subpath exports for dependency isolation.** `src/` is split into `core/`
  (the TEA contract types, params, `Msg`, the context-generic `Painter`, drawing
  data types, seeded PRNG, and input-event types — zero heavy deps) and
  `headless/` (the `@napi-rs/canvas` runner, both tier loops, event parsers,
  recorder, transcript, CLI). Exports:
  - `.` → `core` — importable in a bare Node process without resolving
    `@napi-rs/canvas` (verified by `test/self-reference.test.ts`).
  - `./headless` → the headless runner.
  - `./eslint` → the TEA ESLint plugin.
- **Sketches import the package name.** Examples and experiments switched from
  `../src/tea.js` / `../src/sketch.js` relative imports to
  `@ianbicking/canvas-loop`; the `tea/no-restricted-imports` discipline now
  allows exactly that specifier.
- **ESLint plugin is a real plugin.** `tea-lint.mjs` → `src/eslint/index.mjs`
  (stays `.mjs`; no build step): named rule exports plus a `configs.recommended`
  flat-config block bundling the four `tea/*` rules and the framework
  `no-restricted-imports` restriction. Type-aware
  `switch-exhaustiveness-check` stays a documented, consumer-wired part of the
  discipline (it needs TypeScript project info). The package's own
  `eslint.config.mjs` self-hosts through the `./eslint` export.
- **React figure component (`./react`).** `<SketchFigure module=… />` mounts the
  browser TEA runner (runtime + generated controls) as a React component —
  mounting + prop plumbing + lifecycle only; the runtime/view/controls stay the
  single browser implementation, imported, not forked. `react` is an **optional
  peer dependency** (`peerDependenciesMeta.optional`); the dependency-isolation
  test extends to prove importing `.` or `./eslint` resolves neither `react` nor
  the native canvas backend. Props: `seed`, `autoplay`, `showControls`,
  `showRecorder`, `height`/`scale`, plus the initializable/watchable/persistable
  surface — `initialParams` (uncontrolled), `params` + `onParamsChange`
  (controlled; host-injected changes dispatch through the normal `param` msg
  path), and `onEvent` (streams the recorder-format `{frame, type, …}` entries).
  SSR-safe: no `window`/`document`/canvas at module scope or during render — the
  runner starts in an effect and the server renders a placeholder div
  (`useSyncExternalStore`); verified with `react-dom/server` in
  `test/react-ssr.test.tsx`. Persistence is host composition (documented with a
  `localStorage` example). The declaration→control mapping is now shared
  (`browser/controls-model.ts`) between the DOM panel and the React panel rather
  than duplicated. Demo: `dev-demo/` builds the tracked, self-contained
  `dev/canvas-loop.html` (two figures) via `pnpm run build:dev-demo`.
- **Scripted snapshot event.** Events files (both tiers) accept
  `{ "frame", "type": "snapshot", "label"? }` — forces a capture of that frame
  without dispatching to a handler or perturbing state; the label flows to the
  transcript frame heading. The scriptable twin of `snapshot(label?)`.
- **Gallery corpus.** `experiments/` retired; its six sketches (orbit toy,
  particle fountain ×2 models, clock, pelican-on-a-bicycle, fjord-with-tides)
  moved into `gallery/<slug>/` with the schema from `gallery/README.md`
  (`task.md`, `sketch.ts`/`sketch-tea.ts`, `events.json`, `meta.yaml`,
  `runs.jsonl`) and their real metadata (model, cycles, harness-commit, audit,
  self-report) recovered from the design issue's experiment records. New
  `cli gallery check` (`pnpm run gallery:check`) renders every exercise twice
  into a scratch temp dir, asserts byte-identical determinism, and lints it —
  read-only, nothing written under `gallery/`.

- **Claude plugin (`claude-plugin/`).** Standard Claude Code plugin layout —
  `claude-plugin/.claude-plugin/plugin.json` (names the plugin `canvas-loop`)
  plus `skills/canvas-loop-sketch/SKILL.md`. The skill triggers on visual/
  interactive sketch work ("I need to see what this draws", build/test a figure,
  visualize, script input events, add a gallery exercise) and is reference-dense
  rather than self-contained: it points at `README.md`, `TEA.md`, and
  `gallery/README.md` by path instead of duplicating them, and states the loop
  (write → `cli run` → Read transcript + frames), events-as-tests (incl. the
  snapshot entry), the determinism levers, the gallery add/re-exercise flow, and
  the verify-by-frames / stranger-test audit norms. Wired into the repo's
  `.claude/skills/` by **copy**, not symlink (the harness reads real files, and
  the doc-graph walker's `readdirSync`/`isDirectory` scan skips symlinked dirs) —
  `pnpm run sync:claude-skill` regenerates the copy from the canonical
  `claude-plugin/` source, which carries a source-of-truth banner.
- **Docs sweep.** Root `CLAUDE.md` monorepo layout gained a `canvas-loop/` line;
  `LIBRARY-PLAN.md` tracks 1–4 marked shipped with per-section status headers
  (open questions left intact); the design issue
  (`issues/exploration/2026-07-13-canvas-tight-loop-agent-programming.md`) gained
  a "Library-ified (2026-07-14)" section stating the new home, with the older
  dated experiment logs and their `sandbox/canvas-loop/...` paths preserved as
  history.

### Decisions recorded

- **No always-on rule shipped with the Claude plugin.** The plan floated a short
  always-on rule file alongside the skill; deferred as unearned — start
  skill-only and let exercise experience decide whether a rule is warranted.
- **`core` re-exports the mutable-tier `Sketch` type only.** A mutable sketch
  names `Sketch` from the single `@ianbicking/canvas-loop` specifier its lint
  discipline allows. `Sketch` is a headless, `@napi-rs`-backed class, so `core`
  re-exports it **type-only** — fully erased at runtime, so importing `.` still
  never loads the headless module or the native backend.

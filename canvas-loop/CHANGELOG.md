# Changelog

`@ianbicking/canvas-loop` is EXPERIMENTAL: the API moves as agent exercises teach
us more. Every change lands here — hand-written and terse.

## Unreleased

- **Brushes, gestures, paper, groups** (see [BRUSHES.md](./BRUSHES.md)).
  `brush(name, overrides?)` / `noBrush()` turn every stroked shape into a
  brushed mark; presets `ink`, `marker`, `pencil`, `chalk`, `airbrush`,
  `wash`, `bristle`. `gesture({ pressure, wobble, seed })` sets pressure
  envelopes and hand wobble. `paper({ scale, contrast, seed })` sets the
  canvas's grain. `group({ opacity, blend }, body)`, `blendMode()`,
  `erase()`/`noErase()`. Width comes from `strokeWeight`. Mark randomness is
  per mark (adding a mark never changes another); `--seed` does not affect it.
  Fills stay flat. Adds the `perfect-freehand` dependency (ink outlines).
- **Curves.** `curve(points, closed?)` draws a Catmull-Rom curve through the
  points; `curvePath(points, closed?)` returns its path commands for `clip` or
  `path`. Open curves mirror their end points (no pinch on 3-point curves).
- **`ctx` follows groups.** `s.ctx` / `v.ctx` is the context drawing lands on
  now: inside a `group`, the group's layer. `clip` and `group` unwind any
  unmatched `push()` from their body, even when it throws.
- **Zoomed crops.** `run --zoom x,y,w,h[@scale]` (repeatable) writes an
  enlarged, nearest-pixel crop beside every captured frame and lists it in the
  transcript. `cli zoom <frame.png> <x,y,w,h[@scale]>...` crops an existing
  frame.
- **Sketch lint relaxed** for `src/examples/` and `src/gallery/`: `max-params`,
  default params, function and file length, `1.0` literals, plain `Error`, and
  `reverse()` are allowed there.
- **Mark seed from points only.** A mark's randomness no longer depends on its
  brush, gesture or width, so tuning those keeps the same wobble.
- **Shape helpers and texture** (round-2 asks). `tube(points, { width,
  profile })` returns a limb outline around a smooth centreline;
  `offset(points, distance)` grows or shrinks a closed outline;
  `clip([shapes…], body)` clips to a union; `ellipseGradient(x, y, w, h,
  stops)` fills an ellipse; `paperTexture(amount)` shows the paper across the
  page. A mark too faint to see adds a transcript warning. Bristles wander
  sideways so long strokes do not stripe.
- **Sharp on high-density screens.** Browser figures and the playground back
  the canvas with `size × devicePixelRatio` pixels (capped at 3) and draw in
  logical units under a base scale; the Painter takes a `pixelRatio` and sizes
  layers, sprites and the paper texture to match. Headless output (ratio 1) is
  unchanged byte for byte.
- **Hover reaches browser sketches.** The browser figure and playground sent
  `mousemove` only while a button was held, so hover cues worked headless but
  not in a browser; every move is now sent.
- **Typed number fields.** A number param with `control: "field"` shows as a
  number box in browser figures (DOM and React); only valid, in-range values
  (whole numbers for `step: 1`) are sent.
- **Erase and gradient marks under transforms.** @napi-rs/canvas 1.0.2 limits
  destination-out and source-in fills under a transform to the quadrant past
  the translation origin, so erasing a translated or rotated shape cleared only
  part of it. Erasing under a transform now draws via a layer composited under
  identity, and gradient-coloured marks paint the gradient on a second layer.
  The Painter's primitives move to `engine.ts` over a `PainterCore` (`core.ts`).
- **Checkpoints.** `CANVAS_LOOP_CHECKPOINTS=<dir>` saves every `run` (sources,
  events, frames, transcript, `--note`); `cli checkpoints <dir>` builds a page
  that steps through them.
- **Development aids** (busy-town round asks). `run --outline` outlines placed
  sprites (with keys), clip regions and `debugBox(label, x, y, w, h)` boxes;
  `run --timing` adds per-frame draw/update times to the transcript. Faint-mark
  warnings name the sprite or cache they came from; `gesture({ faint: true })`
  silences one. `textFont`/`textStyle`; `cursor(kind)` for browser figures;
  `u.record(keys, value)`; `DeepReadonly` keeps tuples.
- **TEA sketches may import sibling `./<name>-tea.js` helpers** (the TEA lint
  applies to them by name). The animation round's sketches were forced into
  single 1,200–1,500-line files.
- **Sprites.** `sprite({ key, width, height }, body)` paints once in local
  coordinates; `image(sprite, x, y, opacity?)` places it under the current
  transform, so painted things can move, rock and flip cheaply.
- **Faster frames.** Brush marks reuse one offscreen canvas and groups reuse
  pooled layers, instead of a new canvas per mark or group; the faint-mark
  pixel read-back runs headless only. Headless output is byte-identical; the
  animated brush pages went from 39 to 58 fps together in Chrome.
- **`cache(key, body)`** draws a static part once and pastes it on later
  frames, so painted scenes can animate.
- **Review fixes.** `clip([shapes…])` now erases and blends like a single
  clip; `pop()` cannot escape a single clip; tube ends are round; brushed
  `arc` follows Canvas2D's sweep; a `path` starting with `line` has no segment
  from the origin; thick bristle marks are not cropped and very short ones
  paint; short tubes work; duplicate pressure keyframes hold the last value on
  both sides; `cli diff` reads erased pixels as lighter and clears old crops.
- **`cli diff`** (experimental): changed-pixel highlight (darker/lighter),
  per-region before/after crops, side by side, and stats. TEA sketches there no longer need the
  `max-params` disable comment.
- **`SketchUsageError` moved to core** (`src/core/errors.ts`); the headless
  errors module re-exports it.

- **Claude plugin removed.** `claude-plugin/` and the `sync:claude-skill`
  script are gone, and the generated `.claude/skills/canvas-loop-sketch/` copy
  with them. The authoring loop, gallery flow, and audit norms now live in
  `canvas-loop/AGENTS.md`, which Claude Code loads when working here.
- **Engagement verdicts — scripted inputs report whether anything engaged.**
  Every scripted *interaction* event (mouse/key/trigger — not `tick`, `param`,
  or `snapshot`) now carries a verdict on its transcript line:
  `**[frame 30]** mousedown (297,288) → select-planet`. Three states:
  a **name** (TEA `u.handled(name)` / mutable `s.handled(name)`, callable
  multiple times, names join with `, `); **Δmodel** (TEA only — `update`
  returned a new model reference, the free reference-equality signal); or
  **(unhandled)** (nothing engaged — e.g. a click that missed a moving target,
  previously invisible in the transcript). The mutable tier's middle verdict is
  a bare `handled` (a handler export fired but didn't name). `param` keeps its
  own `param: name → value` line (definitionally applied, no separate verdict).
  New capability: `handled(name)` on `Util` (TEA) and `Sketch` (mutable); new
  `input` transcript entry kind. The browser runtime streams the same signal on
  `onEvent` entries as structured `handled?: readonly string[]` / `changed?:
  boolean` fields (the on-disk events log stays the clean `TeaScriptEvent`
  shape); the new `EmittedEvent` type is exported from `./browser`.
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
- **`./browser` subpath — React-free `mountSketch`.** New `browser/mount.ts` (moved to `canvas-loop/src/browser/mount.ts`)
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
- **First host integration: beebox figure runtime.** A TEA sketch module
  may also default-export a host figure factory
  (`(cl, { mount, figure }) => cl.mountSketch(...)`); the headless CLI ignores
  the default export (TEA detection keys on the named `update`). beebox
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
    `@napi-rs/canvas` (verified by `test/self-reference.test.ts` (moved to `canvas-loop/test/exports/core.test.ts`)).
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
  (`browser/controls-model.ts` (moved to `canvas-loop/src/browser/controls-model.ts`)) between the DOM panel and the React panel rather
  than duplicated. Demo: `dev-demo/` builds the tracked, self-contained
  `dev/canvas-loop.html` (two figures) via `pnpm run build:dev-demo`.
- **Scripted snapshot event.** Events files (both tiers) accept
  `{ "frame", "type": "snapshot", "label"? }` — forces a capture of that frame
  without dispatching to a handler or perturbing state; the label flows to the
  transcript frame heading. The scriptable twin of `snapshot(label?)`.
- **Gallery corpus.** `experiments/` retired; its six sketches (orbit toy,
  particle fountain ×2 models, clock, pelican-on-a-bicycle, fjord-with-tides)
  moved into `gallery/<slug>/` with the schema from `gallery/README.md` (moved to `canvas-loop/src/gallery/README.md`)
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
  `gallery/README.md` (moved to `canvas-loop/src/gallery/README.md`) by path instead of duplicating them, and states the loop
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
  (`issues/closed/exploration/2026-07-13-canvas-tight-loop-agent-programming.md`) gained
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

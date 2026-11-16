# Stage 0: how beebox hosts canvas-loop figures

Part of `beebox/docs/implemented-plans/canvas-loop-scene.md`, Stage 0. Paths below are in
`beebox/` unless they start with `canvas-loop/`. Checked 2026-11-14.

## Browser

- **The sketch module is compiled on the server and imported.**
  `src/frontend/src/components/FigureView/view.tsx:80-82` imports
  `${apiBase}/figure/module.js?path=…`; `src/webapp/routes/figure.ts:1-17`
  compiles the `.ts` attachment with esbuild (`bundleView`). Externals are
  `["p5","three","d3"]` (`figure.ts:32`), so a sketch may only `import type`
  from canvas-loop. A compile failure becomes `export const figureError`.
- **canvas-loop is injected.** `FigureMount.tsx:71-84` lazy-imports
  `@ianbicking/canvas-loop/browser` and its `figure.css`, wrapped by
  `src/frontend/src/lib/figure-canvas-loop.ts:62-87`. The sketch's default
  export is `(lib, { mount, figure }) => teardown`; it calls
  `lib.mountSketch(mount, { module, initialParams: figure.params })`.
- **Activity reporting** wraps `onEvent`: it reports `set <name> = <value>` or
  `pressed <names>`, never coordinates or model state
  (`figure-canvas-loop.ts:23-39,76-81`).
- **Sizing:** CSS forces canvases to the card width (`FigureMount.tsx:185`); a
  figure scales down, never up (`src/schemas/figure.ts`, instructions).
- **Teardown** runs in a try/catch and empties the mount
  (`FigureMount.tsx:156-170`); it must survive StrictMode's double call.
- **Errors** show as an error notice on the card (`view.tsx:166-173`).
- **Visibility:** canvas-loop suspends offscreen figures itself, with an
  `IntersectionObserver` and a 200 px margin
  (`canvas-loop/src/browser/runtime/engine.ts:387-392`, wired in
  `canvas-loop/src/browser/mount.ts:106`). Suspension stops the loop; it does
  not release resources.
- **No limit on figures per page.** All figures share the page's main thread;
  there is no iframe or worker (`docs/implemented-plans/figure-card-type.md:336`).

## Headless

- The box agent runs `bbx figure run [cards…]` (`src/cli/commands/figure/command.ts:35-44`).
  It compiles the card for Node, then runs `bin/bbx figure run-one` in a child
  process with a 60-second timeout (`run.ts:128,161-166`).
- `run-one.ts:50-78` imports the module, takes its named exports
  (`toTeaModule`), and calls canvas-loop's `teaRun` (seed 42, 60 fps, 120
  frames by default). Output: `_tmp/figure-run/<card>/out/` with
  `transcript.md` and PNGs. Warnings in the transcript are returned to the
  agent (`run.ts:150-153`).

## What a box agent is told

- The figure schema's instructions (`src/schemas/figure.ts`, from line 41):
  named exports `params`, `init`, `update`, `draw`, optional `canvas`; the
  default export calling `mountSketch`; `import type` only; purity rules (no
  `Math.random`, no `Date`, no module-level `let`); `u.handled`; `activity`.
- Generated box docs copy canvas-loop's `TEA.md` and `BRUSHES.md`
  (`src/core/docs-gen/package-docs/canvas-loop-doc.ts:12-58`).
- Starters: `src/templates/builtins/starters.ts:154-215`.

## Content security policy

- Production `script-src 'self'`; development adds `'unsafe-inline'
  'unsafe-eval'` (`src/lib/csp.ts:53-64`). `worker-src 'self'`.
- The policy is report-only today; only `frame-ancestors` is enforced
  (`src/webapp/document-security-headers.ts:31`).
- No `'wasm-unsafe-eval'` anywhere. `docs/content-security-policy.md:58-62`:
  features that need eval or WebAssembly should be iframe-isolated, "not to
  loosen the app-wide policy". So **CanvasKit (WebAssembly) would need a
  policy decision** before the policy is enforced.
- WebGL and WebGPU contexts, and shader source (GLSL, WGSL), are not governed
  by the policy.

## Other runtimes on the same page

- three, p5 and d3 load as separate lazy chunks. The three starter creates a
  `WebGLRenderer` and disposes it on teardown (`starters.ts:67,104-106`).
- Nothing in beebox limits WebGL contexts per page. A page with many GPU
  figures (three and a GPU canvas-loop) shares the browser's context limit.

## What this means for the redesign

1. The browser entry point stays `mountSketch(mount, { module, … })` and the
   headless entry stays `teaRun` with named exports. A scene renderer fits
   behind both without changing the card's contract.
2. Existing figures live only in courseware; the box agent regenerates them.
   Subplan (f) updates the schema instructions, generated docs and starters,
   and makes an old sketch fail with a clear card error.
3. A GPU renderer needs a resource lifecycle (release offscreen, restore on
   waking, handle lost contexts) because figures are many, unbounded and
   share the main thread.
4. A WebAssembly backend (CanvasKit) conflicts with the stated policy
   direction; a GL or WebGPU renderer written in TypeScript does not.

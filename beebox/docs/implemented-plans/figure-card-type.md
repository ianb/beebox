---
title: "Figure card type"
status: implemented
workstream: unknown
issues: []
---
# Figure card type

> **Status: implemented (2026-06).** This is the frozen design record; the
> feature shipped as described. The `figure` schema lives in
> `src/schemas/figure.ts`, the compile route in `src/webapp/routes/figure.ts`,
> the renderer + mount harness in `src/frontend/src/components/FigureView.tsx`
> and `FigureMount.tsx`, inline `![](view:…)` embedding in
> `FigureEmbed.tsx`, and the scaffold template in `src/schemas/figure.ts` +
> `templates-builtins.ts`. One deviation from the draft below: the authoring
> contract is `(lib, { mount, figure }) => teardown` (mount + context in one
> object arg) rather than three positional params, to satisfy the max-params
> rule. A **fourth runtime, `canvas-loop`**, was added 2026-07 (deterministic
> TEA sketches with auto-generated controls + a headless verify loop) — see
> `docs/implemented-plans/canvas-loop-figure.md`; the `p5js|three|d3` enumerations below
> predate it.

A new `figure` card type for small, embeddable, parameterized interactives —
p5.js sketches, three.js scenes, D3/SVG graphics — the kind of thing you embed in
a document *to demonstrate one thing*. A figure card's body is a prose
description of what it demonstrates; its runnable source (`.ts`) lives in the
card's attachment scope, pointed to by a required `entry` field. The frontend
resolves and compiles that source with the **existing server-side esbuild view
compiler**, then mounts it through a small per-runtime harness (p5 instance mode
into a `<div>`, etc.). Figures embed in Markdown via the existing `view:` link
path and are parameterized from the embed site's query string. **No security
sandbox** — see the threat-model note below.

> **History.** This supersedes the deleted `visualization-card-type.md`, which
> proposed a client-transpile + CDN + sandboxed-iframe tower. Two codex reviews
> drove the current shape: (1) the existing `views/` system already provides
> server-esbuild compilation, params, file helpers, live-reload, and embedding,
> so the tower was rebuilding solved problems; (2) the security sandbox solved a
> non-problem in this box's threat model (below). The name changed from
> `visualization` (implies data-viz) to `figure` (an embedded graphic that
> illustrates a point).
>
> **Decisions locked with the boxholder:** native-sketch authoring (not React
> views); code in the `entry` `.ts` attachment (not inline body, not a `views/`
> file); no sandbox; **p5.js ships first**, three/d3 follow once the p5 lifecycle
> is proven; params thread through the **chat-embed path only** in v1.

## Threat model (why no sandbox)

Figure code runs in the app's own origin with the boxholder's session — it can
read/write/commit box files and call secret-injecting adapters. A codex review
flagged this as a new attack surface ("a card can arrive from a connector"). It
is **not**, in this box's model:

- This is a **single-boxholder** system. The boxholder, their agent, and the
  connectors *they* configured are all inside the trust boundary — not
  adversaries.
- Connectors already write arbitrary content into the box with no security
  limitation, **including** the ability to drop a `views/*.tsx` that the existing
  view system executes un-sandboxed today. So "executable code from a
  box-internal source" is a capability the system already has and accepts;
  figures make it card-shaped, not categorically new.

The **one** case this reasoning does not cover is importing a box authored by
*another, untrusted person*. There is no such sharing model today; if one is ever
added, figures (and views) would need gating then — captured under NOT in scope.

## Stated preferences this plan trades against

- **`beebox/CLAUDE.md:99`** — *"Read before writing. Don't guess file
  formats, XML structures, or API shapes. Read the schema, read the existing
  code…"* The first draft violated this by missing `views/`; this rewrite is
  grounded in verified citations.
- **`beebox/CLAUDE.md:45`** — *"Schemas can include `instructions` — prose
  embedded in the schema that's injected into agent context…"* Per-runtime
  authoring rules ride this.
- **`beebox/CLAUDE.md:108`** — *"Keep source and docs generic — never
  hardcode personal names."*
- **`beebox/CLAUDE.md` (Cards / "don't add features beyond what the task
  requires")** — drives the NOT-in-scope cuts.
- **`beebox/code-style.md`** — *"No default parameters"*, *"Max 2 positional
  parameters"*, *"NEVER use `any`"*, *"`as` … like Rust's `unsafe`"*. The
  compiled-module import is the one untyped boundary; centralize the cast in a
  single typed helper.
- **`beebox/frontend.md`** — UI primitives + `className`-only-for-outer-
  layout (`restrict-component-classes`).
- **`docs/testing.md`** — tests as a design tool, on substantial codepaths.
- **Densest precedents:** the `views/` system (`src/webapp/views/compiler.ts`,
  `src/frontend/src/components/ViewRenderer.tsx`, `src/frontend/src/hooks/useViewFileHelpers.ts`)
  and existing card renderers (`src/frontend/src/renderers/recipe.tsx`,
  `webpage.tsx` — `registerCardRenderer` at priority 100).

## What already exists

- **The esbuild view compiler — reused as the figure compiler.**
  `src/webapp/views/compiler.ts:116`: `compileView(viewPath, opts?)` `fs.stat`s
  and reads **an arbitrary absolute path** (verified: no `views/` restriction),
  esbuilds it (`bundle:true, format:"esm", target:"es2020", jsx:"automatic"`),
  caches by `target:path`+mtime. A codex probe confirmed a zero-import default
  export compiles to sane ESM. **Reuse** to compile a figure's `entry`.
- **esbuild is a real runtime dependency** — `beebox/package.json:88`
  (dependencies, not dev); imported at `compiler.ts:9`.
- **Compile/serve route — a new sibling, not a reuse.** `routes/views.ts:28`
  serves `GET /api/views/:slug/module.js` but hardcodes
  `path.join(boxRoot, "views", slug + ".tsx")` (`views.ts:32`) and on error
  returns `buildErrorModule` — **which exports a React component**
  (`compiler.ts:194`), incompatible with the figure sketch contract. Figures need
  their own route + their own error shape (Track 2).
- **Frontend dynamic-import + React-shim mount pattern** — `ViewRenderer.tsx`
  sets `window.__cbReact` and dynamic-`import()`s the compiled module URL with a
  cache-bust query. **Reuse the import pattern**; figures do *not* reuse
  `ViewRenderer` itself (it's wired to the `views/<slug>` routes and the
  one-view-per-type binding).
- **Card-type → renderer binding (the mechanism figures use).**
  `src/frontend/src/renderers/index.ts:56` `registerCardRenderer(type, renderer)`,
  dispatched by `FileView`. **Reuse** — `figure` registers a built-in renderer at
  priority 100 like recipe/webpage. Note: a box could still ship a local view with
  `rendersCardTypes:["figure"]` that `FileView.tsx:288`–`302` prepends *ahead* of
  the built-in (priority 100, bound first) — an acceptable, deliberate override
  path, not a conflict.
- **The `rendersCardTypes` view binding — deliberately NOT used.**
  `src/frontend/src/lib/view-bindings.ts:10`–`11`,`:37`–`40`: one view per type,
  first slug wins, scanning only `views/`; bound views are mounted with
  **`params={{ path }}`** (`FileView.tsx:294`–`301`) — query params dropped. Wrong
  fit for per-card code + embed params.
- **Attach scope + resolution.** `src/schemas/memo.ts:67` (attach scope);
  `src/frontend/src/lib/view-url.ts:85` `resolveRelativePath(basePath, relative)`
  resolves an `attach/`-prefixed ref against the **base card path** (`:88`–`95`).
  **Reuse** — the figure renderer (which knows the card path) resolves `entry`
  here *before* calling the compile route (the route can't resolve `attach/`
  alone; it has no card path).
- **`view:` embedding + dropped params.** `markdown-rendering.tsx:120` renders a
  `view:` link as inline `<FileView mode="chat" …>` (`:137`–`148`) and **drops
  `target.params`**, though `view-url.ts:51`–`54` parses them. Threading them to
  the figure renderer on *this* path is small (Track 4). Params are *also* dropped
  on other surfaces (`pages/ViewPage.tsx:30`–`58`, `BrowsePage.tsx:77`–`88`) and
  companion tabs key only by `target.path` (`InteractiveChat-hooks.ts:30`–`35`) —
  so full-surface param threading is a larger ripple, deferred (NOT in scope).
- **File helpers.** `src/frontend/src/hooks/useViewFileHelpers.ts:72`–`85` builds
  `readFile`/`fileUrl`/`writeFile`/`adapterFetch` against `/api/files…`. **Reuse**
  as the figure's `figure.file` bundle (data loading).
- **Live-reload event bus** — editing a watched file emits `file-change` the
  frontend subscribes to. **Reuse** — subscribe to the `entry` attachment path so
  editing the sketch hot-reloads the figure.
- **Path-traversal guard — use the strong one.** The read route
  `api-files.ts:99`–`105` checks `resolved === root || startsWith(root + path.sep)`;
  `api-files-write.ts:47`–`50` uses a weaker bare-prefix check. The figure compile
  route (a code server) **reuses the strong check**.
- **Lenient schema strips unknown frontmatter keys** — `src/cards/schema.ts:206`.
  So author config the sketch reads must live under a declared open `data` field.

## Prior art (external)

- **p5.js instance mode** (`new p5(closure, containerEl)`) scopes a sketch to a
  DOM node without global pollution — the clean mount boundary, no iframe needed.
  [p5 instance-mode reference](https://p5js.org/reference/p5/p5/).
- **esbuild single-file → ESM** is what the view compiler already does; no new
  dependency. [esbuild API](https://esbuild.github.io/api/).
- **Vite code-splits dynamic `import()`** so a harness can lazy-load p5/three/d3
  as separate chunks loaded only when that runtime first renders — no CDN, works
  offline. [Vite dynamic import](https://vite.dev/guide/features.html#dynamic-import).
- **p5/three/d3 teardown** is real per-runtime work: p5 `instance.remove()`;
  three `cancelAnimationFrame` + `renderer.dispose()`/geometry/material disposal;
  d3 detach listeners + clear the SVG. The harness contract requires returning a
  teardown (below). [three.js disposal guide](https://threejs.org/docs/#manual/en/introduction/How-to-dispose-of-objects).
- **No prior art found** for "beebox figure card"; new surface.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track 1 — `figure` schema + authoring contract

```ts
export const FigureSchema = cardSchema("figure", {
  fields: {
    runtime: z.enum(["p5js", "three", "d3"]),
    entry: z.string(),                  // required, e.g. "attach/sketch.ts"
    data: z.record(z.unknown()).optional(),
    params: z.array(z.object({
      name: z.string(),
      type: z.enum(["string", "number", "boolean"]),
      description: z.string().optional(),
      default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    })).optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    body: body(z.string()),             // markdown: what this figure demonstrates
  },
  instructions: `…per-runtime authoring rules (Track 6)…`,
});
```

**Authoring contract (committed).** The author writes runtime-native code. The
`entry` module **default-exports `(lib, { mount, figure }) => teardown`** — it
receives the runtime library and, in a second object argument, the mount element
and the `figure` context, and **returns a teardown function** (or `void`) that
the harness runs on unmount/param-change. (Mount + context share one object arg
because the codebase caps positional params at two.) The sketch **does not
import the library** (it arrives as `lib`); the compile step externalizes
`p5`/`three`/`d3` as a backstop (Track 2).

```ts
// attach/sketch.ts  (p5)
export default function (p5, { mount, figure }) {
  const instance = new p5((p) => {
    p.setup = () => p.createCanvas(figure.params.size ?? 300, 300);
    p.draw  = () => { /* reads figure.params / figure.data */ };
  }, mount);
  return () => instance.remove();        // teardown is REQUIRED for p5/three/d3
}
```

`figure` = `{ params, data, meta, file }` — `params` is the coerced embed query
string, `data` the card's `data` field, `meta` the validated frontmatter, `file`
the reused file-helper bundle.

**Vocabulary lock-ins.** Type **`figure`**; runtime field **`runtime`** =
**`p5js`|`three`|`d3`**; required source **`entry`**; open config **`data`**;
contract field **`params`**; injected context **`figure`** with **`.params`/
`.data`/`.meta`/`.file`**; entry **default-exports `(lib, { mount, figure }) =>
teardown`**.

**First chunk.** `src/schemas/figure.ts` + register in `registry.ts`;
pure-function doctest: valid parses, missing `entry` rejects, bad `runtime`
rejects.

### Track 2 — Figure compile route (by `cardPath`+`entry`)

**Direction.** `GET /api/figure/module.js?path=<box-relative resolved entry>`:
1. **Strong path guard** — reuse `api-files.ts:99`–`105`'s
   `resolved===root||startsWith(root+sep)`; require the path resolve inside an
   `*.attach/` scope and end in `.ts`/`.tsx`.
2. `compileView(absPath)` with **`p5`/`three`/`d3` marked `external`** (backstop
   so a stray `import` doesn't bundle a duplicate lib or fail the build).
3. **On compile error, return a figure-shaped error module**, NOT the React
   `buildErrorModule`: a module exporting `export const figureError = "<message>"`.
   The harness checks for `figureError` before invoking `default` (Track 3). The
   compiler's mtime cache (`compiler.ts:128`) gives recompile-on-edit free.

The **renderer** resolves `attach/sketch.ts` against the card path via
`resolveRelativePath(cardPath, entry)` and passes the *resolved* box path to this
route — the route never sees `attach/` unresolved.

**First chunk.** Route + route doctest: a fixture `.ts` → JS; a syntax-error
fixture → a module exporting `figureError`; a missing path → 404; a traversal
attempt → 400.

### Track 3 — `figure` renderer + per-runtime harnesses

**Direction.**
- `src/frontend/src/renderers/figure.tsx`: `registerCardRenderer("figure", {…,
  priority:100})`.
- Renderer reads `entry` from `data.frontmatter`, resolves it against
  `data.path`, dynamic-`import()`s
  `/api/figure/module.js?path=<resolved>&v=<mtime>`, checks `mod.figureError`
  (→ error state), else hands `mod.default` to the runtime harness.
- **Error handling is the renderer's job, not a React boundary.** Codex confirmed
  `ViewErrorBoundary` only catches React render errors; a native sketch mounts in
  an async effect/draw loop. The harness wraps the lib `import()`, the
  `default(lib, { mount, figure })` call, and (where feasible) the first frame in
  `try/catch` and surfaces failures through renderer state. A class boundary wraps
  the whole thing as a backstop only.
- Per-runtime harness (app code): lazy-`import()` the lib (code-split chunk),
  create a mount `<div>`, call `default(lib, { mount, figure })`, store the returned
  teardown, and run it on unmount/param-change. **Teardown is required**: p5
  `.remove()`, three `cancelAnimationFrame`+`dispose()`, d3 listener/SVG cleanup.
  React StrictMode double-invokes effects in dev — the harness must be
  mount→teardown→remount safe (idempotent teardown).
- Subscribe to the `entry` file-change event to hot-reload.

**First chunk (p5 only).** schema → compile route → p5 harness (instance-mount,
teardown, error state) on a card page. three/d3 are later chunks.

### Track 4 — Embed params (chat path) + minimal chrome

**Direction.**
- Add optional **`params?: Record<string,string>`** and **`mode`** to
  `RendererProps` (`renderers/index.ts:26`), both default-absent; `FileView`
  forwards them to the active renderer; `markdown-rendering.tsx:138` passes
  `target.params` into `FileView`. **v1 scope: the chat-embed path only** — codex
  verified the other surfaces (`ViewPage`, `BrowsePage`, companion-tab keying)
  each drop params and would need their own changes; that full-surface threading
  is deferred (NOT in scope).
- The figure renderer coerces each declared param to its `type`, fills declared
  `default`s, exposes the result as `figure.params`.
- **Minimal chrome:** with `mode` available, the renderer renders frameless
  (canvas + optional caption) in chat and shows the description + a "view source"
  toggle on the page. The chat wrapper border (`FileView.tsx:331`) stays; the
  figure just fills it without a frontmatter table.

**First chunk.** `RendererProps` gains `params`+`mode`; `FileView` +
`markdown-rendering` forward them; param-coercion helper + doctest
(`string→number/boolean`, defaults, missing→`undefined`); `bin/browse` smoke of
`[x](view:Fig.figure.card?size=500)`.

### Track 5 — Bundled runtime libraries

Add `p5` (v1), then `three`/`d3`, as app deps, lazy-imported per runtime so Vite
emits a separate chunk loaded only when that runtime first renders. Pin versions.
(p5 piece folds into Track 3's p5 chunk; called out so the dep/bundle-size choice
is explicit.)

### Track 6 — Instructions, templates, docs, knowledge audits

`instructions` documents: body = description; code = `entry` attachment; the
`(lib, { mount, figure }) => teardown` contract (with the per-runtime teardown each
runtime needs); what `figure.params/data/meta/file` carry; the runtimes; the
embed syntax with query params. One starter template per runtime (card +
`attach/sketch.ts`). Auto-published `docs/generated/card-figure.md`. Knowledge
audits (below).

**First chunk.** `instructions` + a p5js template + one audit; run it.

## Subplans

None. Full-surface param threading and a future cross-person box-sharing gate are
NOT-in-scope deferrals, not subplans.

## Failure modes

> **Critical gap:** none unresolved. Compile errors surface via the
> `figureError` module; mount/runtime errors via renderer-state try/catch. If
> Track 3 ships without the renderer catching the async mount path, "sketch
> throws" becomes a silent blank box — so that try/catch is part of the p5 chunk,
> not later.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `entry` `.ts` has a syntax/type error | Yes (Track 2 doctest) | route returns `export const figureError`; harness shows it | Clear |
| Sketch throws at import/mount/first-frame | Planned (browse smoke) | harness try/catch → renderer error state | Clear (only if try/catch wraps the async path) |
| Sketch forgets to return teardown | Planned | harness treats missing teardown as no-op + dev-warns; leak risk on remount | **Partly silent** — documented; mitigated by template + instructions |
| `entry` points to a missing/moved file | Yes (route 404 doctest) | route 404 → "source not found at `<path>`" | Clear |
| `entry` resolves outside the box / not an attach `.ts` | Yes (guard doctest) | strong path guard → 400 | Clear |
| Sketch `import p5` despite the contract | Yes (compile doctest) | esbuild `external` backstop → bare import fails loudly (no silent dup) | Clear |
| Sketch infinite-loops / pegs CPU | No | runs on the page main thread (no iframe/worker) | **Silent** — documented; authoring-time; v1 accepts |
| Lib chunk fails to load (offline of a not-yet-cached chunk) | No | harness awaits the `import()` in try/catch → error state | Clear |
| Embed param wrong type (`?size=abc`) | Yes (coercion doctest) | coercion → declared `default` / `NaN`; documented | Clear |
| `params` declared, embed omits it | Yes (coercion doctest) | `figure.params.x === undefined`; sketch fallback | Clear |
| Unknown `runtime` | Yes (schema doctest) | Zod enum rejects | Clear |
| StrictMode double-mount leaks a p5 instance | Planned (browse) | idempotent teardown run between mounts | Clear |

## Agent-flow / user-flow edge cases

- **Wrong field / runtime** — **ADDRESSED.** `runtime` Zod enum.
- **Stale ref** — **ADDRESSED (inherited).** FileView missing-file path.
- **Two agents on one card** — **ADDRESSED (low risk).** `.card` and `attach/*.ts`
  are separate files.
- **Hand-edit drift** — **ADDRESSED.** Frontmatter Zod-validated; `.ts` errors
  surface via the compile path.
- **Fabricated free-form value** — **ADDRESSED by design.** The running sketch
  contradicts a false description; honesty is the low-effort path.
- **Validation error UX** — **ADDRESSED.** Schema via `bbx validate --hook`;
  compile/runtime via the figure's `figureError`/error-state in place.
- **Partial migration / transition state** — **ADDRESSED (none).** Greenfield;
  additive registration.

## NOT in scope

- **Security sandboxing / gating.** Trusted single-boxholder model (see Threat
  model). Revisit only if cross-person box sharing is ever added.
- **Full-surface param threading.** v1 threads params on the chat-embed path
  only; `ViewPage`/`BrowsePage`/companion-tab keying each drop params and are a
  separate change.
- **Killing runaway sketches** (Worker/timeout). v1 accepts a bad loop can hang
  the tab.
- **A "data dashboard" figure mode.** That's what `views/` is for; a figure is one
  embedded interactive.
- **Inline code in the body; multi-file sketches; npm imports in sketches; an
  in-app code editor; SSR/static export; a raw-HTML runtime; frameworks beyond
  p5/three/d3** (the `runtime` enum is the extension point).

## Open design questions

- **`figure.meta` exposure** — lean: full validated frontmatter (author's own
  card). Minor.
- **Caption source in embed mode** — lean: `title` if present, else nothing.
- **"Source" toggle** in the figure renderer (show the `.ts`) — lean: yes, cheap;
  the built-in Source renderer exists at lower priority.
- **Enforcing "no value imports" beyond the esbuild `external` backstop** — lean:
  backstop is enough for v1; a compile-time warn is a possible follow-up.

(No open questions remain inside any first chunk.)

## Knowledge audits

Three agent-facing concepts → three `knows_directly` audits in
`src/dev/knowledge-audits.yaml`:

- `figure-card-where-code-lives` — *"Authoring a figure card: where does the code
  go and what does it export?"* → `attach/` `.ts` via `entry`, default-exports
  `(lib, { mount, figure }) => teardown`. `correct_contains:["attach","entry"]`.
- `figure-card-runtimes` — *"What can a figure card run?"* → p5js/three/d3 via
  `runtime`.
- `figure-card-embed-params` — *"How do you embed a figure and pass a parameter?"*
  → a `view:` link with a query string; the sketch reads `figure.params`.

Audits land **run**:
`pnpm knowledge-audit run --box <absolute test-box path> --filter figure-card`
(`--box` is a path; use an absolute path, never `--box test1`). Record the status
comment before the plan completes.

## Implementation order

1. **Track 1** — schema + registry + parse doctest.
2. **Track 2** — `/api/figure/module.js` route (strong guard, `external` libs,
   `figureError` module) + route doctest.
3. **Track 5 (p5 dep)** + **Track 3a** — p5 renderer end-to-end: resolve `entry`,
   compile, dynamic import, lazy p5, instance-mount, teardown, error-state
   try/catch. Card-page mode.
4. **Track 4** — `RendererProps` `params`+`mode`; `FileView`+`markdown-rendering`
   forward on the chat path; param coercion + minimal chrome; browse smoke.
5. **Track 3b/c** — three + d3 harnesses (after p5 lifecycle proven).
6. **Track 6** — `instructions`, templates, audits; run the audits.

All chunks commit on this worktree branch; the plan ships as one unit.

## Rollout shape

- **Tests** (per `docs/testing.md`):
  - Schema parse/validate (valid; missing `entry`; bad `runtime`; bad `params`) —
    Track 1 doctest.
  - Compile route (TS→JS; syntax→`figureError` module; missing→404; traversal→400)
    — Track 2 route doctest.
  - `entry` resolution + param coercion — pure-function doctests on the extracted
    helpers (keeps the renderer thin).
  - p5 figure mounts/paints; parameterized embed paints at the supplied param;
    teardown runs on unmount — `bin/browse` smoke (Tracks 3–4).
  - The Failure-modes "Test exists?" column is the checklist.
- **Knowledge audits** — the three `figure-card-*` entries land **and run** with
  the plan.
- **Migration** — none. Greenfield: `registerCardRenderer` + `cardSchemas[]` entry
  + one new route + `RendererProps` additive fields + p5 (then three/d3) deps.
</content>

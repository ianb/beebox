---
title: "Plan: testing agent-authored views"
status: implemented
workstream: unknown
issues: []
---
# Plan: testing agent-authored views

Box agents can author custom `.tsx` views in a box's `views/` directory, but
today there is no way to *test* one outside a browser. A view is only ever
compiled and run when the frontend dynamically imports it; the only feedback an
authoring agent gets is "visit it and see" or "ask the human." This plan adds
two feedback paths that run in Node: a `bbx view test <slug>` command that
compiles the view, loads the **real** cards it would receive, renders it once
with `renderToString`, and prints the output or the source-mapped failure; and a
cheap esbuild-compile check wired into the existing edit-time validate hook so
syntax/JSX/import errors surface the moment a view `.tsx` is written.

## Stated preferences this plan trades against

- `beebox/CLAUDE.md:99` — *"Read before writing. Don't guess file
  formats, XML structures, or API shapes. Read the schema, read the existing
  code, read the test patterns."* The plan reuses the existing compiler and card
  loader rather than inventing parallel ones.
- `beebox/CLAUDE.md` (Validation section) — the PostToolUse hook contract:
  *"On a card path with errors it exits 2 with the error on stderr so Claude
  Code surfaces it to the agent (warning, not blocking)."* Deliverable (b)
  extends this exact contract to view `.tsx` files; it must not change the
  card/CLAUDE.md behavior.
- `beebox/CLAUDE.md` (Behavioral Notes) — *"don't add features beyond what
  the task requires"* (paraphrased as the "Improving These Instructions" /
  scope-restraint posture throughout). v1 is synchronous render only; the
  heavier async/effect machinery is explicitly out of scope.
- `beebox/code-style.md` — no `any`; custom error classes not
  `new Error()`; max 2 positional params (named-params object beyond that); only
  export what's used (knip). The new loader/compiler/command code follows these.
- `beebox/docs/testing.md` — tests as a design tool; doctests are the
  primary format. New codepaths get doctests named during design (see Rollout).
- Most recent shipped precedent: `bbx render` (`src/cli/commands/render.ts`,
  `src/frontend/src/ssr/render.tsx`) is the closest precedent for "run React to
  HTML from a CLI command." This plan deliberately diverges from it (in-process,
  not a subprocess) — the divergence is justified below.

## What already exists

- **`compileView()`** — `beebox/src/webapp/views/compiler.ts:102`. esbuild
  bundles a view `.tsx`, `loader: "tsx"`, `jsx: "automatic"`, `format: "esm"`,
  `write: false`, with `reactExternalPlugin` rewriting every `import "react"` to
  a `window.__cbReact` shim (`compiler.ts:32-58`). **Reuse the esbuild
  invocation; do not reuse the React-shim plugin** — Node needs React resolved
  to the real module, not a window global. This is the crux (see Track A).
- **Metadata extraction** — `extractMeta()` (`compiler.ts:67`) parses
  `dependencies`, `modes`, etc. from source. Reused as-is via `compileView`.
- **The "real cards" loader** — inlined in the Fastify route at
  `beebox/src/webapp/routes/views.ts:79-123`: glob each dependency
  pattern, split `.card` vs other files, `buildLoadContext()` +
  `loadCardFile()` → `frontmatterViewCard()`, list attach-scope files, annotate
  git status. **Rebuild as an extraction:** lift this into a shared
  `core/` function so the route and the new command feed the view *provably the
  same data*. Rebuilding in place (a second copy in the command) is rejected —
  it would let the test diverge from production. The extracted function keeps
  **full production fidelity**, including the git-status annotation
  (`buildGitStatusLookup` → `getStatus`/`isRepo`, `views.ts:160-174`, which shells
  out to `git` via `simple-git`, `git.ts:12`). Short-lived `git` subprocesses are
  explicitly fine (confirmed with the boxholder — git is safe; the orphan concern
  is servers/long-lived processes, not git). `buildLoadContext`/`loadCardFile`
  are pure (no spawn, no server — verified). See "Process & orphan safety".
- **`ViewProps` / `ViewCard` / `ViewFile` types** —
  `beebox/src/types/views.ts:8-88`. The component contract the command
  must construct. **Caveat (already-stale):** the backend `ViewProps` at
  `types/views.ts:8-55` has **no `reportActivity`** — the real runtime contract
  defines and passes it only in the frontend (`ViewRenderer.tsx:37-52,234-242`,
  documented at `views-doc.ts:113`). So "reuse the type as-is" is wrong: the
  command must construct props matching the *frontend* contract (incl.
  `reportActivity`). Track A reconciles this — see "Prop-contract reconciliation".
- **`ViewFileHelpers`** — `beebox/src/frontend/src/hooks/useViewFileHelpers.ts:72`
  defines the async helper signatures (`readFile`, `writeFile`, `appendFile`,
  `commitFile`, `adapterFetch`, `fileUrl`). The command mocks these (see Track A,
  helper policy). Referenced for signatures only — it's frontend code.
- **`bbx render`** — `src/cli/commands/render.ts:49-54` spawns a tsx subprocess
  via `register-loader.mjs` with `TSX_TSCONFIG_PATH` set to the frontend
  tsconfig; the browser-polyfill `setup.ts` is imported by the SSR script it
  runs (`render.tsx:18-19`), not by the command directly. **Not reused** — views
  don't need any of that (JSX is already transformed by esbuild; `renderToString`
  needs no DOM). The subprocess model is the thing this plan deliberately
  *doesn't* copy. See Track A rationale.
- **TWO validation-hook paths, not one.** This is the correction that reshapes
  Track B:
  - **Shell hook** — `runHookMode()`, `src/cli/commands/validate.ts:163-199`:
    reads the touched path from a PostToolUse payload on stdin, branches
    `isClaudeMdFile` → `isCardFile` → else exit 0. This is what the installed
    `.claude/settings.json` PostToolUse hook calls
    (`src/core/install-validation-hooks.ts:82-89`).
  - **In-process SDK hook** — `cardValidatorHook()`, `src/core/sdk-hooks.ts:42-86`:
    matcher `"Write|Edit"`, handles `tricks/`, `.card`, `.md`, else `return {}`.
    This is what **agent chat sessions and agent runs actually use**
    (`src/services/claude-chat.ts:148`, `src/core/agent-run.ts:75`) — the primary
    case where a box agent authors a view.

  View `.tsx` files fall through **both** paths silently today (`validate.ts:179`
  only matches cards; `sdk-hooks.ts` only matches tricks/card/md). Track B was
  originally scoped to only the shell hook — that would leave the *primary*
  authoring path (in-session agents) with no signal. The fix: **extract one
  shared "validate a touched path" function** and call it from both hooks, so a
  view compile-check fires regardless of which hook runs. The SDK matcher should
  also cover `MultiEdit`.
- **Path predicates** — `isCardFile`/`isMarkdownFile`
  (`src/cli/lib/paths.ts:193,197`), `isClaudeMdFile`
  (`src/core/claude-md-lint.ts:45`), `requireBoxRoot`
  (`src/cli/lib/paths.ts:110`). A new `isViewFile` predicate joins these.
- **CLI registration** — `src/cli/index.ts:72+` `program.addCommand(...)`, with
  command exports barreled through `src/cli/commands/index.js`. The new command
  registers here.
- **Views guide generator** — `src/core/views-doc.ts` produces
  `docs/generated/views.md`; the per-box stub is `VIEWS_CLAUDE_MD` in
  `src/core/box-templates.ts:254-272`. Both need a pointer to the new command
  (Track C).
- **react / react-dom resolvability** — verified both resolve from the backend
  process today: `react-dom/server` → `node_modules/react-dom/server.node.js`,
  `react` → `node_modules/react/index.js` (hoisted by pnpm via the frontend).
  They are **not** direct deps of `beebox`; Track A adds them explicitly so
  the command doesn't lean on hoisting luck.

## Prior art (external)

- **Single React instance / "Invalid hook call" across module boundaries** —
  React's own docs (react.dev "Rules of Hooks" / the legacy "Invalid Hook Call
  Warning" page, https://react.dev/warnings/invalid-hook-call-warning) document
  that two copies of React in one process break hooks because the dispatcher is
  module-level state. This is exactly why Track A externalizes React (rather than
  bundling it into the view) so the view and `react-dom/server` share one
  instance. Confirms the chosen approach.
- **esbuild `sourcemap: "inline"` + Node stack mapping** — Node's
  `--enable-source-maps` / `process.setSourceMapsEnabled(true)` (Node ≥16.6,
  https://nodejs.org/api/process.html#processsetsourcemapsenabledval) consumes
  inline source maps to remap thrown stack traces. Lets us map a render-time
  throw back to `.tsx` lines without adding `source-map-support`. esbuild's
  `sourcefile` (already set to `path.basename(viewPath)` at `compiler.ts:120`)
  becomes the name shown in the mapped stack.
- **`renderToString` does not run effects** — react-dom/server docs
  (https://react.dev/reference/react-dom/server/renderToString) confirm
  `useEffect`/`useLayoutEffect` never fire during server render. This is the
  documented basis for the v1 limitation (synchronous render only) and for the
  helper policy (async helpers called during render are bugs).
- **No prior art found** for a beebox-specific "test an agent-authored
  view" tool — this is net-new internal surface; nothing external to adopt
  wholesale beyond the React/esbuild/Node mechanics above.

## Tracks / scope

Ordered by implementation dependency: A (the render command + its loader
extraction + Node compiler) unblocks everything; B (edit-time hook) depends only
on the Node compiler from A; C (docs/guide pointers) depends on A's final command
surface.

### Track A — `bbx view test <slug>` render command

**What.** A CLI command that, given a box and a view slug, compiles the view for
Node, loads the real cards/files the view's dependency globs select, renders the
component once with `renderToString`, and reports: on success, exit 0 plus the
rendered output; on failure, non-zero exit with the error message and a
source-mapped stack.

**Why this needs to change.** Today the only execution path for a view is the
browser (`ViewRenderer.tsx:125` dynamic-imports `/api/views/:slug/module.js`).
An authoring agent gets no programmatic signal — it cannot tell whether the view
renders the right thing, or crashes, without a human or a browser. This is the
core gap the user framed as "render the card with respect for the view (getting
an exception if necessary)."

**Direction.**

1. **Node compile.** Add a Node-target compile path. Two implementation options;
   the plan commits to (a):
   - **(a) Externalize-and-import (chosen).** Parameterize the compiler so it can
     emit with React externalized to the *bare* `react` / `react/jsx-runtime`
     specifiers (esbuild `external`, no window shim) and `sourcemap: "inline"`.
     Write the ESM output to a temp `.mjs` file **inside the beebox package
     dir** (so bare `react` resolves up the normal `node_modules` chain), then
     dynamic-`import()` it. The command separately imports `renderToString` from
     `react-dom/server`; both resolve to the one hoisted React → single
     instance, no dispatcher break.
   - **(b) Self-contained bundle (fallback, documented not taken).** Bundle the
     view + a tiny renderer entry + React + react-dom/server into one file with
     nothing external, import it, call an exported `render(props)`. Fully
     self-contained but re-bundles react-dom every call and is slower; only worth
     it if (a)'s reliance on the hoisted instance proves fragile.

   The compiler change is a parameter on the existing `compileView` path (e.g. a
   `target: "browser" | "node"` option selecting shim-plugin vs bare-external),
   *not* a forked copy — keeps the esbuild invocation single-sourced. **Cache
   key must include `target`.** The current cache is keyed by `viewPath` with an
   `mtime` guard (`compiler.ts:30,107-139`) — adding a target without changing
   the key cross-contaminates: a node compile would poison the browser route with
   bare-React output (or vice versa). Either key the cache by
   `{ viewPath, mtime, target }`, or give the CLI path its own non-cached
   compile entry. Source name: set esbuild's `sourcefile` to the **box-relative**
   view path (not just the basename it uses today at `compiler.ts:120`) so mapped
   stacks read like `views/foo.tsx:NN`, not a bare `foo.tsx`.

   **Prop-contract reconciliation.** Construct props matching the *frontend*
   runtime contract, which includes `reportActivity` — absent from the backend
   `types/views.ts:8-55` (see "What already exists" caveat). Decide one of:
   (a) extend the backend `ViewProps` to add `reportActivity` so there's a single
   shared contract the command imports, or (b) define the command's prop shape
   against the frontend contract explicitly. Lean (a) — one shared type is less
   drift — but it touches a type the route also uses, so verify no route caller
   breaks. This is settled enough to not be an open question but is called out so
   the implementer reconciles rather than trusting the stale backend type.

2. **Load real cards.** Call the extracted loader (see "What already exists" →
   the `views.ts:79-123` extraction). The loader returns the **same `{cards,
   files}` the browser route returns** — *all* dependency matches, unfiltered.
   `--path <cardPath>` does **not** filter `cards` (production doesn't: the route
   never reads `request.query`; card-bound views self-filter on `params.path`,
   `views-doc.ts:83-86`, `FileView.tsx:299-304`). Instead `--path` **only sets
   `params.path`** and is passed through to the component. If the named path is
   *not* among the loaded cards, **warn loudly** (it means the view's
   `dependencies` globs don't select that card — almost always the bug the agent
   is chasing) rather than silently rendering an empty card-bound view.

   **Skipped-card diagnostics (test-mode, not silent).** The production route
   silently swallows cards that fail to load (`views.ts:92-104`) — correct for a
   live page, wrong for a *test* tool whose whole job is author feedback. The
   extracted loader preserves production behavior by default but **also returns
   the list of skipped paths + their load errors**. `bbx view test` prints those
   and **exits non-zero** when any selected card failed to load, unless
   `--allow-invalid-cards` is passed. (The route keeps ignoring the diagnostics —
   no behavior change there.)

3. **Build `ViewProps`.** Real `cards` + `files` from step 2; `params` from
   `--path` (sets `params.path`); `boxSlug` from the box dir basename; mocked
   helpers per the policy below. (`--param k=v` is cut from v1 — see Vocabulary.)

4. **Render.** `process.setSourceMapsEnabled(true)`, then
   `renderToString(createElement(mod.default, props))` inside a try/catch.

5. **Report.** Success → exit 0; by default print **HTML with `<script>`/
   `<style>` stripped** (cheerio, mirroring `render.tsx:237-258 postProcess`,
   which returns `$.html()` — markup minus scripts/styles, *not* text-only),
   `--raw` for the full HTML including scripts/styles. Failure → write the error
   (name + message + source-mapped stack) to stderr, exit non-zero. Use a custom
   error class for the command's own failures (compile-not-found, slug-not-found)
   per CODE-STYLE.

**Helper mock policy (per-helper, not uniform).** Grounded in "`renderToString`
runs no effects" — so any *async* helper invoked during render is a view bug, and
throwing is the most useful signal; the *synchronous* ones legitimately run in
render and must behave:

| Helper | Mock behavior | Rationale |
|---|---|---|
| `fileUrl` | returns a plausible string URL | synchronous, pure; legitimately used in render (`<img src={fileUrl(p)}>`). Must not throw. |
| `reportActivity` | silent no-op | documented "always safe to call, no-op outside companion" (`views.ts` ViewProps doc; `views-doc.ts:113`). |
| `navigate` | no-op | user-action callback; calling during render is unusual but harmless to swallow. |
| `readFile` `writeFile` `appendFile` `commitFile` `adapterFetch` | **throw** a custom error: "*helper*() was called during render — async helpers only run in effects/handlers, which `bbx view test` does not execute (v1)." | async; render-time call is itself a bug. Loud throw beats a silent empty value. |

**Process & orphan safety (hard constraint).** `bbx view test` runs **entirely
in-process** — it starts no server and no long-lived process, so nothing can
orphan. This is the load-bearing reason it does NOT reuse the `bbx render`
subprocess harness (`render.ts:78` `spawn(...)`): rendering is a direct
in-process `renderToString` call, and the compiled view loads via in-process
`import()` of a temp `.mjs` (module loading is not a process). It touches **none**
of the orphan-prone dev machinery in CLAUDE.md — no router, no Vite, no Fastify,
no agent-browser. The only spawned processes are both short-lived and incapable
of orphaning:
- **esbuild's internal service child** (`esbuild.build()`, `compiler.ts:115`) —
  tied to the parent over stdio, so it dies when `bbx` exits and cannot outlive
  it. The command calls `esbuild.stop()` before exit to tear it down
  deterministically rather than relying on process teardown.
- **short-lived `git` invocations** via `simple-git` (the loader's git-status
  annotation) — complete-and-reap; explicitly confirmed acceptable (git is safe;
  servers are the concern). Kept on for full production fidelity.

The temp `.mjs` is unlinked in a `finally` so no file is leaked either.

**Vocabulary lock-ins.** Command name `bbx view test <slug>` (a `view` parent
command with a `test` subcommand, leaving room for future `view` subcommands).
Flags: `--path <cardPath>`, `--raw`, `--allow-invalid-cards`. `--param <k=v>` is
**cut from v1** (codex review): `--path` covers the production card-bound case,
and `params` is a flat `Record<string,string>` we can add a passthrough for later
if a real view needs it. Compiler option name: `target: "node" | "browser"`.

**First implementation chunk.** Extract the card loader from `views.ts:79-123`
into a shared `core/` function (e.g. `src/core/view-cards.ts`), and switch the
Fastify route to call it. No behavior change; a route doctest proves
equivalence. This unblocks the command and is independently committable with
zero open questions.

### Track B — edit-time compile check in BOTH validation hooks

**What.** When a view `.tsx` is touched, esbuild-compile it and surface compile
failures as the standard edit-time nudge — from **both** hook paths: the shell
`bbx validate --hook` *and* the in-process `cardValidatorHook()` that agent
sessions actually run.

**Why this needs to change.** A view with a syntax/JSX/import error currently
falls through to a no-op in both hooks (`validate.ts:179` only matches cards;
`sdk-hooks.ts:42-86` only matches tricks/card/md) — the agent gets no edit-time
signal and learns of the break later. Cards get this feedback; views should too.
**Crucially, the primary authoring path is the in-process hook:** a box agent
writing a view in a chat or agent session triggers `cardValidatorHook()`
(`claude-chat.ts:148`, `agent-run.ts:75`), **not** the shell hook. Scoping Track
B to only `runHookMode()` (the original plan) would ship a check that never fires
for the case it's meant to serve. (Codex review surfaced this gap.)

**Direction.**
1. Add `isViewFile(path)` (under a box's `views/`, ends `.tsx`) to the path
   predicates (`src/cli/lib/paths.ts`).
2. **Factor one shared "validate a touched path" function** — given a path, run
   the right check (card lint / markdown lint / **view compile**) and return a
   result (additional-context string or error). Both hooks call it:
   - `runHookMode()` (`validate.ts:163`) translates the result to its
     stderr+exit-2 contract.
   - `cardValidatorHook()` (`sdk-hooks.ts:42`) translates it to its
     `hookSpecificOutput.additionalContext` shape, and its matcher widens to
     `"Write|Edit|MultiEdit"`.

   The shared function keeps the two hooks from drifting (they already diverge —
   the shell hook does CLAUDE.md size + stale-contains warnings the SDK hook
   doesn't; full unification is out of scope, but the **view-compile branch** is
   shared from day one).
3. The view check is **compile-only** — esbuild build via Track A's Node compile
   path, no execution, no `renderToString`, no `tsc`. esbuild-only is deliberate:
   fast, catches syntax/JSX/bad-import. `tsc` (wrong prop names) needs a
   box-pointed tsconfig and is too slow per-edit; that depth is the render
   command's job.

**Vocabulary lock-ins.** Predicate name `isViewFile`. Shared function surfaces
the same compile error to both hooks; shell-hook exit code stays 2 (nudge, not
block); SDK matcher becomes `Write|Edit|MultiEdit`.

**First implementation chunk.** Add `isViewFile` + the shared validate-path
function, wire the view-compile branch into `runHookMode()` and
`cardValidatorHook()`. Depends on Track A's compiler `target` parameter
(compile-only needs no render path, so this lands right after the compiler chunk,
before the full command). Two doctests: a broken view through `runHookMode`
asserts exit 2 + message; a broken view through `cardValidatorHook()` asserts the
`additionalContext` carries the compile error.

### Track C — point agents at the command

**What.** Once `bbx view test` exists, update the generated views guide
(`src/core/views-doc.ts`, the `## Error Handling` / `stylingAndErrorsSection`
~`views-doc.ts:320`) and the per-box stub (`VIEWS_CLAUDE_MD`,
`box-templates.ts:254`) to tell authoring agents to run it — the same
write-then-validate loop cards already have.

**Why this needs to change.** A test command no agent knows about gets no use.
The guide currently ends at "the browser shows the compile error" — it should
name the Node command as the authoring-time check.

**Direction.** Add a short "Testing a view" subsection to `views-doc.ts`
documenting `bbx view test <slug>`, the `--path` flag, what it does and doesn't
cover (synchronous render, no effects/async helpers — quote the v1 limitation),
and a one-line pointer in `VIEWS_CLAUDE_MD`. Per
`feedback_doc_altitude_matches_importance`, keep the stub to one line and put the
detail in the generated guide.

**First implementation chunk.** The `views-doc.ts` subsection + the
`VIEWS_CLAUDE_MD` line, landed together after the command's surface is final.

## Subplans

None. Each track is a self-contained design with settled direction; no
sub-question needs its own research/vocabulary decision step. The one genuine
fork (externalize-and-import vs self-contained bundle) is resolved inline in
Track A with a documented fallback, not deferred to a subplan.

## Failure modes

**Critical gap:** none unresolved. The closest candidate — a view that calls an
async helper during render — is handled by the throw policy (loud, not silent)
and covered by a doctest.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| View has a syntax/JSX error | Yes (Track B hook doctest + Track A compile-error doctest) | Yes — esbuild throws; command exits non-zero with message, hook exits 2 | Clear (message on stderr) |
| View throws at render (`undefined.map`, bad prop access) | Yes (render-failure doctest) | Yes — try/catch around `renderToString`, source-mapped stack to stderr | Clear (mapped to `.tsx` line) |
| View calls `readFile`/async helper during render | Yes (doctest asserts the throw message) | Yes — mocked helper throws custom error naming the helper | Clear (explains v1 limitation) |
| View calls `fileUrl` during render | Yes (covered by a happy-path render doctest using `<img src={fileUrl(...)}>`) | Yes — returns a string, never throws | Clear (renders) |
| Bare `react` fails to resolve from temp file (hoisting changes) | Partial — happy-path render doctest would fail loudly if React didn't resolve | Track A adds explicit `react`/`react-dom` deps to `beebox`; fallback bundle option documented | Clear (import error, non-zero exit) |
| Source maps not applied → stack points at compiled JS | Yes (render-failure doctest asserts `.tsx` in the stack) | Yes — `sourcemap:"inline"` + `setSourceMapsEnabled(true)` | Clear if test passes; otherwise stack is just less precise, not wrong |
| Slug doesn't exist / no `views/<slug>.tsx` | Yes (doctest) | Yes — custom error, non-zero exit | Clear |
| `--path` names a card the globs don't select | Yes (doctest) | Yes — `--path` sets `params.path` only; command warns loudly that the path isn't among loaded cards | Clear (warning to stderr) |
| Selected card fails to load (validation error) | Yes (doctest) | Yes — loader returns skipped-path diagnostics; command prints them and exits non-zero unless `--allow-invalid-cards` | Clear (was silent in route; test-mode surfaces it) |
| View `.tsx` edited inside an agent session (in-process hook) | Yes (sdk-hook doctest) | Yes — shared validate-path function wired into `cardValidatorHook()` | Clear (additionalContext nudge) |
| Compiler cache cross-contaminates browser vs node output | Yes (doctest compiling same view both targets) | Yes — cache key includes `target` | Clear (would otherwise be silent wrong-output — the key fix prevents it) |
| Temp `.mjs` files accumulate | Yes (command cleans up in `finally`; doctest can assert none left) | Yes — write to a unique temp path, unlink after import in a `finally` | Clear |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A in the card-vocabulary sense; this plan adds
  no card tag or schema field. The analogous "wrong thing" is an agent running
  `bbx view test` against the wrong slug → handled by the slug-not-found error.
  **ADDRESSED** (Track A report path).
- **Stale ref** — a view's `dependencies` glob could match a card archived
  between authoring and test. The loader globs live at run time, so the test sees
  current reality; a now-empty match renders the view's empty state.
  **ADDRESSED** (live glob, same as production route).
- **Two agents touching the same card** — the command is read-only on box data
  (it never writes; `writeFile` is mocked to throw). No concurrent-write surface.
  **ADDRESSED** (read-only by construction).
- **Hand-edit drift** — boxholder hand-edits a view `.tsx` with a syntax slip.
  The edit-time hook (Track B) catches it on the next Edit/Write **in either hook
  path** (shell or in-process SDK); a hand edit outside any agent is caught next
  time `bbx view test` runs. **ADDRESSED** (Track B, both hooks).
- **Fabricated free-form value** — N/A; no agent-authored free-text field is
  introduced. The command reports real render output, which makes "does it
  actually show the right thing" *checkable* rather than asserted — it reduces
  fabrication surface. **ADDRESSED** (by design).
- **Validation error UX** — the render failure / compile error message is what
  the authoring agent reads. Track A maps the stack to `.tsx` lines and Track B
  reuses the exit-2 stderr nudge; both are designed for agent legibility.
  **ADDRESSED** (Track A report, Track B hook).
- **Partial migration / transition state** — no data-shape migration; nothing to
  transition. The loader extraction (Track A first chunk) is behavior-preserving,
  proven by a route doctest, so there's no bilingual window. **ADDRESSED**
  (no migration).

## NOT in scope

- **Effects / async rendering.** No `react-test-renderer` + `act()` + async-flush
  machinery. `renderToString` runs the component body once; `useEffect`, async
  helpers, and post-mount state are not exercised. Rationale: the user explicitly
  chose synchronous-only for v1; most box views render straight off `cards`, so
  this catches the bulk (syntax, JSX, `undefined.map`, prop access, coercion).
- **`tsc` type-checking in the edit-time hook.** Catches wrong prop names but
  needs a box-pointed tsconfig and is too slow per-edit. Rationale: keep the hook
  cheap; the render command is the deeper pass.
- **Browser-API polyfills.** A view that touches `window`/`document` at render
  time will throw. Rationale: that's a view bug, and the throw is the signal;
  polyfilling would mask it. (Documented in the guide via Track C.)
- **Snapshot/golden-file testing of view output.** The command prints output for
  the agent to eyeball; it does not store or diff golden snapshots. Rationale:
  out of the framed ask; could be a later addition.
- **A general `bbx render`-style scenario/mock system for views** (`--scenario`,
  `--machine`, `--mock` from `render.tsx`). Rationale: views take a flat `cards`
  prop, not XState machines + tRPC; that machinery doesn't apply.
- **`--param k=v` arbitrary param passthrough.** Cut from v1 (codex review);
  `--path` covers the production card-bound case. Rationale: add it only when a
  real view needs a non-`path` query param; trivial to layer on later.
- **Full unification of the two validation hooks.** Track B shares only the
  *view-compile* branch between `runHookMode()` and `cardValidatorHook()`; their
  other divergences (CLAUDE.md size lint, stale-contains warnings, markdown rules)
  stay as-is. Rationale: unifying everything is a separate refactor with its own
  risk surface; this plan only needs the view branch shared.

## Open design questions

- **Default output format: scripts/styles-stripped HTML vs full HTML.** Decided:
  HTML with `<script>`/`<style>` stripped by default (matching `render.tsx`'s
  `postProcess`, which returns markup minus scripts/styles — *not* text-only),
  `--raw` for everything. Listed here only because the user flagged "how the
  snapshot is presented" as open; it's settled in Track A's report step.
- **Prop-contract reconciliation: extend backend `ViewProps` (a) vs command-local
  shape (b).** Lean (a) — one shared type — but it touches a type the route uses,
  so the implementer verifies no route caller breaks (see Track A). Not blocking;
  resolvable in the prop-assembly chunk.

(Resolved during codex review and moved into Direction: `--path` sets
`params.path` only rather than filtering `cards`; `--param` is cut from v1; Track
B covers both hook paths.)

## Knowledge audits

This plan introduces one agent-facing concept: **"to test a view, run
`bbx view test <slug>`."** Per the default (each new agent-facing concept gets at
least one `knows_directly` audit), add an entry to
`src/dev/knowledge-audits.yaml`:

- `id: view-testing-command` — prompt: *"You just wrote a view in `views/`. How
  do you check it works without opening a browser?"* — `expected_level:
  knows_directly`, `watch_for: "Names bbx view test <slug> — does not say 'open it
  in the browser' or 'ask the user'"`, `correct_contains: ["bbx view test"]`,
  `tags: [views]`. This verifies the Track C guide edits actually make the
  command recallable from the views guide without re-reading.

The edit-time hook (Track B) is infrastructural — the agent doesn't invoke it,
it fires automatically — so it gets no audit (skip-with-rationale).

Per the skill: the audit lands **run**, not just written —
`pnpm knowledge-audit run --box <absolute test-box path> --filter view-testing-command`
(absolute path per `project_knowledge_audit_resets_tree`), with the status
comment recorded in `knowledge-audits.yaml` before the plan completes.

## Implementation order

1. **Loader extraction + diagnostics** (Track A chunk 1) — lift `views.ts:79-123`
   into `core/view-cards.ts`; route calls it (behavior unchanged); loader also
   returns skipped-card diagnostics the route ignores and the command uses. Route
   doctest proves equivalence. No dependency.
2. **Node compiler option** (Track A chunk 2) — add `target: "node"` to the
   compiler (bare-external React + inline sourcemap), **extend the cache key with
   `target`**, set `sourcefile` to the box-relative path. Depends on nothing;
   doctest compiles a trivial view for both targets and asserts no
   cross-contamination + node output imports bare `react`.
3. **Edit-time check in both hooks** (Track B) — `isViewFile` + the shared
   validate-path function, wired into `runHookMode()` and `cardValidatorHook()`
   (matcher widened to `Write|Edit|MultiEdit`). Depends on chunk 2.
4. **Render command** (Track A chunk 3) — `bbx view test`, prop-contract
   reconciliation (incl. `reportActivity`), helper mocks, render, report
   (`--path` sets `params.path` only; skipped-card diagnostics → non-zero unless
   `--allow-invalid-cards`); register in `cli/index.ts`. Add `react`/`react-dom`
   to `beebox` deps. Depends on chunks 1 + 2.
5. **Guide pointers + audit** (Track C) — `views-doc.ts` subsection,
   `VIEWS_CLAUDE_MD` line, knowledge-audit entry (written + run). Depends on
   chunk 4 (final command surface).

Chunks are commit boundaries within this worktree, not ship boundaries. The plan
ships as one unit when all five complete; **do not merge to main without an
explicit ship signal from the boxholder.**

## Rollout shape

- **Test posture** (per `docs/testing.md` — tests as a design tool). Doctests
  named during design, one per substantial new codepath, mapping to the
  Failure-modes "Test exists?" column:
  - *Loader extraction equivalence* — route doctest: the extracted
    `core/view-cards.ts` returns the same `{cards, files}` the route did
    (filesystem-tier, `makeTmpBox()`).
  - *Skipped-card diagnostics* — loader doctest: a dependency glob selecting an
    invalid card surfaces it in the diagnostics list (route still returns it in
    neither `cards` nor an error).
  - *Node compile + no cache cross-contamination* — compile a trivial view for
    `target:"node"` and `target:"browser"`; assert node output imports bare
    `react`, browser output references `window.__cbReact`, and compiling one
    doesn't return the other from cache.
  - *Happy-path render* — a view using `cards` + `fileUrl` renders to expected
    scripts-stripped HTML, exit 0.
  - *Render failure → source-mapped stack* — a view doing `undefined.map()`
    exits non-zero with the **exact** `views/<slug>.tsx:<line>` in the stack
    (assert file + line, not just that `.tsx` appears).
  - *Async helper during render → throw* — a view calling `readFile` in its body
    produces the explanatory error.
  - *`--path` not selected* — a `--path` naming a card outside the globs warns
    loudly (assert the warning), doesn't silently green-render.
  - *Edit-time check, both hooks* — broken view through `runHookMode` → exit 2 +
    compile message; broken view through `cardValidatorHook()` → the compile
    error rides `additionalContext`; clean view → no-op in both.
  - Not chasing coverage: the mocked no-op helpers (`navigate`,
    `reportActivity`) and trivial flag plumbing don't get dedicated tests
    (`docs/testing.md`: tests aren't for coverage-for-its-own-sake).
- **Knowledge-audit** — the `view-testing-command` entry lands with Track C,
  written and run, status recorded.
- **Migration** — none. No existing data shape changes; the loader extraction is
  behavior-preserving (route doctest is the guard). New `beebox` deps
  (`react`, `react-dom`) are additive; `pnpm install` at the monorepo root picks
  them up.

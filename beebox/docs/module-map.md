# Module map: where shared code lives

A discoverability contract for the four "shared code" directories, so future
growth has a rule to check against instead of regrowing a second grab-bag.
Decide where a new helper goes by its *dependencies* and its *consumers*, not
by vibe.

- **`src/shared/`** — the lowest layer of the package: **isomorphic,
  dependency-free code that must run in the browser bundle *and* Node**.
  Everything else in the package may import it, and it imports nothing else
  in the package (no `core/`, `schemas/`, `connectors/`, `webapp/`, or
  `lib/` — enforced by keeping it a leaf; verify with `pnpm lint:circular`).
  It may not touch `node:` builtins or any server-only dependency. It may
  encode a small amount of domain knowledge (tool names, card-name parsing,
  markdoc config, nav routes) as long as it stays bundler-safe. Examples:
  `invariant`/`assertNever`, `is-record`, `error-guards`, `result`,
  `awake-timeout`. **A helper both the frontend and the backend need lives
  here** — there is no separate re-export shim; the implementation itself
  moves to `shared/` and every importer, frontend and backend alike, imports
  it from there directly (via `@shared/<name>` in the frontend, a relative
  import in the backend). **Ref/path algebra lives here, in exactly one
  module**: `shared/ref-path/core.ts` (`parseRef`, `resolveRefPath`) owns the
  3-form rule and fail-closed containment for every in-box ref, backend and
  frontend alike — building on `shared/attach-path.ts` (attach-scope naming)
  and `shared/box-path.ts` (the box-relative canonical form). A new consumer
  imports it; it never re-derives the rules with `path.resolve` or a segment
  split.

- **`src/lib/`** — **generic, backend-only cross-cutting utilities** that may
  use Node (`node:` builtins, server-only deps) and may import `shared/`
  (a downward edge, not a cycle), but never `core/`, `schemas/`,
  `connectors/`, or `webapp/`. Examples: `content-hash`, `mimetype`,
  `file-exists`, `public-url`, `atomic-write` (`writeFileAtomic`, crash-safe
  whole-file replacement for small state and credential stores), `git*`/
  `paths`/`box-shape` (promoted from `cli/lib` in the Track G reorg), `time`
  (`getBoxTime`), `format` (chalk), `box-config`. **Check here before writing
  your own** — a hand-rolled copy of something already in `lib/` is the
  regrowth pattern this directory exists to prevent. If a `lib/` helper turns
  out to be dependency-free and the frontend also needs it, move the
  implementation down into `shared/` rather than reaching across the
  boundary — `lib/` never imports upward into `shared/`'s consumers, and
  `shared/` never imports back into `lib/`.

- **`src/types/`** — **ambient `.d.ts` declarations only**: module
  augmentations and global/ambient types (e.g. the `beebox/view-widgets`
  specifier surface). A real module that *exports runtime or interface values*
  does not belong here — it goes in `core/` (domain contract) or `lib/`
  (generic). `types/views.ts` was the counterexample that moved to
  `core/views/types.ts` because it imported `core/` (a layer inversion).

- **`src/cli/lib/`** — **CLI/session-domain helpers coupled to `core/`**, not
  generic. What remains after the Track G promotion is session-transcript
  parsing (`session*.ts`, which import `core/chat/*`) and `fetch.ts` (imports
  `schemas/`). Because these depend upward on `core`/`schemas`, they can't live
  in the dependency-free `lib/`. Don't add a *generic* utility here — that's
  what re-created the "second `lib/`" the reorg collapsed; put generic helpers
  in `src/lib/`.

Rule of thumb: **isomorphic and dependency-free → `src/shared/`; backend-only
generic helper → `src/lib/`; ambient `.d.ts` → `src/types/`; core-coupled
CLI/session helper → `src/cli/lib/`.**

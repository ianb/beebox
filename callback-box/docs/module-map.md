# Module map: where shared code lives

A discoverability contract for the four "shared code" directories, so future
growth has a rule to check against instead of regrowing a second grab-bag.
Decide where a new helper goes by its *dependencies* and its *consumers*, not
by vibe.

- **`src/lib/`** — the single home for **generic cross-cutting utilities** with
  **no dependency on `core/`, `schemas/`, `connectors/`, or `webapp/`**. It is
  the lowest layer; everything may import it and it imports nothing upward
  (enforced by keeping it a leaf — verify with `pnpm lint:circular`). Examples:
  `content-hash`, `mimetype`, `file-exists`, `public-url`, `sleep`,
  `awake-timeout`, `git*`/`paths`/`box-shape` (promoted from `cli/lib` in the
  Track G reorg), `time` (`getBoxTime`), `format` (chalk), `box-config`. **Check
  here before writing your own** — a hand-rolled copy of something already in
  `lib/` is the regrowth pattern this directory exists to prevent.

- **`src/shared/`** — code shared **specifically between the frontend and the
  backend** (isomorphic; must run in the browser bundle *and* Node). It may
  encode a small amount of domain knowledge (tool names, card-name parsing,
  markdoc config, nav routes) but must stay bundler-safe (no `node:` builtins,
  no server-only deps). If a helper is backend-only, it belongs in `lib/` or
  `core/`, not here. A `shared/` module **may import a bundler-safe `lib/`
  module** (e.g. `lib/invariant.ts`, which is dependency-free) — `lib/` is the
  lower leaf layer, so `shared/ → lib/` is a downward edge, not a cycle. It may
  NOT import `core/`, `schemas/`, `webapp/`, or any `node:`-touching `lib/`
  module.

- **`src/types/`** — **ambient `.d.ts` declarations only**: module
  augmentations and global/ambient types (e.g. the `callback-box/view-widgets`
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

Rule of thumb: **no core deps → `src/lib/`; frontend+backend both → `src/shared/`;
ambient `.d.ts` → `src/types/`; core-coupled CLI/session helper → `src/cli/lib/`.**

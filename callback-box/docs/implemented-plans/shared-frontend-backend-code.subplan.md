# Shared Frontend/Backend Code — Subplan

A subplan of `markdoc-tags-plan.md`. The Markdoc work needs the same
tag schemas on both sides of the frontend/backend split: the React
renderer (`Markdown.tsx`) on the frontend, and the new server-side
Markdoc → markdown emitter (Track 2's `compileBriefing` rewrite) on
the backend. This subplan settles where shared code lives and how both
sides import it.

## Stated preferences this plan trades against

- **Frontend/backend split is a hard convention.** Two tsconfigs
  (`callback-box/tsconfig.json:23`: *"exclude: src/frontend"*;
  `callback-box/src/frontend/tsconfig.json`). Anything shared has to
  satisfy both module-resolution regimes (NodeNext for backend,
  bundler for frontend).
- **Single repo-wide Markdoc vocabulary.** Asserted by
  `docs/implemented-plans/markdoc-tags-plan.md:9-13`. The vocabulary is one shape per
  tag name across every schema; that constraint becomes a structural
  fact (not just a maintenance promise) when frontend and backend
  share a single config object.
- **"Don't add features beyond what the task requires"** —
  `CLAUDE.md`. We share what Track 2 forces us to share. We do not
  preemptively hoist code that isn't needed by both sides.
- **`{% quote %}` precedent** — `src/core/agent-guide/quotes.ts`
  shipped without any shared-code question because the tag had no
  backend consumer. Track 2 is the first chunk of work where the
  backend genuinely needs the schemas.

## What already exists

- **Frontend Markdoc renderer** at
  `src/frontend/src/components/Markdown.tsx:255`: *"const ast =
  parse(children); const t: RenderableTreeNode = transform(ast,
  config);"*. Consumes `markdocConfig` from
  `src/frontend/src/lib/markdoc-config.ts:79`: *"export const
  markdocConfig: Config = { tags: { quote, source, task }, nodes:
  { item } };"*.
- **Frontend tag/node component map** is built per-render in
  `Markdown.tsx:225-240`. Each tag (`QuoteInline`, `QuoteBlock`,
  `SourceInline`, `SourceBlock`, `Task`, `Para`, `Link`, `Img`) is a
  React component. **Components are frontend-only by nature** —
  they're not shareable; what's shareable is the *config schemas*
  that describe attribute names and types.
- **Backend already depends on `@markdoc/markdoc`** (added by
  Track 4 for `body-refs.ts:29-35`). Backend imports it via the
  default-export workaround
  (`src/core/body-refs.ts:31-35`: *"Markdoc ships dual CJS/ESM but
  its `exports` field is null, so Node ESM imports resolve to the
  CJS bundle — which only exposes a default export ... Pull `parse`
  off the default."*).
- **Existing backend-only helpers directory** at `src/lib/`
  (`attach-lint.ts`, `attach-path.ts`, `file-lock.ts`,
  `filename.ts`). Backend-scoped by convention — not visible to the
  frontend tsconfig today.
- **Existing frontend → backend path alias**:
  `src/frontend/tsconfig.json:22-25`: *"paths: { '@backend/*':
  ['../webapp/*'] }"*. **The reverse direction does not exist**;
  no backend → frontend imports work, no shared resolution path.
- **Markdoc has a `format()` function** for AST → Markdoc text
  serialization (released in v0.1.5, currently labeled experimental
  by upstream). This answers the parent plan's "Markdoc round-trip"
  open question: it exists. Reliability on real bodies is the
  remaining unknown.

## Prior art (external)

- **Markdoc's own programmatic-edit example**
  ([Discussion #366](https://github.com/markdoc/markdoc/discussions/366)):
  `Markdoc.format(document)` serializes an AST back to Markdoc text.
  Used by people adding `id` attributes to all heading nodes, etc.
  The discussion notes it's experimental but functional for the
  common cases.
- **Markdoc formatter source**
  ([Issue #145](https://github.com/markdoc/markdoc/issues/145)):
  formatter lives at `src/formatter.ts` in the Markdoc repo;
  released experimentally because round-trip fidelity on edge
  cases (specifically attribute ordering, comment preservation,
  whitespace) is not guaranteed. Acceptable for our migration
  use cases (one-way: AST → text, not edit-in-place); worth
  confirming for any future in-place editing.
- **pnpm workspace + dual tsconfig sharing patterns**: the
  conventional shape is a separate package (e.g.,
  `packages/shared/`) with its own `package.json`. Our codebase
  has a different shape — cardworks is the sibling package but is
  intentionally Markdoc-agnostic, and we don't have a
  `packages/shared/` yet. Within a single package (callback-box),
  a `src/shared/` directory included by both tsconfigs is the
  simpler shape. No prior art turned up against this pattern.
- **Vite + Node tsconfig coexistence**: Vite's `bundler`
  moduleResolution tolerates the strictest convention (NodeNext's
  `.js` import extensions on TS files). So code written for
  NodeNext compiles cleanly in both regimes. The other direction
  is not true.
- **Empty search:** no upstream documentation on Markdoc tag-schema
  reuse across SSR + CSR explicitly. Pattern is "ship the same
  config" but no canonical layout. We're picking ours.

## Tracks / scope

Single track — no sub-tracks. Move the Markdoc config to a shared
location, set up the tsconfig and import paths so both sides resolve
it, lay down the convention for future shared modules.

### Direction

1. **Create `callback-box/src/shared/` directory.** Single shared
   location. By being under `src/` (which the root tsconfig
   includes) and outside `src/frontend/` (the only exclude), it's
   visible to the backend by default.

2. **Move `markdoc-config.ts`** from
   `src/frontend/src/lib/markdoc-config.ts` to
   `src/shared/markdoc-config.ts`. The file already has no React
   dependency (it imports from `@markdoc/markdoc` only).

3. **Update frontend `tsconfig.json`** to include `../shared/**/*`
   and add a path alias `@shared/*` mapping to `../shared/*`
   (mirrors the existing `@backend/*` alias precedent).

4. **Update frontend import** in `Markdown.tsx` to use
   `@shared/markdoc-config`. Backend imports use the literal
   relative path (`../shared/markdoc-config.js`) — backend has no
   path aliases to date and adding them changes how `tsx` resolves
   at runtime, which is out of scope.

5. **Convention for future shared modules.** `src/shared/` holds
   pure-TypeScript modules with no React, no Node-specific APIs
   (fs, child_process), no DOM types. Anything platform-specific
   stays on its side. The first inhabitant is `markdoc-config.ts`;
   additions follow on demand.

6. **Backend Markdoc → markdown emitter** lives at
   `src/core/markdoc-emit.ts` (backend-only, not shared). It
   imports the schema config from `src/shared/markdoc-config.ts`.
   It's used by Track 2's `compileBriefing` rewrite to render
   briefing bodies into the markdown form that `@`-includes into
   CLAUDE.md. **Default behavior for unknown tags** (per parent
   plan's Track 2 direction): emit inner text only, log to stderr.

7. **Backend uses `Markdoc.format()` for any future
   programmatic-edit needs.** Not used by Track 2 directly
   (`compileBriefing` is pure AST → markdown, no round-trip).
   Documented here so future tracks (e.g., Track 1's recipe
   migration if it grows beyond hand-edit) know it exists.

8. **CJS/ESM workaround pattern** for backend Markdoc imports stays
   as-is (`const { parse, format, ... } = Markdoc;` with a comment
   explaining why). This is the documented convention for any
   backend code consuming `@markdoc/markdoc`.

### Vocabulary lock-ins

- **`src/shared/`** as the location for cross-tsconfig modules.
  Pure TypeScript only — no React, no Node-only imports, no DOM
  imports.
- **`@shared/*`** as the frontend path alias. Backend uses literal
  relative paths.
- **`@backend/*`** alias is preserved (no change to existing
  precedent).
- **Backend Markdoc usage** always uses the default-import
  destructuring pattern. The pattern is documented at
  `src/core/body-refs.ts:29-35` and any new consumer copies it
  with a back-reference.

## Failure modes

### Frontend can't resolve `@shared/markdoc-config` after the move
- **Failure:** Vite's path alias doesn't pick up the new mapping;
  imports fail with "module not found."
- **Test exists?** No regression test yet; would be caught by
  `pnpm typecheck:frontend` and the first `vite build`.
- **Handling exists?** Compile-time error, clear message.
- **Clear-or-silent?** Clear.

### Backend can't import the moved config
- **Failure:** Backend's NodeNext resolution doesn't tolerate the
  `.ts` extension or the relative path is wrong.
- **Test exists?** `pnpm typecheck` (root) covers; the existing
  `card-lint.doctest.md` body-refs test exercises a real-world
  backend Markdoc-consumer path.
- **Handling exists?** Compile-time error.
- **Clear-or-silent?** Clear.

### Frontend bundle picks up Node-only types from `src/shared/`
- **Failure:** Someone adds a `fs`-using helper to `src/shared/` by
  mistake; frontend bundle either breaks at build time (Vite
  reports "Module 'node:fs' externalized for browser
  compatibility") or worse, ships with a polyfill that bloats the
  bundle.
- **Test exists?** Vite's bundler will warn; the linter will not.
- **Handling exists?** Convention-level: a top-of-file comment in
  `src/shared/markdoc-config.ts` calls out the "pure TS, no
  platform APIs" rule. Future shared modules inherit by example.
- **Clear-or-silent?** Clear at build time; silent at edit time
  unless the contributor notices the comment.

### Markdoc emitter loses content silently
- **Failure:** A briefing body contains a tag the emitter's
  vocabulary map doesn't know (e.g., a stray `{% quote %}`). The
  emitter has the documented default — emit inner text, warn to
  stderr — but if implementation forgets the default branch, the
  output silently omits content.
- **Test exists?** Will be added in Track 2 (one doctest exercising
  the unknown-tag branch is on the per-track audit/test list).
- **Handling exists?** Documented default.
- **Clear-or-silent?** Designed clear; depends on Track 2's
  implementation actually wiring the default.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — N/A; this subplan is infrastructure,
  not user-facing.
- **Stale ref** — N/A.
- **Two agents touching the same card** — N/A.
- **Hand-edit drift** — If a boxholder adds a new tag to
  `src/shared/markdoc-config.ts` without also adding a corresponding
  React component to `Markdown.tsx`, the frontend will render the
  tag as a fragment-with-children but without any tag-specific UI.
  Markdoc's renderer falls back to no-op for unknown component
  names. **GAP** — the symmetric case (new backend emitter entry
  without frontend component, or vice versa) is silent. Acceptable
  for now; would surface during dogfooding as visual oddities.
- **Fabricated free-form value** — N/A.
- **Validation error UX** — Markdoc's `validate()` runs against the
  shared config, so error messages mention tags by their canonical
  names regardless of side. Already works.
- **Partial migration / transition state** — N/A. The move is one
  commit; no in-flight bilingual state.

## Findings

No self-found findings beyond what's been folded in above.

## NOT in scope

- **Hoisting other helpers to `src/shared/`.** Only
  `markdoc-config.ts` moves now. Future shared modules land on
  demand. The existing `src/lib/` (backend-only helpers) stays
  backend-only — it's not retroactively converted to shared.
- **Frontend path aliases for backend imports beyond the existing
  `@backend/*`.** The current alias suffices; no expansion needed.
- **Per-platform tag schemas.** The Markdoc tag definitions are
  identical across frontend and backend. If the future requires a
  divergent schema (e.g., a tag the backend renders differently
  for some reason), we'll revisit; not anticipated.
- **A `packages/shared/` standalone package.** Within a single
  package (callback-box) `src/shared/` is the simpler shape. Promote
  to a separate package only if cross-package consumers appear.
- **Refactor of the existing `@backend/*` alias.** Works today;
  unchanged.
- **Markdoc format-based round-tripping for migration.** Track 2's
  briefing migration is hand-done by the agent; no automated
  round-trip needed. Documented here for when a future track might
  want it.

## Open design questions

1. **Markdoc.format() reliability on real bodies.** Experimental
   per upstream. We don't need it for any committed track, but
   future programmatic-edit work (Track 1 recipe migration, if it
   grows beyond hand-edit; or future migration tooling) would need
   confidence in round-trip fidelity. Validate by running
   `Markdoc.format(Markdoc.parse(body))` against a corpus of real
   briefing/recipe bodies before depending on it. Lean: defer
   until a track actually needs it.

2. **Should the backend get its own `@shared/*` path alias?**
   Adding it requires teaching `tsx` (the runtime) about the
   alias, which means a runtime registration step. Not blocking;
   relative paths work. Revisit if backend imports of shared
   modules become numerous.

## Knowledge audits

None for this subplan — purely infrastructural; no agent-facing
concept introduced. The Markdoc tag schemas this subplan moves are
already covered by the existing `quote` and `source` audits, and
those audits don't care where the schemas physically live.

Skip-with-rationale satisfies the cb-plan default.

## Implementation order

One chunk:

1. Create `src/shared/` directory.
2. Move `src/frontend/src/lib/markdoc-config.ts` →
   `src/shared/markdoc-config.ts` (git mv).
3. Add `@shared/*` path alias to `src/frontend/tsconfig.json` and
   include `../shared/**/*` in its `include` array.
4. Update the import in
   `src/frontend/src/components/Markdown.tsx` from
   `../lib/markdoc-config` to `@shared/markdoc-config`.
5. Update Vite config if needed (Vite respects tsconfig path
   aliases; verify).
6. Add a top-of-file comment to
   `src/shared/markdoc-config.ts` documenting the "pure TS, no
   platform APIs" rule.
7. Run `pnpm typecheck:all` and `pnpm lint` to confirm both sides
   resolve the new path.
8. Run the existing `card-lint.doctest.md` to confirm the
   backend body-refs path still works.

The subplan completes when both sides import the shared config and
the existing tests pass. No new functionality lands — the same code
just lives in a new location accessible to the future Track 2
backend emitter.

## Rollout shape

The subplan ships as part of the parent plan
(`markdoc-tags-plan.md`). No standalone ship. Knowledge audits
deferred (none needed). Doctests deferred (no new code paths;
existing tests verify resolution).

The migration is one commit. No bilingual state, no in-flight
fallback.

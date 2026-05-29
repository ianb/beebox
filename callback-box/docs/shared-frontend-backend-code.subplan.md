# Shared Frontend/Backend Code — Subplan

A subplan of `markdoc-tags-design.md`. The Markdoc work needs the same
tag schemas and types on both the frontend (React renderer) and
backend (server-side Markdoc → markdown emitter that `compileBriefing`
will use). This subplan covers how shared code is organized once and
reused both places.

## Context — why this is a subplan, not inline

Three reasons:

1. The decision about *where* shared code lives affects more than just
   Markdoc. Any future shared type (validation primitives, ref
   resolution, schema-instance shapes) will land in the same place.
   Worth choosing once.
2. The codebase currently has a hard frontend/backend split — two
   tsconfigs (per `callback-box/CLAUDE.md`: *"Two TypeScript configs.
   Backend uses the root tsconfig, frontend uses
   `src/frontend/tsconfig.json`"*). A shared module crosses that
   boundary and the crossing needs to be deliberate, not accidental.
3. Picking the location prematurely inside `markdoc-tags-design.md`
   would inflate that plan with infrastructure detail unrelated to its
   surface (tags + provenance). Subplan lets the parent plan stay
   focused on vocabulary.

## What it has to settle

- **Where shared code lives.** Candidates: a new `src/shared/`
  directory, `cardworks` (the sibling package callback-box already
  depends on, which has its own JSX support), or a thin re-export
  shim. Each has trade-offs around tsconfig, bundling, import depth.
- **What gets shared first.** The Markdoc tag/node config is the
  forcing function. Types from `markdoc-config.ts` need to be visible
  to both frontend and backend renderers. Sharing the *config object*
  itself (not just types) is the simplest move; the config has no
  React dependency.
- **The backend Markdoc → markdown emitter's location.** Probably
  alongside the shared config (`src/shared/markdoc-emit.ts` or
  similar), since it's the backend-only consumer of the shared config.
- **Tsconfig path mapping.** The shared directory needs to be visible
  to both tsconfigs. Verify by adding a no-op import on each side
  before committing to the structure.

## Status

**Stub.** This subplan has not been written yet. It's a placeholder so
the parent plan can link to it as a dependency.

When ready to write it, invoke `/cb-plan` against this file. The
parent plan's Track 2 (briefing → body Markdoc) is blocked on this
subplan completing — the backend Markdoc emitter Track 2 needs lives
on the shared side of the split.

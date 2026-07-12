---
title: "Consolidate the frontend's local helper copies into src/shared/"
area: callback-box
filed-by: agent
discovered-in: worktree-architectural-review — implementing the frontend import-boundary (clerk-contract-and-import-boundary.md Track 2)
design: ../../callback-box/docs/plans/clerk-contract-and-import-boundary.md
---

Track 2 of the import-boundary work stood up the pattern for sharing a value
between frontend and backend: put it in `src/shared/` (isomorphic, bundler-safe)
and import via `@shared/*` (Vite-only code) or a raw relative `../shared/…`
(code the doctest runner / `cb render` / the view-widgets esbuild bundle also
loads — see the exemption list in `src/frontend/eslint.config.mjs`). Now that
the pattern and the `@shared` alias exist, the frontend's hand-maintained
*copies* of helpers that already live in `src/lib/` (backend) are candidates to
collapse into `src/shared/` so there is one implementation.

Three copies to look at, in priority order:

- **`src/frontend/src/lib/is-record.ts` — the pilot.** The backend
  `src/lib/is-record.ts` (`isRecord`, the blessed `unknown → Record` guard per
  code-style.md) has a frontend twin. `isRecord` is pure and dependency-free, so
  it moves cleanly to `src/shared/is-record.ts` with both sides importing it.
  Do this one first and confirm the ergonomics before the other two.
- **`src/frontend/src/lib/invariant.ts`** and
  **`src/frontend/src/lib/error-guards.ts`** — each currently carries a
  deliberate "frontend counterpart" framing (a comment explaining why it's a
  separate copy). Re-check whether that rationale still holds after the pilot: if
  the backend `lib/invariant.ts` / `lib/error-guards.ts` are bundler-safe and
  behavior-identical, they should share a `shared/` module too; if the frontend
  copy genuinely diverges (e.g. different throwing/logging behavior in the
  browser), keep it and delete the "should consolidate" itch by documenting the
  divergence instead.

Watch-outs carried over from the Track 2 work:
- A `shared/` module may import a bundler-safe `lib/` module but nothing from
  `core/`/`schemas/`/`webapp/` and no `node:`-touching `lib/` (see
  `docs/module-map.md`, the `shared/ → lib/` note added in this work).
- If any consolidated module ends up loaded by the tap/tsx doctest runner or the
  view-widgets bundle, its consumers there must import it by raw relative path
  (the root tsconfig has no `@shared` alias) and get added to
  `OUTSIDE_VITE_SHARED_RAW` in `src/frontend/eslint.config.mjs`.

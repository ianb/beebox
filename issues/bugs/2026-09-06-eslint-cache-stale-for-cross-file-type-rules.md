---
title: "lint:changed's content-keyed eslint cache goes stale for type-aware rules that depend on another file"
workstream: add-files-inline
area: tooling
priority: backlog
labels: [lint, tooling, pre-commit]
filed-by: agent
discovered-by: agent
discovered-in: add-files-inline workstream — hit while changing a hook's return type
---

`bin/lint-changed.ts` runs eslint with `--cache` keyed on file *content*
(`node_modules/.cache/eslint/{backend,frontend}`). Type-aware rules don't
depend only on the file's own content: `@typescript-eslint/no-misused-promises`
on `A.tsx` depends on the declared type of a callback that lives in `B.ts`.
Change `B.ts` alone and `A.tsx`'s cached verdict is reused even though its
correct verdict flipped.

Observed: `InteractiveChat-actions.ts` changed `handleSend` from
`() => Promise<void>` back to `() => void`. `pnpm lint:changed` kept reporting
two `no-misused-promises` errors in `InteractiveChat-view.tsx` (unchanged
content) — while `pnpm exec eslint --no-cache <that file>` reported none.
Deleting `src/frontend/node_modules/.cache/eslint` cleared it.

Both directions are possible, and the false-pass one is worse: introduce a
misuse in `A.tsx` by changing a type in `B.ts`, and lint stays green — including
in the **pre-commit hook**, which uses the same cached path.

Options, roughly in order of appeal:

- Include the TS build state in the cache key (e.g. mix the project's
  `tsbuildinfo` hash into `--cache-location`, so any type-level change starts a
  fresh cache).
- Widen the file set: when a changed file is imported by others, lint the
  importers too rather than trusting their cached verdicts.
- Drop `--cache` for the type-aware pass and keep it only for the syntactic
  rules, if the split is cheap.
- Accept it, and document that a confusing lint result is cleared by removing
  the cache directory.

Not urgent for correctness of what's already landed — the full-tree `pnpm lint`
on a cold cache is unaffected — but it costs real confusion at the moment
someone changes a shared signature, which is exactly when they need lint to be
truthful.

**2026-10-19 (retrospective 20261019-230412):** Two more cases. A reverted
tsconfig `exclude` left the cache replaying parse errors for unchanged files
(`ts7/20261017T223802Z-implemented.md`). Parallel workers sharing one worktree
left phantom parse and `max-lines` errors that `eslint` on the same files did
not report; `finish-verify` labeled the failure "unchanged from main", which
pointed away from the cache (`bug-burndown-3/20261019T185933Z-landed.md`).
Deleting the cache directory cleared both. `beebox/AGENTS.md` now names that
step; the cache key is still the fix. The `backlog` priority may be stale now
that it recurs.

Re-reviewed 2026-10-30: the cache key in bin/lint-changed.ts is unchanged; the problem stands.

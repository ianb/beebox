---
title: "Fresh box lacks zod — box-local schemas silently fail to load"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-public-site — box-authored site page experiment
---

Every box-local schema imports `zod`, but a fresh box package's
`package.json` ships without it (test1's had only `callback-box`/`react`).
Loading then fails with only a warning — `Warning: failed to load box schema
…: Cannot find package 'zod'` — and cards of that type silently fall back to
"no schema registered": no validation, no instructions injected, nothing
blocking.

Two parts:

- **Template gap**: `cb init`'s box template should ship `zod` (or the
  box-local schema guide should say to add it).
- **Silent fallback**: a schema file that exists but fails to load is a
  broken invariant, not a degradation — cards of that type validate as if
  the schema were never written. Fail hard, or at minimum surface it in
  `cb health`/validate output rather than a load-time warning.

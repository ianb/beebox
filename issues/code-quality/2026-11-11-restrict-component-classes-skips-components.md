---
title: "restrict-component-classes does not run over components/, so restyling a primitive goes unchecked"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: "worktree-web-guidance-scan — ui-primitives-dedup plan, Track 1"
---

`personal-vibe-check/restrict-component-classes` limits a JSX element's
`className` to outer-layout classes (margin, padding, flex/grid item, sizing,
position). `beebox/src/frontend/eslint.config.ts` (the block near line 213)
sets `ignores: ["**/components/**"]`, so the rule never runs there. Appearance
classes on a primitive's call site are therefore unchecked inside `components/`.

The ui-primitives-dedup plan measured the rule over `components/`: 97 findings
in 39 files. The rule guards against restyling a primitive. It does not stop a
second copy of a primitive, so that plan does not depend on it and leaves it out
of scope (`beebox/docs/plans/ui-primitives-dedup.md`, "NOT in scope").

Decide:

- Run the rule over `components/` and fix the 97 findings. Some are real
  restyling that needs a primitive prop (a tone or a size), not a class.
- Or exempt the files that own a shape through a per-file `allowIn` list in the
  rule, as the plan does for its own guards. Engineering principles §11 asks for
  per-entry exceptions, not a directory-wide ignore.

Write a separate plan for either path. Re-measure the count first; it dates
from 2026-11-11 and the primitives plan changes many call sites.

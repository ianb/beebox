---
title: "Consider more Contract-Unchanged-style tripwires: heuristic checks overridable only by a justified trailer"
workstream: unattached
area: monorepo
needs: [decision]
labels: [git, hooks, process]
filed-by: agent
discovered-by: Ian
discovered-in: commit-provenance workstream — reviewing what Contract-Unchanged does
---

`Contract-Unchanged` (`.husky/pre-commit` + `.husky/commit-msg` +
`bin/mobile-contract-check.ts`) is a specific shape: a **heuristic** check that
can false-positive, so a hard block is wrong and `--no-verify` is worse; the
override costs one sentence in a trailer and stays in history forever.
`git log --grep='^Contract-Unchanged:'` lists every time someone claimed the
surface did not change, reviewable later. Nothing reads the reason at commit
time; the value is that it is permanent and greppable.

Not scheduled. Candidates where the same shape has teeth:

- **Card-shape change without a migration** — a `schemas/` edit with no
  migration staged → `Migration-Unneeded: <reason>` (additive field, new
  schema). See the `cb-migration` skill.
- **Test removal** — a deleted `.test.ts`/`.doctest.md` or an added `.skip(`
  → `Test-Removed: <reason>`. Today invisible.
- The clerk-contract staleness gate, if it ever false-positives.

Where it does not fit:

- Exact checks (`path-leak-check`, `commit-blocklist-check`) — there is no
  legitimate "it's fine".
- Lint suppressions — the inline `-- <justification>` already does this.
- Anything policy says to ask a human about (rule changes, dep majors) — a
  trailer cannot replace the ask.

It must stay rare. A trailer on a large share of commits is a habit, not a
justification; if one starts appearing often, the check is wrong, not the
override.

## Related

- [Commit trailers for workstream/issue/plan](../closed/decisions/2026-08-24-commit-trailers-for-workstream-issue-plan.md)
  — the other trailer family, descriptive rather than an override.

---
title: "A migration's leftover work must exit partial so the repair agent picks it up"
workstream: retire-memo
area: beebox
filed-by: agent
discovered-by: boxholder
discovered-in: worktree-retire-memo — after retire-memo-2026-10 ran on production
resolution: implemented
---

`retire-memo-2026-10` found box code that still named memo cards. It printed
`warning: <path> names memo cards; it needs updating by hand after this
migration` and exited 0 (`src/scripts/migrate/retire-memo/run.ts`,
`codeWarnings`). The warning reached only the deploy log. On the personal box
on production, a view's dependency glob and a mockup card's styling rules stayed
broken until someone fixed them by hand.

The fallback already exists. A script that exits `SOFT_FAILURE_EXIT` (2,
`src/core/migration-run.ts`) leaves the migration pending, and the hourly
`--sweep --repair` pass gives it one bounded agent repair. The runner then
reruns the script to confirm the repair (`src/core/migration-sweep.ts`,
`convert`; `docs/cards/migrations.md`, "Exit 2 means per-card partial
conversion"). A warning that exits 0 bypasses that fallback. It works like
`|| true`.

Boxholder direction (2026-10-16): almost every migration should have the agent
fallback. It applies whenever the migration reports problems. It does not apply
when the migration swallows its errors.

## What to change

- **Rule in `docs/cards/migrations.md`:** work a migration knows it left
  undone exits 2 and names the paths. It is never a warning with exit 0. The
  rerun must detect the same leftover, so the repair can be confirmed.
- **retire-memo:** turn the `codeWarnings` lines into an exit-2 result. Two
  local boxes have not run it yet. Also widen
  the check from code alone to any card that names `.memo.card` in a field
  such as a glob. A paper-mockup card's `rules[].match` was missed.
- **Audit the other script migrations** for exit-0 warnings. The current
  scripts (`body-tags`, `briefing-openers`, `agents-md`) already report their
  "by hand" cases as failures.

## Open question

The repair directive (`src/core/migration-repair-policy.ts`) says "Repair only
box data relevant to this migration failure." Check that an agent is willing to
edit box `src/` views under that wording. If it is not, the wording needs a line
for box code.

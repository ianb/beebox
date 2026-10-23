---
title: "Two card filename parsers give different answers for job and positional cards"
workstream: unattached
area: beebox
labels: [code-quality, cards]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-backend — backend pass of the functional-duplication sweep
resolution: implemented
---

Closed 2026-10-23 by commit ecf0cc24b (worktree-dup-sweep-backend): `parseCardName` now returns `cardBasename` as its name and `parseCardFileName`'s type. The audit found the old name always equal to `cardBasename`; only a job card's type changed, from `job` to its schema type.

`parseCardFileName` (`beebox/src/shared/card-name.ts:27`) is the tested card
filename grammar. `parseCardName` (`beebox/src/lib/paths/core.ts:158`) is an
older parser with 6 callers: `core/state.ts`, `core/commands/trash/command.ts`,
`core/commands/create.ts`, `webapp/trpc/routers/status.ts`,
`webapp/routes/api/register/browse.ts`, `cli/tick-utils.ts`.

They differ in two cases:

- A job card `Foo.intake.job.card`: `parseCardName` gives name `Foo.intake`,
  type `job`; the canonical parser gives name `Foo`, type `intake-job`.
- A positional card `doc.card`: `parseCardName` gives name `doc`, type `doc`;
  the canonical parser gives name null.

`parseCardName`'s own comment says callers depend on the flat split and asks
for an audit before unifying. The sweep did not do that audit: each caller
needs a check of what it does with a job card's type and a positional card's
name (for example, whether the browse listing shows the type as the name).

Related: [card filename dotted segments](../../decisions/2026-09-05-disallow-dots-in-card-names.md).

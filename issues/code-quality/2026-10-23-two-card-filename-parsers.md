---
title: "Two card filename parsers give different answers for job and positional cards"
workstream: unattached
area: beebox
labels: [code-quality, cards]
filed-by: agent
discovered-by: agent
discovered-in: worktree-dup-sweep-backend — backend pass of the functional-duplication sweep
---

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

Related: [card filename dotted segments](../decisions/2026-09-05-disallow-dots-in-card-names.md).

## Attempt and revert (2026-10-23)

Commit ecf0cc24b rebuilt `parseCardName` on the canonical pieces (name from
`cardBasename`, type from `parseCardFileName`) and was reverted in 97d4dcfb5.
The name part is safe: the old name always equals `cardBasename`. The type is
not, because callers use it for three different things:

- **Filename reconstruction.** `core/commands/trash/command.ts` builds a
  collision name as `${name}_${timestamp}.${type}.card`. With the schema type,
  a second trashed `Foo.intake.job.card` would become
  `Foo.intake_<ts>.intake-job.card` and drop out of the reactor's `.job.card`
  scan. This caller needs the raw last segment.
- **Schema lookup.** The browse listing (`webapp/trpc/routers/status.ts`)
  passes the type to `cardEffectiveProminence`; with `job` a job card falls
  back to ordinary, with `intake-job` it takes the schema's `background`.
- **Template lookup.** `core/commands/create.ts` and `cli/tick-utils.ts`
  look up a default template by type. No built-in template exists for either
  form, but a box-local template registered for `intake-job` would start
  matching.

A merge has to decide per caller which of "last filename segment" and
"schema type" it means, and whether job cards should appear as background in
browse.


---
title: "browser-task follow-ups: cadence, history and subject, review table"
status: implemented
workstream: browser-tasks
issues:
  - ../../../issues/closed/features/2026-09-13-browser-task-cadence-and-staleness.md
  - ../../../issues/closed/features/2026-09-13-browser-task-history-and-subject.md
  - ../../../issues/closed/features/2026-09-13-browser-task-inbox-table-view.md
---
# browser-task follow-ups: cadence, history and subject, review table

When a feed task has not run in a month, I want the box to say so and put it
in front of me, so a standing subscription does not depend on my memory.
When I open a task, I want to see what the last scans covered and which
subject it is about, so three tasks about one potter read as one thing. When
a batch arrives, I want to review it as a table, so the judgment step is a
glance and not a JSON blob.

**Issues addressed:** the three listed in the frontmatter, all filed from
the first real run of `beebox/docs/implemented-plans/browser-task-card.md`.

## Smallest fix and budget

Smallest fix: none of this is a bug; each is a feature the first run showed
missing. The smallest version of each: a `rescan-after` field the view
compares against `last-upload`; a `runs` list the drain appends to; a
`subject` ref; and a table over `records.json` with columns from the schema.
That is what this plan builds. Budget: about 450 source lines (one shared
state module, one core lister, one tRPC query, three view components, one
dashboard card) and 120 test lines. No new subproject.

## Stated preferences this plan trades against

- Principle 8, one way: the duration grammar and parser move from
  `schemas/question.ts` to `shared/iso-duration.ts` so the browser can use
  them; the question schema re-exports. One implementation, two consumers.
- Principle 10, testability: the "is it due" judgment is a pure function
  (`shared/browser-task-state.ts`) with its own doctest; the view and the
  dashboard call it rather than reimplementing it.
- "Arrange context, don't automate judgment": the cadence makes a due task
  visible on the dashboard; nothing runs it. The executor is still a person.

## What already exists

- `parseIso8601DurationMs` and `IsoDuration` in `beebox/src/schemas/question.ts`
  (moved, re-exported).
- Dashboard attention cards, `beebox/src/frontend/src/components/dashboard/AttentionCards.tsx`,
  the pattern for a "things to act on" list; gains a third card.
- `Accordion` and `JsonView` primitives for the expandable table rows.
- The drain procedure already knows every number a run entry needs.

## Prior art (external)

No decision here depends on an external premise.

## Tracks / scope

1. **Cadence.** `rescan-after` (ISO-8601 duration) on the card;
   `shared/browser-task-state.ts` derives closed, never-scanned, scanned,
   current, or due; `core/browser-task/list.ts` walks `_content` for task
   cards; `browserTask.list` exposes them; the dashboard lists due and
   never-scanned tasks; the view shows the state as a badge.
2. **History and subject.** `runs: [{ batch, at, scanned, kept, filed,
   skipped, reason, stoppedAt, note? }]`, appended by the drain (which
   previously wrote a body line); `subject: { ref }`; the view renders a runs
   table and a subject link.
3. **Review table.** `BatchList` renders each batch as a table whose columns
   are the record schema's short scalar properties, name-like and date-like
   first, and each row expands to the full record. Filed indices are marked.

Vocabulary lock-ins: `rescan-after`, `subject`, `runs` and its entry shape;
`browserTask.list`.

## Could this be simpler?

The cadence could be prose in the prompt, as the bound was; it failed the
same way (nothing could check it). The runs history could stay a body line;
a table and a cadence check both need it as data. The table could be a
fixed set of columns; the pottery schema is one of many, so it reads the
schema.

## Subplans

none.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Malformed `rescan-after` on disk | state doctest | reads as "scanned, no cadence"; `bbx validate` rejects it at write | clear |
| Malformed `last-upload` | state doctest | reads as never scanned | clear |
| A task card that fails to parse during listing | none | skipped with a console warning; `bbx validate` owns the report | visible in logs only |
| Records with keys the schema does not name | none needed | columns come from the schema; extra keys show in the expanded row | clear |
| Drain appends a malformed run entry | schema doctest rejects the shape | the card fails validation at its next commit | clear |

## Agent-flow / user-flow edge cases

- Wrong field: an agent writes `rescan-every`. GAP by design: unknown keys
  are lint warnings, not errors; the card reads as no cadence.
- Two agents: drain appends to `runs` while the boxholder toggles status.
  ADDRESSED by the card lock on both writes.
- Hand-edit drift: a run entry typed by hand with a wrong reason. ADDRESSED:
  schema rejects at validate.

## NOT in scope

- Automatic runs. The cadence surfaces a due task; a person still runs it.
- A structured `subject` beyond one ref.
- Editing records in the table. Review is read-only; filing is the drain's.

## Open design questions

none.

## Knowledge audits

The existing `browser-task-authoring` audit still covers the card; the new
fields are documented in the schema instructions. No new concept for an
agent to discover; skipped with that rationale.

## What will hold this after it ships

Doctests: `test/shared/browser-task-state.doctest.md` (the judgment),
`test/schemas/browser-task.doctest.md` (the fields), and
`test/webapp/trpc-browser-task.doctest.md` (the listing). The view has no
automated tier beyond typecheck and lint; one screenshot exhibit.

## Implementation order

One commit for all three tracks; they share the view and the schema.

## Rollout shape

New optional fields, no migration. The drain's `## Runs` body-line
instruction is replaced by the `runs` entry; cards from the one prior drain
keep their body line and simply have no `runs` yet.

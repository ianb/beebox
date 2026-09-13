---
title: "browser-task: render an inbox batch as a reviewable table, not a 38 KB JSON blob"
workstream: browser-tasks
area: beebox
priority: normal
labels: [browser-task, frontend, views]
filed-by: agent
discovered-by: the mn-pottery box agent, in its report on the first real run
discovered-in: worktree-browser-tasks — first Facebook page scan (2026-09-12)
---

The step that needs the most judgment is reviewing a batch before it is
drained: which records are in scope, which are duplicates, which dates are
unsure. Today a batch is a `records.json` of tens of kilobytes, and the box
agent wrote a one-off script to print a table when the boxholder asked to
"check it out".

Wanted: the task view (or the batch's `records.json` opened from it) renders
records as a table — date, kind, name, confidence, group — with each row
expandable to its notes and raw text, and the coverage line above it. The
columns come from the task's own schema, so the view has to be
schema-driven, not hard-coded to one box's fields.

The mn-pottery box agent offered to prototype this view in the box first.
That is a reasonable way to find the right columns before it ships upstream.

## Related

- `beebox/docs/implemented-plans/browser-task-card.md`

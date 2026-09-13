---
title: "browser-task: scan history on the card, and a link to the subject the task is about"
workstream: browser-tasks
area: beebox
priority: normal
labels: [browser-task]
filed-by: agent
discovered-by: the mn-pottery box agent, in its report on the first real run
discovered-in: worktree-browser-tasks — first Facebook page scan (2026-09-12)
---

Two gaps the first real run showed on the card itself.

**No scan history.** After a drain the card keeps only `watermark` and
`last-upload`. "What did our last three scans cover?" means opening the
processed batches one by one. The drain procedure now appends a one-line run
summary under a `## Runs` heading in the body, which is a stopgap; the durable
answer is structured history (a `runs:` list or a small run card per batch)
that the view can render as a table and a cadence check can read.

**No link to the subject.** One potter has a Facebook page, an Instagram, and
a website: three tasks with nothing saying they are the same person. A
`subject: { ref }` field pointing at the person or organization card would let
the drain dedupe across tasks and let the person card list its tasks.

## Related

- `beebox/docs/implemented-plans/browser-task-card.md`
- the cadence issue filed alongside this one

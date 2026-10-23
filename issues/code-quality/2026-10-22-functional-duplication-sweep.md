---
title: "A sweep for code that does the same job twice, in two passes: frontend and the rest"
workstream: unattached
area: beebox
labels: [code-quality]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder idea while planning quota work, 2026-10-22
---

Agents write most of the code, often without finding a helper that already
does the job. The result is functional duplication: two implementations of one
behavior with different names and shapes. Text-level clone detection misses
most of it. Each copy drifts, and a fix lands in one copy only.

Known instances already filed:
[fold search and browse summaries onto summarize](2026-09-20-fold-search-and-browse-summaries-onto-summarize.md),
[one way to log everywhere](2026-07-04-logging-consolidation.md),
[chat session shared core](../closed/code-quality/2026-07-06-chat-session-shared-core.md).
The [what-can-we-remove sweep](2026-09-14-what-can-we-remove-sweep.md) is a
neighbor: it removes code with no purpose. This sweep merges code with one
purpose and two implementations.

## Proposed shape

Two passes, because the duplication differs:

- **Frontend** (`beebox/src/frontend/`): components and hooks that render or
  manage the same thing (lists, chips, empty states, loading and error states,
  card summaries, date formatting, fetch-and-subscribe hooks).
- **Everything else** (`beebox/src/` outside the frontend, `bin/`,
  `workstreams-app/`): path and slug helpers, git wrappers, card parsing and
  frontmatter access, retry and timeout logic, process spawning, config
  loading, connector plumbing.

Each pass: inventory by behavior (what the code does, not what it is named),
pick the canonical implementation, migrate callers, delete the rest, with
tests on the canonical one. Merges that change behavior for a caller, or where
the canonical choice is a design question, get filed instead.

Not started. The boxholder suggested it for a later batch of autonomous
sessions (2026-10-22).

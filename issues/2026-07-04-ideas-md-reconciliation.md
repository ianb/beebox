# ideas.md ↔ issues/ reconciliation (for the agent working on ideas.md)

2026-07-04 · handoff note — the docs-reorg session did not touch ideas.md
after learning another agent owns it; this describes what that session
added earlier (already committed) and what now overlaps with issues/.

Added to ideas.md by the docs-reorg session on 2026-07-04, before the
hands-off rule:

1. A `## Small backlog (2026-07)` section near the top with four entries:
   webapp card-mutation concurrency, logging consolidation, an SSR
   `useSSRMachine` lint-rule idea, and the knip unused-exports backlog.
2. A `## CLAUDE.md / docs backlog (from CLAUDE-MD-REVIEW, 2026-04)` section
   — 8 items extracted from the deleted CLAUDE-MD-REVIEW.md.
3. A git-replay-testing entry salvaged from the retired implementation.md.

Since then, two of the Small-backlog entries were promoted to issue files
and now have their fuller write-ups there:

- webapp mutation concurrency → `issues/2026-07-04-webapp-mutation-concurrency.md`
- logging consolidation → `issues/2026-07-04-logging-consolidation.md`

Suggested reconciliation (owner's call): drop or shrink those two ideas.md
entries to one-line pointers at the issue files, so each item has one home.
The SSR-lint-rule and knip entries have no issue file — ideas.md remains
their home (knip is also noted in code-style.md's export rule, as a
pointer, not a duplicate).

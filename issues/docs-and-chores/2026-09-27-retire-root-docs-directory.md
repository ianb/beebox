---
title: "Retire the root docs/ directory: move the Agent SDK ledger into beebox/docs/, delete the lint audit and the map"
workstream: unattached
area: docs
labels: [docs]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
priority: important
---

The monorepo root has a `docs/` directory that holds only three leftover
files. It arrived with the May import of the old repository and has no job
of its own. The developer decided (2026-09-27):

- **`docs/agent-sdk-notes.md` moves to `beebox/docs/`.** It is the Agent
  SDK release ledger (about 200 KB, newest first). The daily `sdk-update`
  schedule maintains it, and its run script parses the file's "Latest
  reviewed upstream version" line to decide whether to start a session.
- **`docs/reports/eslint-rule-suppression-audit-2026-05-30.md` is
  deleted.** It is a finished historical report. Git history keeps it.
- **`docs/README.md` is deleted.** It is a documentation map that mostly
  repeats the routing in the root `CLAUDE.md`. Move any line it has that
  `CLAUDE.md` lacks.

Then remove the `docs/` directory.

## References to update

Found with a repository search on 2026-09-27. Search again before the move.

- **Code and schedule, which `doc-check` cannot see:**
  `schedules/sdk-update/run.ts` (the ledger's path),
  `schedules/sdk-update/prompt.md`, and `beebox/eslint.config.ts` (links
  the audit).
- **Guidance:** `beebox/code-style.md` (links the audit twice, in the lint
  suppression rules). Replace the link with the rule itself, or drop it.
- **Tests:** `workstreams-app/test/file-index.doctest.md`.
- **Docs:** `beebox/docs/doc-graph.md` (regenerate it),
  `beebox/docs/implemented-plans/docs-reorg.gap-analysis.md`,
  `beebox/docs/implemented-plans/prompt-calibration.md`.
- **Issues:** several open and closed issues link the ledger. Run
  `pnpm --dir beebox doc-check --fix` after the move, which repairs links
  to a moved file by basename.

Follow the doc-move procedure in `beebox/docs/README.md`: moves need
repoints that `doc-check` does not see.

## Also consider

The ledger grows every day. When it moves, decide whether to archive
entries older than some cutoff, keeping the reviewed-version marker line in
the format the run script parses.

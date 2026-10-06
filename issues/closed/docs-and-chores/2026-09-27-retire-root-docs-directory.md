---
title: "Retire the root docs/ directory: move the Agent SDK ledger beside its schedule, delete the lint audit and the map"
workstream: retire-root-docs
resolution: implemented
area: docs
labels: [docs]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder discussion, 2026-09-27
priority: important
---

**Closed.** Implemented in 41ca5601a (move) and 514999dbf (ledger header). Divergence: the ledger landed in `schedules/sdk-update/`, not `beebox/docs/`, because anything under `beebox/` deploys and the schedule commits ledger-only changes most days.

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

## Next-action note (2026-10-06)

A `do-it` request was set. Changed to `discuss`: it still holds, but it is about 30 files of mechanical path edits plus three deletions, beyond an inline fix. The one breakage doc-check cannot see is `schedules/sdk-update/run.ts` (its `LEDGER` path constant). It follows the doc-move procedure in `beebox/docs/README.md`. Ready to hand to a small session if wanted.

## Decision (2026-10-06)

Approved. Run by an Opus session because the developer wants each moved document to make sense in its new location, not just a mechanical path change. Assigned to the `retire-root-docs` workstream.

## Resolution (2026-10-06)

- **The ledger moved to `schedules/sdk-update/agent-sdk-notes.md`, not
  `beebox/docs/`** (developer's choice when asked). Any change under
  `beebox/` deploys to production (`bin/deployed-paths.ts`), and the schedule
  lands a ledger-only commit on many days, so `beebox/docs/` would have turned
  each of those into a deploy and restart. Beside the run script and prompt
  that own it, the ledger keeps its basename, and ledger-only commits still
  ship nothing. No archiving cutoff: the prompt treats old entries as
  regression evidence.
- **The lint audit's history is now three sentences in `beebox/code-style.md`**
  ("Lint rule suppression"), and the two `beebox/eslint.config.ts` comments
  point there. Git history keeps the full report.
- **Every line of `docs/README.md` already had a home** in
  `beebox/docs/README.md`, `beebox/CLAUDE.md`, `research/CLAUDE.md`, or the
  root `CLAUDE.md`, so nothing moved into `CLAUDE.md`. The root `README.md`
  now points at `beebox/docs/README.md`.
- Verified: `bin/schedules run sdk-update --dry-run` reads the baseline
  (`0.3.290` / `2.1.290` / `0.160.1`) from the new path.

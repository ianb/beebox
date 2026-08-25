---
title: "bin/issues: orphans, --stale, and lint subcommands"
workstream: unattached
area: bin
filed-by: agent
discovered-by: agent
discovered-in: "worktree-beads-vs-issues — comparing Beads' hygiene commands against bin/issues"
---

Three queries `issues/CLAUDE.md` implies but nothing runs. Source:
[Beads vs. our issues/ queue](../../research/beads-vs-issues.md) §2.2, §2.7, §2.9.

## 1. `bin/issues orphans`

List open issues that an `Issue:` commit trailer on `main` already cites, with
the citing commits. An open issue with commits against it is either done and
not closed, or partly addressed; today neither is visible. `bin/commit-provenance.ts`
already parses the trailers. No `--fix`: closing stays a `/finish` or
`cb-issue-actions` judgment.

## 2. `bin/issues list --stale <days>`

Filter by last git touch of the file (`git log -1 --format=%ci -- <path>`),
not by filing date. `cb-pick-issues` says to "check what's stale"; the only
filter is `--since`, which reads the filename date. A query, not a status
and not a timer.

## 3. `bin/issues lint`

Check the invariants the conventions state and nothing enforces:

- `needs: [manual-testing]` ⇒ a `## Manual testing` section and the
  `> **⏳ Awaiting manual testing**` headline blockquote.
- Under `closed/` ⇒ `resolution:` present; open ⇒ absent.
- `## Research (incomplete)` older than N days is reported, not failed.

Not per-category required sections; body conventions are judgment.

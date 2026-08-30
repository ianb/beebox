---
title: "Resolves: commit trailer, bin/issues orphans, and doc-check issue invariants"
workstream: unattached
area: bin
filed-by: agent
discovered-by: agent
discovered-in: "worktree-beads-vs-issues — comparing Beads' close/orphans commands against our Issue: trailer"
---

Source: [Beads vs. our issues/ queue](../../research/beads-vs-issues.md) §2.7, §2.9.

## 1. `Resolves:` trailer

`Issue: <basename>` means "this commit serves the issue." Add
`Resolves: <basename>` (optionally `Resolves: <basename> wontfix|superseded`;
default implemented) meaning "this commit closes it." Then:

- `/finish` performs the `git mv` to `closed/` and writes `resolution:` from
  the branch's trailers, instead of from the plan's "Issues addressed" list.
- `pnpm commit-provenance --issue <name>` reports which commit resolved it.
- The existing trailer validator (a name matching nothing under `issues/`
  blocks the commit) covers the new trailer.

The file move stays the status; the trailer is the input that drives it.

## 2. `bin/issues orphans`

Open issues cited by an `Issue:` or `Resolves:` trailer on `main`, with the
citing commits. Done-but-not-closed, or partly addressed; neither is visible
today. No `--fix`: closing is a `/finish` or `bbx-issue-actions` judgment.

## 3. Invariants in `doc-check`

Not a separate lint (developer, 2026-08-25). `doc-check` already parses every
issue's frontmatter; add: `needs: [manual-testing]` ⇒ a `## Manual testing`
section exists; under `closed/` ⇔ `resolution:` present.

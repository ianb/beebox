---
name: issues
description: Explains the monorepo's issue/idea queue at issues/ (and the private-issues/ counterpart) — what it's for, when to file, and how filing works. Use when you notice a bug, idea, or tension outside your current task worth keeping; when the human says "file an issue", "add this to the queue", "track this", or "worth keeping"; or when closing/reclassifying an existing item. Triggers include "file this", "add to the issue queue", "close this issue", "is there already an issue for X". Full conventions in issues/CLAUDE.md.
---

# The issue queue

The conventions live in **`issues/CLAUDE.md`** — read it before filing,
amending, closing, or reclassifying anything. Nothing here adds to it.

What it covers, so you know what there is to look up: the seven category
directories and how to pick one; the frontmatter fields and who owns each
(`priority:` and `next-action:` are the developer's, `needs:` gates like
`manual-testing` have strict entry/exit rules, `discovered-in:` is provenance
not ownership, `workstream:` is rarely meaningful); title and cross-link
conventions that `doc-check` enforces; body style (STE, tensions not
resolutions, `## Research` sections); what to do when you **re-encounter** an
already-filed issue; closing and reopening, including `resolution:` values;
the private-issues repo and the never-public rule for real-box work; and the
agent-specific rules for taking on and filing issues.

Two commands you will need from it:

- `bin/issues search --all "<what you saw>"` before filing — a match (open
  or closed) is a re-encounter, which has its own rules there, not a new file.
- `git mv` into `closed/<category>/` + `resolution:` to close, then
  `pnpm --dir callback-box doc-check --fix`.

Private content goes to `private-issues/` (separate repo; commit from inside
it) — when unsure, ask before filing publicly.

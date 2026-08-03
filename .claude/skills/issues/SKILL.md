---
name: issues
description: Explains the monorepo's issue/idea queue at issues/ (and the private-issues/ counterpart) — what it's for, when to file, and how filing works. Use when you notice a bug, idea, or tension outside your current task worth keeping; when the human says "file an issue", "add this to the queue", "track this", or "worth keeping"; or when closing/reclassifying an existing item. Triggers include "file this", "add to the issue queue", "close this issue", "is there already an issue for X". Full conventions in issues/CLAUDE.md.
---

# The issue queue

A pointer skill: the queue exists and this is when/how to use it. Full
conventions — frontmatter fields, body style, closing/reclassifying,
private-issues mechanics — live in `issues/CLAUDE.md`; read it before filing
anything nontrivial.

## What it is

`issues/` is a **parking lot for tensions, not resolutions** — half-thought-out
ideas, noticed problems whose fix isn't obvious, questions needing research.
Filing an item is **not** license to implement it; research/design is real
progress, implementation happens when the boxholder chooses it.

## When to file

Something you can just fix in your current task — fix it, don't file it. File
when what you noticed is **outside your current work**, or the right fix is
genuinely unsettled. Filing is discretionary, no thresholds or quotas — but
don't file trivia you'd be embarrassed to see triaged.

## How

1. Grep the tree first — extend a matching item rather than duplicating.
2. Pick a category directory (`bugs/`, `features/`, `code-quality/`,
   `docs-and-chores/`, `decisions/`, `exploration/`, `watch/`) — the directory
   *is* the category, no `type:` field.
3. Decide public vs `private-issues/` — anything about a person's own boxes,
   personal/operational specifics, or non-public identifiers goes private.
   **When unsure, ask before filing publicly.**
4. File one `<category>/YYYY-MM-DD-<slug>.md`, `title:` in frontmatter (not an
   H1), plus `filed-by: agent` and `discovered-in: <worktree — what you were
   doing>`.
5. Private issues are a separate repo — commit them from *inside*
   `private-issues/`, never `git add -A` at the monorepo root.

## Closing

`git mv` the file into `closed/<category>/`, add `resolution:` and a short
closing note. Then run `pnpm --dir callback-box doc-check --fix` to repair any
inbound links broken by the move.

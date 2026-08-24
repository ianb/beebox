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

1. Search first: `bin/issues search --all "<what you saw>"` (hybrid
   keyword + semantic over open *and* closed issues) plus a grep for the
   file/symbol names. Read every plausible hit — titles are an index, not
   evidence. A match means you are **re-encountering** an issue, which has
   its own rules (`issues/CLAUDE.md` → "Re-encountering an issue"): amend it
   with a dated sighting; if it carries `needs: [manual-testing]` the sighting
   proves it isn't fixed, so drop that label; if it's closed, reopen; if it has
   a low priority, flag `next-action: discuss` rather than re-prioritize.
   Only file new when nothing describes it.
2. Pick a category directory (`bugs/`, `features/`, `code-quality/`,
   `docs-and-chores/`, `decisions/`, `exploration/`, `watch/`) — the directory
   *is* the category, no `type:` field.
3. Decide public vs `private-issues/` — anything about a person's own boxes,
   personal/operational specifics, or non-public identifiers goes private.
   **When unsure, ask before filing publicly.**
4. File one `<category>/YYYY-MM-DD-<slug>.md`, `title:` in frontmatter (not an
   H1), plus `workstream: unattached`, `filed-by: agent`, `discovered-by:` (the
   person or agent that first identified it), and
   `discovered-in: <worktree — what you were doing>`. `filed-by:` records who
   created the issue file; `discovered-by:` records the source of the finding;
   `discovered-in:` records where it was noticed. None assigns ownership. Set
   `workstream:` to a bare workstream name only when that workstream explicitly
   takes responsibility for resolving the issue. Never use the backfill-only
   `unknown` sentinel for a new issue.
   Add `priority: important` only when the issue deserves prominent review, or
   `priority: backlog` when it is intentionally deprioritized. Omit the field
   when nobody has categorized its priority yet; omission does not mean normal.
5. Private issues are a separate repo — commit them from *inside*
   `private-issues/`, never `git add -A` at the monorepo root.

## Closing

`git mv` the file into `closed/<category>/`, add `resolution:` and a short
closing note. Then run `pnpm --dir callback-box doc-check --fix` to repair any
inbound links broken by the move.

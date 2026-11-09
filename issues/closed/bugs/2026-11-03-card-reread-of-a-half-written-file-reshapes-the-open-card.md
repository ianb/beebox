---
title: "An open card that re-reads its file mid-write can show a broken or empty card, then remount when the write completes"
workstream: contents-menu-stable
area: beebox
labels: [frontend, cards, stability]
filed-by: agent
discovered-by: agent
discovered-in: "worktree-contents-menu-stable — code trace while hunting card body remounts"
resolution: wontfix
---

**Closed (wontfix, 2026-11-06):** Not reproduced (in-place, atomic-rename, and real agent edits on the dev box), and it needs a read to land inside a write. Runtime lint (beebox/docs/implemented-plans/runtime-lint.md) is on for dev and hosted boxes: if a half-written read remounts the card body, it logs content-replaced in the box's client-debug.log. Reopen if those lines show it.

An open card re-reads its file on every `file-change` event
(`beebox/src/frontend/src/components/file-view-data.ts`, `resync`). If the
read lands while a writer is part-way through a non-atomic write, `card.get`
returns what it found. `beebox/src/webapp/trpc/routers/card.ts` (after
`splitCardContent(raw)`) says: *"this is a malformed or partially-written
file — surface its raw text rather than failing"*. It then returns
`frontmatter: undefined` and the raw text, or an empty body.

The open card then shows the wrong shape for one read. Its title, theme, and
fields drop out, or an empty body becomes "No body content"
(`MarkdownCardView/CardBody.tsx`). The next good read puts the card back.
Each change of shape remounts the card body, which resets embeds and moves the
reader's place.

Not reproduced. In-place `sed -i`, `mv` over the file, and a real chat agent's
edits on the dev box did not show it. The window depends on how the writer
writes (truncate, then write) and on disk speed.

Related: [the contents-menu issue](2026-11-03-card-contents-menu-collapses-and-reappears.md),
where a failed re-read (file missing) caused the same remount. That case is
fixed because the "out of date" notice now keeps the body in place.

## Research (incomplete)

- Which box writers are not atomic: the agent's file tools, `bbx` verbs, the
  webapp mutation routes, sync tools.
- Whether the client could keep the last good card when a re-read returns
  "no frontmatter" for a file that had frontmatter a moment before, and
  re-read again after a short delay.

---
description: "Two-way syncs Google Docs and Sheets into the box, mirrors Drive folders, or just points at a Drive item without copying it."
---
# Google Drive

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. The Drive connector brings Google Drive content into the box in three
different ways, each a different kind of card.

**What it does for you**

- Mirrors a Google Doc as markdown, two-way: edits in Drive pull in, edits in
  the box push back, with a conflict warning if both changed.
- Mirrors a Google Sheet as per-tab JSON, also two-way.
- Mirrors a whole Drive folder's membership into a box directory, so new
  files added there show up automatically.
- Lets you point at a Drive item without copying it, when you just want the
  box to know it exists and why it matters.
- Lets you preview a Drive file before mounting it.

**What it needs**

A Google account, connected by signing in with your Google account and a
one-time setup, shared with Gmail and Calendar, plus the Drive service turned
on for the box. See the install directory:
[../install/index.md](../install/index.md).

**How it works, briefly**

A synced Doc becomes a `gdoc` card, a synced Sheet a `gsheet` card, a
mirrored folder a `gfolder` card, and a pointer-only item a `glink` card.
Sync runs automatically or on demand (the underlying command is `bbx wakeup
--connector drive`); a Doc or Sheet push back to Drive detects when the
remote changed first and reports a conflict rather than overwriting silently.

**Limits**

There is no picker for not-yet-mounted Drive folders in the setup UI; you
paste the Drive URL yourself. A synced Doc's markdown export can lose
formatting Google Docs supports and none of Bee Box's format does; the box
tells you when that happens rather than hiding it.

**Go deeper**

[../reference/connectors.md](../reference/connectors.md),
[../reference/cards/gdoc.md](../reference/cards/gdoc.md),
[../reference/cards/gsheet.md](../reference/cards/gsheet.md),
[../reference/cards/gfolder.md](../reference/cards/gfolder.md),
[../reference/cards/glink.md](../reference/cards/glink.md)

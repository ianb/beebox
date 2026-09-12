---
description: "Mirrors your Google Calendar into plain .ics files in the box, and can push locally-made changes back."
---
# Calendar

A box is a directory of your data kept in git; a card is a markdown file with
structured frontmatter; the agent is the coding agent (Claude Code or Codex)
that operates the box. The calendar connector syncs Google Calendar into the
box as plain calendar files.

**What it does for you**

- Pulls your Google Calendar events into the box as individual `.ics` files,
  one per event, readable and editable as plain text.
- Lets the agent read your agenda from the box's own copy instead of calling
  Google every time.
- Supports creating, editing, and deleting events by editing files, which
  push back to Google on sync.
- Recurring events are stored as one file with a recurrence rule, so a
  weekly meeting is not hundreds of separate files.

**What it needs**

A Google account and its OAuth consent, shared with the Gmail and Drive
connectors. See the install directory: [../install/index.md](../install/index.md).

**How it works, briefly**

Events live in `_content/calendar/` as `.ics` files. Pull is the
well-exercised direction: sync brings Google's events into the box. Local
edits, locally-created events, and deletions are pushed back to Google during
sync, but this push path and automatic scheduled sync are both less
exercised than the pull side. There is no calendar-month view built in;
queries are driven from the command line.

**Limits**

Scheduled auto-sync is off by default, so a calendar left alone will not stay
current on its own. The documentation describes the push-back path as having
had little real-world use, so treat locally-made changes reaching Google as
less reliable than the reverse.

**Go deeper**

[../reference/connectors.md](../reference/connectors.md),
[../concepts/cards.md](../concepts/cards.md)

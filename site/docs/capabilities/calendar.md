---
description: "Mirrors your Google Calendar into plain .ics files in the box, and can push locally-made changes back."
---
# Calendar

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. The calendar connector syncs Google Calendar into the box as plain
calendar files.

**What it does for you**

- Pulls your Google Calendar events into the box as individual `.ics` files,
  one per event, readable and editable as plain text. Each calendar you sync
  is a card of its own, and its events sit in a folder beside it; the card's
  page lists the next thirty days by day, each title opening its event file.
  The files are named by date and title (`2026-06-25_Dentist_a1b2c3d4.ics`),
  so a folder sorts by date and reads in a listing.
- Lets the agent read your agenda from the box's own copy instead of calling
  Google every time.
- Supports creating, editing, and deleting events by editing files, which
  push back to Google on sync.
- Recurring events are stored as one file with a recurrence rule, so a
  weekly meeting is not hundreds of separate files.

**What it needs**

A Google account, connected by signing in with your Google account and a
one-time setup, shared with the Gmail and Drive connectors. See the install directory: [../install/index.md](../install/index.md).

**How it works, briefly**

Each synced calendar is a calendar card in `_content/calendar/`, and its
events are individual `.ics` files in the folder beside that card (for the
curious). The folder decides which Google calendar an event belongs to. A file
is renamed when its event's date or title changes, and a box that synced
before this layout was converted once by a migration. Pull is the well-exercised direction:
sync brings Google's events into the box. Local edits, locally-created
events, and deletions are pushed back to Google during sync, but this push
path and automatic scheduled sync are both less exercised than the pull
side. There is no calendar-month view built in; you look up events by asking
the agent rather than browsing a calendar page.

**Limits**

Scheduled auto-sync is off by default, so a calendar left alone will not stay
current on its own. The documentation describes the push-back path as having
had little real-world use, so treat locally-made changes reaching Google as
less reliable than the reverse.

**Go deeper**

[../reference/connectors.md](../reference/connectors.md),
[../concepts/cards.md](../concepts/cards.md)

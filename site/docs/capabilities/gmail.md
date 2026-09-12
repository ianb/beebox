---
description: "Reads your Gmail into the box as tracked threads, drafts replies for your review, and never sends on its own."
---
# Gmail

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header inside it; the agent is the coding agent (Claude Code or Codex) that
reads and writes the box. The Gmail connector brings a deliberately small,
tracked slice of your mailbox into the box.

**What it does for you**

- Watches threads you tell it to track (by Gmail thread ID) and keeps a local
  copy of their messages and attachments up to date.
- Lets you set mail rules ("filter matches from this sender") that route
  matching mail into the box automatically, capped so one rule cannot track
  an unbounded number of threads.
- Drafts replies for you to send yourself: the agent writes the reply, and it
  is uploaded to Gmail as a draft, not sent.
- Surfaces mail as ordinary cards you can read, search, and file alongside
  everything else, without turning your whole mailbox into git history.

**What it needs**

A Google account, connected by signing in with your Google account and a
one-time setup, shared with the Calendar and Drive connectors. See the install directory for connector setup:
[../install/index.md](../install/index.md).

**How it works, briefly**

Gmail sync produces `email-thread` and `email-message` cards, created and
refreshed automatically or on demand. Tracking a thread is explicit (by thread ID or a
matching mail rule); the box does not silently mirror your entire inbox. An
agent-composed reply becomes an `email-outbound` card that is uploaded as a
Gmail draft for you to review and send: the agent does not send mail.

**Limits**

Email does not automatically become git content; only tracked threads do.
The documentation does not say Gmail sync runs on a fixed schedule by
default; it runs as part of the box's regular sync pass.

**Go deeper**

[../reference/connectors.md](../reference/connectors.md),
[../reference/cards/email-thread.md](../reference/cards/email-thread.md),
[../reference/cards/email-message.md](../reference/cards/email-message.md),
[../reference/cards/email-outbound.md](../reference/cards/email-outbound.md),
[../concepts/cards.md](../concepts/cards.md)

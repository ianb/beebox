---
description: "A full web app over the box: dashboard, chat, browsing, questions, history, settings, and per-card views, on desktop and phone."
---
# The web interface

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent that operates the box. You use the
box through a web application, not by opening files yourself. It runs on
desktop and phone.

**What you see**

- **Dashboard** — what needs your attention, with links to Browse, History, and Storage.
- **Chat** — a conversation with the agent, typed or spoken.
- **Browse** — a file-and-card browser over the whole box, with a workspace of tabs so several things stay open at once.
- **Questions** — the queue of things the agent is asking you.
- **Landmarks** — a curated map of the box's notable places.
- **History** — every change, drawn from git, with diffs and the files touched.
- **Storage** — how much space the box is using and where.
- **Settings** — pairing a phone, connectors, and other account controls.
- **Admin** — host-wide controls: which agent is running, allowed users, invites, notifications.

Each kind of card gets its own display: a recipe with scalable amounts, a
course with its lessons and your progress, a dashboard or a todo list, a
document, a spreadsheet, a PDF, a photo, or a folder. Cards can also carry
a paper theme and a card stock, so a recipe or a letter looks distinct
from a plain note.

**On a phone**

A native iPhone companion app is a thin shell around the same web chat,
adding pairing, recording, and speech input. Any phone's browser can also
reach a capture page for voice memos, photos, and scans. See
[phone-capture.md](phone-capture.md).

**How it relates to the files**

Every screen is a rendering of cards; nothing in the interface is separate
from the box. The agent can build new views for a richer look, the same
way it edits any other file. See [views.md](views.md).

**Limits**

The navigation bar shows no counts for pending questions or open todos;
open Questions or a todo view to see how many are waiting. Some card-body
links still point at an older internal address rather than the one that
actually opens, though following one still works. A rotated photo
occasionally renders upside down or clipped.

**Go deeper**

[views.md](views.md), [chat.md](chat.md), [phone-capture.md](phone-capture.md),
[../reference/interface-cards.md](../reference/interface-cards.md),
[../reference/views.md](../reference/views.md),
[../reference/cards/dashboard.md](../reference/cards/dashboard.md),
[../reference/cards/browse.md](../reference/cards/browse.md),
[../reference/cards/landmarks.md](../reference/cards/landmarks.md),
[../reference/cards/history.md](../reference/cards/history.md),
[../reference/cards/questions.md](../reference/cards/questions.md),
[../concepts/landmarks.md](../concepts/landmarks.md)

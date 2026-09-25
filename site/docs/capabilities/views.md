---
description: "Custom, agent-written interfaces (charts, dashboards, structured layouts) for a card type, rendered live over your own data."
---
# Views and dashboards

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. A view is a page or display the agent writes to give a card type a
richer look than plain markdown, such as a chart, a table, or a form
(technically, a small program the box builds for you).

**What it does for you**

- Gives a card type an interactive layout, a chart, or a structured summary
  instead of raw markdown, wherever that card is opened (its own page, a
  chat embed, or a side panel).
- Lets you ask the agent for a dashboard over a whole set of cards; a
  dashboard is itself a card type with a view that reads a collection.
- Updates live when the underlying files change, so a view is never stale
  against the box.
- Runs on any card page by its web address, letting you switch between
  different views of the same file.

**What it needs**

Nothing beyond the box itself; the agent writes views in response to what
you ask for.

**How it works, briefly**

A view is a `.tsx` file (built with React and TypeScript, for the curious)
that declares which card types it displays and which files it depends on;
the box builds it automatically and shows the result in your browser. Every
view is attached to a card type, so there is no standalone, card-less view.
The agent writes and edits view code the same way it edits any other file in
the box, then you see the result displayed.

**Limits**

Views are for presenting data that already exists, not for work that needs
to run separately behind the scenes; that goes through a job or procedure
instead. The documentation does not describe end-user visual editing of a
view; changes go through the agent.

**Go deeper**

[../reference/views.md](../reference/views.md),
[../reference/cards/dashboard.md](../reference/cards/dashboard.md),
[../reference/cards/view.md](../reference/cards/view.md),
[../concepts/cards.md](../concepts/cards.md)

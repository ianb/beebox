---
description: "Custom, agent-written interfaces (charts, dashboards, structured layouts) for a card type, rendered live over your own data."
---
# Views and dashboards

A box is a directory of your data kept in git; a card is a markdown file
with structured frontmatter; the agent is the coding agent (Claude Code or
Codex) that operates the box. A view is a small React component the agent
writes to give a card type a richer interface than plain markdown.

**What it does for you**

- Gives a card type an interactive layout, a chart, or a structured summary
  instead of raw markdown, wherever that card is opened (its own page, a
  chat embed, or a side panel).
- Lets you ask the agent for a dashboard over a whole set of cards; a
  dashboard is itself a card type with a view that reads a collection.
- Updates live when the underlying files change, so a view is never stale
  against the box.
- Runs on any card page by URL, letting you switch between alternate
  renderers for the same file.

**What it needs**

Nothing beyond the box itself; the agent writes views in response to what
you ask for.

**How it works, briefly**

A view is a `.tsx` file that declares which card types it renders and which
files it depends on; it is compiled server-side and rendered in the browser.
Every view is attached to a card type — there is no standalone, card-less
view. The agent writes and edits view code the same way it edits any other
file in the box, then you see the result rendered.

**Limits**

Views are for presenting data that already exists, not for work that needs
server-side processing outside the render — that goes through a job or
procedure instead. The documentation does not describe end-user visual
editing of a view; changes go through the agent.

**Go deeper**

[../reference/views.md](../reference/views.md),
[../reference/cards/dashboard.md](../reference/cards/dashboard.md),
[../reference/cards/view.md](../reference/cards/view.md),
[../concepts/cards.md](../concepts/cards.md)

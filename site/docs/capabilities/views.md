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
- Builds figures: small interactive or animated graphics that show one idea,
  such as a diagram you can drag or an experiment you can run. A figure is its
  own card type. Its drawing and animation run in your browser on the graphics
  chip through WebGPU, and the agent can run one without a screen and look at
  the frames before it hands the figure over. What you do in a figure beside
  the chat is logged, so the agent can see it and can arm a watcher that speaks
  up when you are stuck or done ([chat.md](chat.md)).
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

The agent checks a view before handing it over. `bbx view check` renders each
card type the view displays, runs its effects, and prints advice where the
view uses a pattern the box's view guidance forbids. A view can declare named
states for the check to render. The agent can also open
the card in the box's own browser and look at it
([web-interface.md](web-interface.md)).

**Limits**

A figure needs a browser and device with WebGPU; without it the figure's place
says it cannot draw on this device. A figure written for an earlier version of
the drawing library shows "This figure is being updated" until the agent
rewrites it; the drawing library changed in November 2026, so older figures
are the likeliest to show that. Views and figures run inside the app's
own page with your signed-in session, and nothing isolates them from the rest
of the box (see [your data and safety](../10-your-data-and-safety.md)).

Views are for presenting data that already exists, not for work that needs
to run separately behind the scenes; that goes through a job or procedure
instead. The documentation does not describe end-user visual editing of a
view; changes go through the agent.

**Go deeper**

[../reference/views.md](../reference/views.md),
[../reference/cards/dashboard.md](../reference/cards/dashboard.md),
[../reference/cards/view.md](../reference/cards/view.md),
[../concepts/cards.md](../concepts/cards.md)

---
title: "The box agent has no reliable way to see a view or card it built; the screenshot only shows the user's viewport"
workstream: unattached
area: beebox
labels: [agent, views, screenshots, verification]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder report, 2026-10-29"
---

When the box agent builds or changes a visualization (a view, a widget, a
card's rendering), it sometimes checks its work with `bbx chat screenshot`.
That command captures the pixels of the user's current tab through
`getDisplayMedia` (`src/frontend/src/components/chat/screenshot-capture.ts`;
the agent prompt in `src/core/chat/session/prompts.ts` describes it as "a
real capture of the user's screen right now"). So it only shows what is in
the user's viewport at that moment:

- Content below the fold, or in a collapsed or scrolled-away panel, is not in
  the image. The agent then reasons about a picture that does not contain its
  work.
- It needs the user's browser to be open and to approve the capture, and it
  is unsupported on mobile Safari.
- It shows whatever the user is looking at, which may not be the card the
  agent just changed.

`bbx view check`, `typecheck`, and `lint` say whether a view renders and
type-checks, not what it looks like.

The boxholder's ask: the agent needs better ways to see its own work.

Directions to weigh:

- **Render a card or view on the server, without the user.** For example,
  `bbx view render <card> --screenshot`: a headless browser on the box's own
  host opens the card's page as the box, captures the full rendered element
  (not the viewport), at a phone and a desktop width, and returns image paths.
  Also returns the rendered text and accessibility tree, which tell the agent
  more than pixels about labels, empty states, and overflow.
- **Element-scoped capture in the user's tab.** When the user's view is the
  point, capture the card's own element (scrolled into view, or rendered
  off-screen at full height) instead of the visible viewport.
- **Report what the image does not contain.** Any capture says whether the
  target element was fully inside it, so a partial image is never mistaken for
  the whole.

Neighbors: `issues/features/2026-10-05-box-agent-interface-screenshots.md`
(annotated screenshots of the app, for explaining the interface) and
`issues/features/2026-06-12-agent-browser-scoped-to-box.md` (a browser the
agent can drive, scoped to its box). A server-side renderer could serve all
three.

---
title: "Chat links that focus an open view and set its state (\"show me\" links)"
workstream: chat-show-me-links
needs: [design]
area: beebox
labels: [chat, views]
filed-by: agent
discovered-by: Ian
discovered-in: "courseware box feedback — Chat_Links_That_Drive_Views, 2026-11-09"
---

The boxholder wants a chat explanation to carry "show me" links. For
example: "sodium gives up one electron ([show me](/path/Periodic_Table.chem.card?select=Na))".
A click moves the view that is already open beside the chat to that state,
with a visible transition, and does not open a second copy.

## What exists

- A link with query parameters opens the card in the companion pane with
  those parameters (seen working in a box).
- `control:` links point at, focus, or reveal interface controls. They do not
  set a view's own state.
- A view receives `params` as configuration and `viewHistory` for its own
  navigation state.
- Not checked: whether a second link to an open card focuses its tab and
  passes new params to the mounted view, or remounts it. A transition needs
  the view to stay mounted.

## Directions

- **Link semantics:** a link to an open card focuses that tab and passes the
  new params to the mounted view without a remount.
- **An explicit scheme** for state changes that are not navigation, such as
  `view:/path?select=Na`.
- **Views declare the states they accept**, so the agent knows valid targets.
  This is the same list as the declared test states in
  [view check blind spots](../closed/bugs/2026-11-09-view-check-passes-views-that-crash-after-load.md).

## Auto-fire and speech timing

The boxholder also asked for a link that fires once when the message
arrives, marked separately from its address. Candidates the agent listed:

- the Markdown link title (`"auto"`), which overloads human text;
- a wrapping chat tag like `<callout>` and `<ack>`: `<show ref="…"/>`;
- an attribute block after the link (`{.auto}`, the Pandoc / markdown-it-attrs
  convention), or a Markdoc annotation if Markdoc attaches it to one link;
- a query parameter (`&auto=1`), which leaks into the view's params.

A `<show/>` tag inside `<speech>` could fire when the voice reaches it. The
speech renderer would strip it from spoken text and map its position to
audio time. Chat guidance now keeps links out of `<speech>`.

Rules it would need: fire at most once, only for the newest message (not on
history replay), only when the target is or can be open beside the chat, and
a way for the person to turn it off.

Related: [an explicit action to show a card](2026-09-08-agent-show-card-action.md),
[card links show open state](2026-09-08-card-links-show-open-state.md),
[inline delivery markup for speech](../exploration/2026-10-20-tts-inline-delivery-markup.md).

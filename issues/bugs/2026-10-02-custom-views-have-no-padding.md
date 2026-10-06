---
title: "Every custom view runs edge to edge; full bleed should be an option, not the only layout"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder report
priority: important
---

Every custom (agent-authored) view renders with no side padding. Its content
touches the edges of the card area. Some views benefit from full width, such
as maps, tables, and image grids. Most views are ordinary content and need the
same inset as other cards.

The host sets no padding. In
`src/frontend/src/components/FileView/AgentViewRenderer.tsx:376`, the
container class is `p-3` in chat mode and only `w-full` otherwise. Each view
must therefore add its own padding, and in practice they do not.

## Wanted

- Default: the host insets the view the same way it insets a built-in card
  view.
- Opt-in: a view can request full bleed.

## Open question

How a view requests full bleed. The renderer reads only `mod.default` now.
Candidates:

- A named module export next to the default (for example `export const layout
  = "full-bleed"`). This stays in the view's own file.
- A field on the view's card or registration.

Whichever form is chosen, the view-authoring guidance that box agents load must
document it. Otherwise agents will not use it.

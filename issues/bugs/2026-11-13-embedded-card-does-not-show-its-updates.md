---
title: "A card embedded in another card does not show its updates"
workstream: unattached
area: beebox
discovered-by: Ian
filed-by: agent
---

When a card embeds another card, for example a figure embedded with `![alt](_content/figures/Foo.figure.card)`, a change to the embedded card does not appear in the embedding card. The card open on its own updates. The embed keeps its old contents.

## Leads (not verified)

- `beebox/src/frontend/src/components/FigureEmbed.tsx` renders an embed through `FileView` (`beebox/src/frontend/src/components/FileView/view.tsx`), with the target from `embedTarget` (`beebox/src/frontend/src/lib/card-embed.ts`). It also calls `useWatchedContent` (`beebox/src/frontend/src/lib/runtime-lint/watched-content.ts`).
- Check how the open card learns that its own file changed: which path it watches, and which query it invalidates. Then check whether an embedded `FileView` joins that mechanism for its own path, or only reads once.
- Check whether this is specific to figures (a figure loads a module from `/api/figure/module.js`, which can be cached) or applies to every embedded card type.

## To reproduce

Open a card that embeds a figure or another card. Change the embedded card, by hand or through the agent. Compare the embed with the embedded card open on its own.

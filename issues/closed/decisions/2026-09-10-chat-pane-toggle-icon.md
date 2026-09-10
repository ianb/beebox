---
title: "Choose a clear icon for the chat pane toggle"
workstream: paper-cards
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: worktree-paper-cards — while refining workspace pane behavior
resolution: implemented
---

> Closed: implemented by `3ecb6f9c4`. The card-pane control keeps its existing
> position and uses a minus icon with the label/tooltip “Minimize cards.” The
> floating restore control also stays in place, keeps the raised-stack icon,
> and uses “Restore cards (N).” No animation or behavior changed.

The current show-or-hide chat icon is confusing. The same control changes a pane between its card and the conversation, so a familiar generic chat icon does not explain both directions well.

Decide whether the control should describe its destination, the pane transition, or the current state. Check the choice in both the two-pane desktop layout and the one-pane mobile layout before changing the icon.

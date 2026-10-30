---
title: "In the Todos Dated strip, a wrapped card name reads as a heading for the next item"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — F-newcomer walk, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. Each dated line is one row; the todo text truncates and the card name stays on its line.

Each line of the "Dated" strip is a wrapping row: the date badge, the todo text, then the card name (`DatedLine`, `beebox/src/frontend/src/components/todo-view/DatedStrip.tsx:34-45`, `<Row … wrap>`). When the todo text is long, the card name moves to a line of its own. It then sits directly above the next dated item and reads as that item's heading. In the F-newcomer walk, "House jobs" (the card of the council item) appeared alone above the Spanish homework item (shots 19-21, 1280-px viewport, left pane). The walker did not remark on it.

Report: [F-newcomer](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (R2).

## Fix direction

Keep the card name on the item's line and truncate the text; or indent a wrapped card name under its own item. Check the narrow (phone) width too.

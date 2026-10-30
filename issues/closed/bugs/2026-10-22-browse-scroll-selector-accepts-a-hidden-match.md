---
title: "bin/browse scroll --selector scrolls a hidden element and prints Done; mouse wheel ignores mouse move"
workstream: unattached
area: browse
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — C-reconnecting walk, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. `scroll --selector` uses the first visible match and refuses when all are hidden; the wheel position limit is documented in the browse skill.

The C-reconnecting walker ran `bin/browse scroll --selector "[role=tabpanel]"` to scroll a card pane. The selector matched the first tab panel in the DOM, which was hidden (0×0), and `scroll` printed `✓ Done`. The walker then tried `mouse move 300 300` and `mouse wheel`; the wheel event went to (0,0). The walker concluded that the card pane does not scroll, which was false.

`scroll` is not a checked command (`CHECKED_COMMANDS`, `browse/src/controls.ts:431`), so it goes to upstream with no zero-size check. Clicks already refuse a zero-size target (`controls.ts:299`).

Report: [C-reconnecting](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (row 18, H1).

## Fix direction

Make `scroll --selector` refuse a zero-size match, or use the first visible match, as clicks do. Make `mouse wheel` dispatch at the last `mouse move` position, or document that it does not. Related: [agent-browser wheel dispatch is flaky](../../bugs/2026-08-09-agent-browser-wheel-dispatch-flaky.md) (a different wheel failure).

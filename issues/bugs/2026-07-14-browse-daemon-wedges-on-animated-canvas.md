---
title: browse daemon wedges (os error 35) on pages with continuously animating canvas
workstream: unknown
priority: backlog
---

During figure verification (responsive-figures worktree), `bin/browse` repeatedly
wedged with:

    browse: agent-browser exited 1: ✗ Failed to read: Resource temporarily
    unavailable (os error 35) (after 5 retries - daemon may be busy or unresponsive)

Pattern observed over ~10 occurrences in one session:

- Happens only on pages hosting a continuously animating canvas (p5 figure
  cards with a 60fps `draw()` loop; also right after `reload` on such a page).
- Once wedged, every subsequent command fails the same way; `bin/browse close`
  + reopening the session recovers it reliably.
- Static pages and one-shot commands never triggered it.

Hypothesis: the constantly repainting canvas floods or starves the daemon's
CDP connection so the unix-socket read hits EAGAIN until the retry budget runs
out. Worth reproducing against upstream `agent-browser` and either fixing
there or teaching `bin/browse` to auto-restart the daemon on this specific
error instead of failing the command.

Workaround meanwhile: `bin/browse close` and retry the command in a fresh
session.

## Re-encounter 2026-10-22 (journey walks): no canvas

The same upstream error on a page with no canvas. In the [G-paperwork](../../beebox/test/user-stories/journeys/G-paperwork/reports/2026-10-22.md) walk (H1), agent-browser 0.27.0 `snapshot` (also `--json` and `-s`) did not return on an unstarted chat whose openers render in the chat column. Left alone, upstream failed after about 154 s: `✗ Failed to read: Resource temporarily unavailable (os error 35) (after 5 retries - daemon may be busy or unresponsive)`. `eval`, `screenshot`, `click`, and `get` kept working. The same URL in a fresh session, with the openers on the Box card, worked in 1 s. Removing `#bbx-nav-session`, `#bbx-nav-place`, or `main` from the DOM cleared the hang; removing the empty-chat block did not. The element is not pinned. The [B-inventory](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-22.md) walker hit the same in the same window (H1), and the B walk of 2026-10-09 saw `snapshot` hang until a reload (row 53). The trigger is page state, so the canvas hypothesis is too narrow. The silent exit 1 that the walkers saw is filed separately: [a killed browse command exits 1 silently](../closed/bugs/2026-10-22-browse-command-killed-by-a-signal-exits-1-silently.md).

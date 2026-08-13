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

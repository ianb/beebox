---
title: "The journey browser denies notification permission, so no walk can test a reminder reaching the person"
workstream: unattached
area: beebox
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — F-newcomer walk, 2026-10-22
---

The headless Chrome that `bin/browse` drives answers a notification permission request with `denied` and shows no prompt (checked in session `aa-f-1`: `default -> denied`). The F-newcomer journey's main need is "fewer small things slipping my mind", and the G-paperwork journey's is "get reminded before it is too late". Neither walk can turn on web push, so every walk ends with the agent saying that nothing can reach the person. The 2026-10-09 F walk recorded the same (H1).

Report: [F-newcomer](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-22.md) (row 35, H1).

## Why the fix is not obvious

Granting the permission (CDP `Browser.grantPermissions` for the router origin, during `prepare`) lets the web-push path start, but a delivery still needs a push service that reaches a headless browser. Delivery is out of scope for one sitting anyway (journeys README, "Scheduled work needs its own verification"). The smaller step is one line in the walker prompt: the instrument's browser blocks notifications. Then the walker does not report the block as the app's fault.

Related: [notifications and proactive design](../features/2026-09-25-notifications-and-proactive-design.md).

---
title: "Journey walks need simulated notifications that reach the walker in its own time and text"
workstream: unattached
area: beebox
labels: [harness]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — F-newcomer and G-paperwork walks, 2026-10-22
---

The walk browser denies notification permission, and the walker prompt now says so ([closed step](../closed/code-quality/2026-10-22-journey-browser-denies-notification-permission.md)). No walk can see a reminder reach the person, though the F-newcomer and G-paperwork journeys are mostly about being reminded.

The walker must not get real notifications: no OS banner, no real push service, no message to the boxholder's devices. It needs notifications in its own simulated space:

- **Time.** A walk lasts minutes; a reminder is due days later. The walker's clock has to move forward ("two days pass"), and what the box would send in that span has to fire at the simulated time.
- **Text.** What arrives is what the person would read: the title, the body, and where a tap goes. The walker receives it as text, for example a file or a command output in its run directory, and can then open the target in the browser.

## Why the fix is not obvious

- The box's scheduler and reminder delivery run on the real clock. A simulated clock has to reach the walk's box only, never the shared router's other boxes.
- Delivery goes through web push (and the iOS app). The shim has to replace the last hop only, so that what the walker reads is what the real path would have sent.
- Advancing time is a walk event, so it belongs in the journey's situation text, not the walker's choice ("Do not invent events" in `beebox/test/user-stories/journeys/walker-prompt.md`).

Related: [notifications and proactive design](2026-09-25-notifications-and-proactive-design.md).

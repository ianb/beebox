---
title: "Field-test scenario briefs name weekdays that don't match the box clock"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test run 2, whats-needed item
labels: [field-test-findings, test-content]
---

The `onboarding-first-days` briefs narrate fictional wall time ("It's the
next evening", "Saturday morning, a quiet moment") while the box clock is
`startTime` plus the accumulated `advance-days` — which lands on unrelated
weekdays. In run 2 the final item's brief said Saturday morning while
CB_TIME was 2026-08-12, a Wednesday; the operator noticed the app "corrected"
it ("Afternoon, actually — it's 2:41 on Sunday") and couldn't resolve whose
clock was wrong.

(That specific confusion was compounded by a real bug, now fixed: the chat's
`local-time` tag used the process clock instead of `getBoxTime`, so the
agent saw REAL wall time. With that fixed the agent will say "Wednesday" —
still contradicting a brief that says Saturday.)

Fix is content-side: either pick a `startTime` so `startTime + the items'
advance-days` lands each narrated moment on the weekday the brief claims, or
strip named weekdays/times-of-day from the briefs and let the box clock be
the only time authority. The scenario README should note the constraint so
future scenarios keep their fiction consistent with their clock arithmetic.

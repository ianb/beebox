---
title: "An unknown wakeup connector exits in the middle of the cycle"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-sync-isolation — independent review of wakeup failure signaling
priority: normal
---

`runConnectors` calls `process.exit(1)` when `cb wakeup --connector <name>` does not match a configured connector. The wakeup command has already run its first phases at that point, but the immediate exit skips stale-job cleanup, intake processing, index refresh, reactor work, and the final Git push.

A connector-name typo can therefore leave work produced by early phases unfinished. It also bypasses the normal wakeup policy that records an error, finishes the cycle, and applies `process.exitCode` at the end.

Return an orchestration error instead of terminating inside `runConnectors`. Add a doctest that requests an unknown connector and proves the remaining wakeup phases can finish before the process exits nonzero.

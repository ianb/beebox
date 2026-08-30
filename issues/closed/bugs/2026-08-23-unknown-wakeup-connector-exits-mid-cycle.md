---
title: "An unknown wakeup connector exits in the middle of the cycle"
workstream: connector-integrity
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-sync-isolation — independent review of wakeup failure signaling
priority: normal
resolution: implemented
---

**Closed 2026-08-25** in b9c583f6 + 71296a15: no `process.exit`; the unknown name is an error folded into the cycle's exit code, later phases run scoped to nothing.

`runConnectors` calls `process.exit(1)` when `bbx wakeup --connector <name>` does not match a configured connector. The wakeup command has already run its first phases at that point, but the immediate exit skips stale-job cleanup, intake processing, index refresh, reactor work, and the final Git push.

A connector-name typo can therefore leave work produced by early phases unfinished. It also bypasses the normal wakeup policy that records an error, finishes the cycle, and applies `process.exitCode` at the end.

Return an orchestration error instead of terminating inside `runConnectors`. Add a doctest that requests an unknown connector and proves the remaining wakeup phases can finish before the process exits nonzero.

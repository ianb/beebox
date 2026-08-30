---
title: "todo multi state controls d2"
workstream: unknown
area: beebox
resolution: implemented
---

**Closed:** Done: `src/frontend/src/components/TodoListView.tsx` pairs a round pending↔done checkbox (the common action) with a `⋯` menu exposing all four statuses.

`src/frontend/src/components/TodoListView.tsx` now pairs a round pending↔done
checkbox (the common action) with a `⋯` menu exposing all four statuses
(pending/done/cancelled/deferred), so the rarer cancelled/deferred states are
reachable from the UI.

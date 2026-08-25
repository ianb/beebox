---
title: "A Calendar patch failure can discard a local edit"
workstream: connector-integrity
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-sync-isolation — independent review of Calendar failure isolation
priority: normal
---

The Calendar decision can choose `local-wins` when the local event changed and the remote event did not. `patchEventViaApi` in `callback-box/src/connectors/google-calendar-state.ts` catches an HTTP failure and returns `null`. `tryPushLocalEdit` then returns false, and `google-calendar-sync.ts` falls through to writing the remote event over the local file.

A transient 429 or 503 can therefore erase the boxholder's local edit while the connector reports a normal remote update. The failure is not represented in the connector result or commit narrative.

The local file must remain intact when a selected local-wins push fails. Add a doctest with a local edit and a failing patch request. It should prove the file stays unchanged and the connector returns a visible failure.

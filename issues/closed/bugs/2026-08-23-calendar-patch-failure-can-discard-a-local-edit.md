---
title: "A Calendar patch failure can discard a local edit"
workstream: connector-integrity
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-sync-isolation — independent review of Calendar failure isolation
priority: normal
resolution: implemented
---

**Closed 2026-08-25** in ca356806 + b4fc4959: a failed patch leaves the file and its recorded hash untouched and records a failure; a new push-phase pass retries every tracked entry whose hash differs (the hash is the retry queue). That pass also closes a pre-existing gap: local edits were only ever pushed on a full-window fetch.

The Calendar decision can choose `local-wins` when the local event changed and the remote event did not. `patchEventViaApi` in `callback-box/src/connectors/google-calendar-state.ts` catches an HTTP failure and returns `null`. `tryPushLocalEdit` then returns false, and `google-calendar-sync.ts` falls through to writing the remote event over the local file.

A transient 429 or 503 can therefore erase the boxholder's local edit while the connector reports a normal remote update. The failure is not represented in the connector result or commit narrative.

The local file must remain intact when a selected local-wins push fails. Add a doctest with a local edit and a failing patch request. It should prove the file stays unchanged and the connector returns a visible failure.

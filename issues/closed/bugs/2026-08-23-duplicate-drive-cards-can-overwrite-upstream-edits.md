---
title: "Duplicate Drive cards can overwrite upstream edits"
workstream: connector-integrity
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-sync-isolation — independent review of Drive trash tombstones
priority: normal
resolution: implemented
---

**Closed 2026-08-25** in 3051bf12: two cards with one drive-id are skipped together and reported in `result.error`; `cb drive add` refuses a drive-id another card already claims.

The Drive connector permits two live cards with the same `drive-id`. It syncs both paths, but transient hashes are keyed only by Drive ID. `cb drive add` rejects a destination-path collision, not an already-mounted Drive ID.

If one card is edited, the first sync can push that edit to Google and update the shared hash. The second card then appears locally changed relative to the new shared hash and can push its stale attachment data back to Google. The run reports success while the upstream edit is reverted.

Drive discovery and `cb drive add` need one explicit duplicate-ID policy. A safety test should create two live cards for one spreadsheet and prove that the connector refuses to push either ambiguous working copy.

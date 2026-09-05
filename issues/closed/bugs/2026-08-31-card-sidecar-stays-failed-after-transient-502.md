---
title: "Card sidecar discards loaded content on a transient 502 and never recovers"
workstream: sidecar-shell
area: beebox
filed-by: agent
discovered-by: Ian
priority: important
resolution: implemented
---

Resolved by `0f375fe32` (fix(sidecar): a failed refresh keeps the card and says
it is out of date), part of the `sidecar-shell` plan. `useFileData` now decides
via `lib/file-load-state.ts` (pure, doctested): cached data wins over a failed
refresh, showing a "Not up to date" marker with Refresh; the two file-view
queries retry a transient failure 3x with backoff. No divergence from what the
issue proposed.

The card sidecar had already loaded a card successfully. A server update then
made a refresh request return HTTP 502. The sidecar replaced the loaded card
with an error. It stayed in that failed state after the server returned. It did
not refresh again or recover without manual intervention.

This combines two defects:

1. A transient refresh failure must not discard content that the sidecar has
   already loaded. The sidecar can show a stale or reconnecting indicator while
   it continues to display the last successful result.
2. The sidecar must retry or invalidate its query after connectivity returns.
   A temporary server outage must not leave the panel failed indefinitely.

The shared `FileView` loading path is a likely owner. `useFileData` in
`beebox/src/frontend/src/components/FileView.tsx` returns `cardError` before it
returns cached `card` data. It also relies on the event-stream reconnect callback
to invalidate the card query. Investigate how tRPC/React Query represents a
failed background refetch, whether reconnect always fires after a server update,
and which retry policy ends before the server is ready.

## Reproduction

1. Open a card in the companion sidecar and wait for it to render.
2. Restart or update the server while the sidecar remains open.
3. Let a sidecar refresh receive HTTP 502.
4. Restore the server and leave the page open.

The loaded card should remain visible during the outage. The sidecar should
refresh itself after the server recovers. It must not require a page reload,
closing and reopening the card, or another manual action.

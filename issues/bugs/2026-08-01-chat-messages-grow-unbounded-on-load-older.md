---
title: "Frontend chat messages array grows without ceiling as the user pages back"
workstream: chat-history-oom-mobile-lock
area: callback-box
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — post-fix sweep
---

`callback-box/src/frontend/src/machines/chatMachine.ts` `PREPEND_MESSAGES`
does `[...event.messages, ...context.messages]` — each load-older page is
server-bounded, but repeated paging accumulates every fetched entry in the
tab, including full base64 `imageData` blocks. On a long session a user who
keeps loading older history rebuilds the whole transcript client-side. Most
relevant on mobile WebViews, where memory pressure kills the page (the same
user-visible symptom class as the 2026-08-01 server OOM).

Fix shape: cap client-retained `messages` (drop from the tail when prepending
past ~1000, since the user is scrolling away from it) or virtualize the list.

## Paging back is also slow — and the same mechanism fixes both

Boxholder, 2026-08-13. Today's page size is a **fixed 40**
(`InteractiveChat-actions.ts:155`, `Math.min(olderCount, 40)`), so reaching far
back means many round trips. Two changes that compose into one window:

1. **Grow the page size the further back you go.** Someone twenty pages deep is
   travelling, not reading; small fixed pages make distance expensive. An
   escalating size keeps the first step cheap and long journeys tractable.
2. **Unload from the newest end as older pages arrive**, keeping only a small
   overlap. That *is* this issue's fix — a sliding window rather than an
   ever-growing array — so the slowness fix and the memory fix are the same
   change.

Design questions:

- **What curve?** Doubling reaches far history in log-many fetches but makes a
  late page enormous; linear growth is gentler and slower. Whatever it is, cap
  it under the server's retention ceiling so the affordance can't offer more
  than it can fetch (the existing comment's constraint).
- **Scrolling back down.** Once the newest entries are dropped they must be
  re-fetched, which is the reverse trip and needs the same treatment. Worth
  deciding whether the window is symmetric or biased toward keeping the live
  tail, since the tail is where streaming lands.
- **Scroll anchoring.** Prepending shifts scroll position, and dropping from the
  other end shifts it again — two edits to the same list per action. The
  `streaming-scroll` workstream (2026-08-13) is already handling prepend-delta
  adjustment for the load-older case; this is the same problem seen from the
  other end of the list. Coordinate rather than solving it twice.

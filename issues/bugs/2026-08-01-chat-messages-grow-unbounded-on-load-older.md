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

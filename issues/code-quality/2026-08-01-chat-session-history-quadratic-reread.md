---
title: "chat-session-history.json is re-read and re-parsed O(n) times per lookup"
area: callback-box
filed-by: agent
discovered-in: worktree-chat-history-oom-mobile-lock — post-fix sweep
---

`readHistoryFile` (`callback-box/src/core/chat/session/history.ts`) reads and
`JSON.parse`s the whole session-history file on every call, and
`getLastSessionForDirectory` calls `resolveSessionLogPath` (→
`loadHistoryEntries` → `readHistoryFile`) per entry inside a loop — O(n) full
reads + n full parses per landmark "Chat" click. The file grows one entry per
web-chat session ever created and is never pruned, so this gets quadratically
slower with age. Also re-read on every `transcript-sync` poll. Cost is CPU/IO
on the request path, not resident memory (entries are small).

Fix shape: hoist `loadHistoryEntries` out of the `getLastSessionForDirectory`
loop; add a short-TTL or mtime-keyed in-process cache in `readHistoryFile`;
consider pruning/rotation for the file itself.

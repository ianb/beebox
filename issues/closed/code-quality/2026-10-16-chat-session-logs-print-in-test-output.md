---
title: "Chat-session logs print into every test that runs a real session"
workstream: doctest-typecheck
area: beebox
labels: [tests, noise]
filed-by: agent
discovered-by: agent
discovered-in: doctest-typecheck worktree — typing capture doctests against a real ChatSessionRegistry, 2026-10-16
priority: normal
resolution: implemented
---

Closed 2026-10-16 (workstream `doctest-typecheck`, commit f608ac9be):
`makeLog` skips when `BBX_CHAT_SESSION_LOG=off`, which the tap preload
`test/helpers/quiet-chat-session-log.ts` sets for every test process.
Production logs are unchanged; they are a server's record and several bug
reports quote them. `capture/prepare.doctest.md` went from 42 lines to none,
and the test server's narrower `[chat-history:]` console patch is gone.

`makeLog` in `beebox/src/core/chat/session/log.ts` calls `console.log` on every
call, with no debug gate. Any test that drives a real `ChatSession` or
`ChatSessionRegistry` prints `[ChatSession:init] …` lines into its TAP output.
`test/core/capture/prepare.doctest.md` printed 36 such lines before the
doctest-typecheck work and 42 after it, when more of its tests moved from
hand-written fakes to a real registry over `createFakeChatBackend()`.

Root rule: routine-success diagnostics belong behind debug. The likely fix is a
debug flag or level in `makeLog`, keeping warnings and failures visible.

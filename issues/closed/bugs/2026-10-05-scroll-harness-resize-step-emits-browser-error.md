---
title: "Scroll harness resize-race step emits an uncaught browser error"
workstream: chat-scroll-fixes
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-scroll-fixes — spacer browser verification
resolution: implemented
---

> Implemented: the harness records and consumes one exact ResizeObserver diagnostic during the intentional resize-race step. Chromium verification passed at `http://localhost:3210/chat-scroll-fixes/test1/dev/chat-scroll`; unrelated errors during the step and the same diagnostic after it remain in the client debug log.

Running `window.__scrollHarness.run("open-thread-growth-before-scroll-event")`
at `/dev/chat-scroll` passes its assertions but emits
`ResizeObserver loop completed with undelivered notifications.` to the client
debug log. An error-event probe identifies the `growTwiceInOnePass` step.

That existing step deliberately changes layout inside a ResizeObserver to
exercise the race. Preserve its coverage while distinguishing the expected
fixture diagnostic from unexpected browser errors. Do not suppress this error
globally. The short-reply spacer scenario does not emit it.

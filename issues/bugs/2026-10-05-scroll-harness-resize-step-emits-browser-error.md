---
title: "Scroll harness resize-race step emits an uncaught browser error"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-scroll-fixes — spacer browser verification
---

Running `window.__scrollHarness.run("open-thread-growth-before-scroll-event")`
at `/dev/chat-scroll` passes its assertions but emits
`ResizeObserver loop completed with undelivered notifications.` to the client
debug log. An error-event probe identifies the `growTwiceInOnePass` step.

That existing step deliberately changes layout inside a ResizeObserver to
exercise the race. Preserve its coverage while distinguishing the expected
fixture diagnostic from unexpected browser errors. Do not suppress this error
globally. The short-reply spacer scenario does not emit it.

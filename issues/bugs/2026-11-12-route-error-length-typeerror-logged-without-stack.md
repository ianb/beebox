---
title: "A production \"Route error\" reading 'length' of undefined cannot be traced: the debug log drops the stack"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-missing-session-recovery — while fixing a refused first chat message after a deploy
---

A production box's `client-debug.log` recorded, about two minutes after a deploy reopened the box:

```
[error] Route error: TypeError: Cannot read properties of undefined (reading 'length')
```

The line has no stack. The error did not occur again in a fresh owner session, and a code read did not find a cause.

## Why there is no stack

- `RouteError.tsx` logs `console.error("Route error:", error, info?.componentStack ?? "")`. It is the root router `errorComponent`, so it catches render errors and throws from `beforeLoad` and `validateSearch`. It does not catch event handlers, effects, or promise rejections.
- `describeArg` in `src/frontend/src/lib/debug-log-format.ts` formats an `Error` as `${name}: ${message}` and drops `.stack`. Every logged error loses its stack, not only this one.
- The component stack is a separate argument. An empty component stack suggests a `beforeLoad` or `validateSearch` throw rather than a component render, but the recorded line does not show whether it was empty.

## Context

The page was `/chat?card=<card>&session=<id>`, where the session id had never been created on the box because its first send was refused during the deploy (fixed in the same workstream). Paths that were read and ruled out:

- The failed-send rows (`FailedConversationSends.tsx` reads `images.length`, `files.length`, `selections.length`). Rows pass a zod schema that requires those arrays; a parse failure is caught and shows a recovery alert.
- `chat.bootstrap` returning `unavailable`: the resolver does not read `history` on that branch.
- A deploy-time 503 body: tRPC turns 502/503/504 into `BoxUnreachableError` before reading a body.

Not traced: `.length` reads in `ChatBarChrome`, `SessionListMenuBody`, and `InteractiveChat` when no conversation target is rendered.

## Tension

A fix needs the stack. Adding `error.stack` to `describeArg` makes every error line in the log longer, and the log is read by people and by journey agents. Logging the stack only for the route error is narrower but leaves other logged errors without one.

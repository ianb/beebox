---
title: "Chat message rows re-render on every streamed token"
workstream: unattached
area: beebox
labels: [performance]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — tracing the max-update-depth warning, 2026-10-08
---

While tracing the "Maximum update depth exceeded" warning
([closed issue](../closed/bugs/2026-10-08-client-max-update-depth-after-chat-turns.md)),
render counts during one short chat turn on test1 showed the message list
re-rendering far more than the visible change needs:

- `GroupItem`: about 400 renders.
- `UserMessage` and `AckBadge`: about 170 renders each.
- `InteractiveChat`: 108 renders (expected; it owns the stream).

Only the streaming assistant message changes per token. Settled rows should
render once. The fix for the card panel (`cb5e8cc24`) was a rest-spread
props object that defeated React Compiler memoization; the message rows may
have a similar unstable prop. Not traced.

The counts come from a temporary instrumented `react-dom`; there is no
automated measurement. A cheap way to re-measure is React DevTools'
"highlight updates" during a long reply.

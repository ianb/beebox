---
title: "A reply that finalizes while a pending voice or capture bubble shows remounts instead of updating in place"
workstream: frontend-dom-harness
area: beebox
labels: [frontend, chat]
filed-by: agent
discovered-by: agent
discovered-in: worktree-frontend-dom-harness — cross-model diff review, 2026-10-16
resolution: implemented
---

> **Closed:** `nextLiveTargetUuid` now skips every non-group item after the last group. A DOM doctest finalizes a turn with a pending voice message below it and checks that the reply's row keeps its DOM node (red before the fix).

`nextLiveTargetUuid` (`beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/messages.tsx`)
binds the live-turn key to the finalized assistant group by walking the row
list from the end. It skips trailing markers, but not the tail items that
follow the groups: pending HQ voice bubbles and capture bubbles. If a reply
finalizes while one of those is still showing, the walk stops at the bubble
and returns null. The assistant row then changes from its `live-<turnId>` key
to its uuid key, so React remounts it: the flash and scroll jump the live key
exists to prevent.

A pending HQ bubble stays until `HQ_DONE` (`machines/composerMachine.ts`), so a
voice message sent while a reply streams can reach this. Not reproduced;
found by source reading. The bug is on main and was not introduced by the
re-render fix.

Smallest fix: skip `pendingHq` and `captureBubble` items in the walk, as
markers are. A DOM doctest
(`beebox/src/frontend/test/components/chat/everywhere/InteractiveChat/messages.streaming-renders.doctest.md`
has the fixture) can finalize a turn with a pending bubble in the tail and
check that the assistant row's DOM node survives.

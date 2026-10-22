---
title: "The composer keeps the root question as its placeholder after the conversation starts"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — I-deciding walk, 2026-10-22
---

In the I-deciding walk the composer read "What do you want to keep track of here?" through three turns (shots 04, 07, 11). It changed to "Type a message…" only after a reload (shot 12). The person had already sent three messages.

Report: [I-deciding](../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (R11).

## Mechanism

`InteractiveChat` passes `openQuestion` to the view only while `unstarted` (`beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/shell.tsx:419`). A tab stays `unstarted` while it holds its reservation receipt; the receipt is retired only on bootstrap (`resolve-conversation.ts`). The placeholder (`InteractiveChat/view.tsx:221`, `:249`) has no guard for sent messages. The openers have one: `showsOwnOpeners = unstarted && messages.length === 0 && !isStreaming` (`view.tsx:275`).

## Why the fix is not obvious

The guard is likely the same as the openers' guard. Check first why `unstarted` stays true after a send; other consumers of `unstarted` may show the same stale state. A check on the view with one message and `unstarted: true` would pin the placeholder.

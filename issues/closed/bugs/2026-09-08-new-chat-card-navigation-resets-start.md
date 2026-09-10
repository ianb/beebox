---
title: "Codex new chat loses its start binding when card navigation changes the URL"
workstream: paper-cards
area: beebox
labels: [chat, navigation, codex]
discovered-by: agent
discovered-in: worktree-paper-cards — tracing chat companion navigation
resolution: implemented
---

Closed by `12c5c0591`: the route-intent fix preserves a matching pending startup
across companion-card URL changes, with a focused regression and browser check.

A fresh Codex chat opened with `session=new` can lose its pending conversation
and companion-card state when navigation changes the chat URL before the first
message is sent.

## Reproduction

1. Open `/chat?session=new&engine=codex&card=<existing-card-path>`.
2. Let the start selection resolve and confirm the card is open in the
   companion pane.
3. Navigate in a way that adds or changes the companion/card URL state while
   the conversation is still unstarted.
4. The route is re-evaluated as another `session=new` request. The existing
   start binding and open tabs are reset instead of being preserved.

`conversation-intent.ts` only suppresses this request on the first render when
`samePendingStartup()` matches. For a later search-parameter change,
`explicitChatRequest()` returns `kind: "new"` unless a settled session ID is
already available, which is impossible before assignment.

The desired behavior is to preserve the existing pending start binding and
companion tabs across card/companion navigation until assignment. No message
needs to be sent to reproduce this; the failure is in navigation state
ownership.

Related active work: [chat input everywhere](../../features/2026-08-30-chat-input-everywhere.md),
which defines per-tab start bindings, reload recovery, and preserving an
explicit pending recipient during navigation.

## Resolution

The route-intent boundary now recognizes a matching remembered startup on later
URL projections as well as the first route evaluation. It continues to honor an
explicit new request when no matching remembered history exists or when the
requested context, engine, or model changes.

The focused conversation-intent regression covers those distinctions. The
integrated browser reproduction also passed without sending a message: opening
a paper link kept the pending Codex `clientConversationId` unchanged and
retained both the original tour card and the newly opened paper.

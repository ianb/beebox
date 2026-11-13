---
title: "Every chat reload flashes a \"Choosing conversation…\" notice, even when the URL names the conversation"
workstream: unattached
area: beebox
discovered-by: Ian
filed-by: agent
---

Each time a chat page loads, a "Choosing conversation…" notice appears above the chat for a moment. It shows even when the URL already names the conversation with `?session=<id>`. To the person, nothing is being chosen: the conversation is in the URL, and the notice does not say what the box is waiting for.

## What the code does

- `useConversationSelection` (`beebox/src/frontend/src/components/chat/everywhere/conversation-context/use-conversation-selection.ts`) starts every load in the selection state `resolving`. The only exception is a remembered `start` target, which is a new chat that has not had a first send.
- `resolveConversation` (`beebox/src/frontend/src/components/chat/everywhere/resolve-conversation.ts`) then waits for up to two server requests before the state becomes `ready`:
  - reservation recovery (`ensureReservation`);
  - `chat.bootstrap`, which loads the tail of the transcript.

  A `card` or `landmark` request first makes one more request to find its session.
- While the state is `resolving`, `ConversationNotice` (`.../BoxConversationShell/view.tsx`) shows "Choosing conversation…". The composer gets the same text as its reason that sending is disabled (`sendDisabledReasonFor` in `.../InteractiveChat/shell.tsx`).
- If resolution fails, the state becomes `unavailable`. The same notice area then shows the reason with **Retry** and **Start new conversation** buttons. During a deploy, or for a session that was never created, this interactive version can appear on an ordinary reload. See [the deploy-window case](#related).

## Tension

When the URL names the session, the target is known before any request: only its validation and its history are pending. That wait is a transcript-loading state. Showing it as a separate "choosing" step reads as a dialog that asks for something.

## Directions (not decided)

- When the request names a session, render the chat for that target at once. Show the wait as the transcript's loading state, and show the notice only if resolution fails.
- Keep the notice for requests that do pick a conversation (`default`, `landmark`, `card`). Show it only after a short delay so that a fast resolution does not flash it.
- Reword the text by what the person waits for, for example "Loading conversation…".

## Not yet checked

- Which version the developer sees on reload: the plain "Choosing conversation…" text, or the `unavailable` version with buttons.
- How long resolution takes on production. `chat.bootstrap` loads the transcript tail, so a long conversation may hold the notice longer.

## Related

- A first message refused during a deploy leaves `?session=` pointing at a conversation that was never created. A reload then shows "This conversation has no saved transcript in this box." with the buttons. The `missing-session-recovery` workstream covers that case.

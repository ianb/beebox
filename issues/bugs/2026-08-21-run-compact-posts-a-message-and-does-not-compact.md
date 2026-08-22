---
title: "\"Run /compact\" posts a visible /compact message that the agent answers as prose"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-user-stories-refresh — checking the chat Advanced menu against its user stories
---

Choosing "Run /compact" from the chat's Advanced menu put a `/compact` user
bubble in the transcript and the agent replied to it in ordinary prose. No
context was compacted and no "Context compacted" marker was rendered.

The menu item sends the literal text as a user message
(`callback-box/src/frontend/src/components/chat/InteractiveChat-actions.ts:137-142`),
and the send route special-cases a leading slash only to skip its own injections
so the command stays at the start of the text
(`callback-box/src/webapp/routes/chat-send-routes.ts:92-96`). Whether the text is
then interpreted as a command is up to the engine behind the session; on the
engine this box was running, it was not.

The UI already knows how to show a real compaction — `ChatMessages` renders a
"Context compacted" group (`ChatMessages.tsx:193-207`) — so nothing rendered
means nothing happened.

Consequence: a menu item that names a specific action leaves a stray `/compact`
message in the conversation and gives no signal that it did not run. Observed
once, on the test1 clone's default engine; worth confirming per engine.

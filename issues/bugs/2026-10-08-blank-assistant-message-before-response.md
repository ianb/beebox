---
title: "Chat shows a blank assistant message before the response or tool activity appears"
workstream: unattached
area: beebox
labels: [chat]
filed-by: agent
discovered-by: Ian
discovered-in: main — visible once themes colored the assistant message background
---

Some chat themes now give assistant messages their own background
(`beebox/src/frontend/src/themes/chat-material.css`). That made visible an
empty assistant message that often appears before the actual response or
tool results: a colored block with nothing in it.

A likely cause to check first, not confirmed: Claude 5 models emit an empty
thinking block (and sometimes a "progress update" thinking block) before
their first tool call, with no text. `beebox/src/frontend/src/components/chat/message-parsing.ts`
(around lines 390-430) groups thinking and tool parts into activity groups;
an assistant entry whose only content is an empty thinking block, or an
empty text part, may still render as a message. Other candidates: a
placeholder entry created when the turn starts, before any content arrives,
and an entry made of whitespace or a stripped tag.

Fix: an assistant entry with no visible content renders nothing (or only the
"working" indicator the UI already shows), on every theme, in live streaming
and in reloaded history, and for both Claude and Codex chats.

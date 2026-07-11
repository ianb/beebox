---
title: "adapt the SDK's new conversation_reset message"
area: callback-box
needs: [design]
---

The agent SDK (new as of 0.3.20x, seen while bumping the pin to 0.3.205) added a
top-level `SDKConversationResetMessage` (`type: 'conversation_reset'`), distinct
from the existing `type: "system"` subtypes. Per the SDK's own doc comment:

> Emitted by /clear, plan-mode exit, and fresh-session flows. The surface should
> mount a fresh transcript under `new_conversation_id` and reset any cached
> session title.

`adaptSdkMessage` (`src/core/chat/session/messages.ts`) currently just drops it
(`return null`) to satisfy exhaustiveness — chat sessions don't re-key on
`new_conversation_id` today. Worth designing: does our chat UI have an analogous
"fresh transcript" moment it should hook this to (e.g. `/clear`-equivalent,
plan-mode exit), or is it purely an SDK-internal concern we can keep ignoring?

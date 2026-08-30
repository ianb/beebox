---
title: "adapt the SDK's new conversation_reset message"
workstream: unknown
area: beebox
needs: [design]
---

> **Checked 2026-08-18 — still live, unchanged.** Tagged `reconfirm`; removed.
> The obvious way this could have gone moot — the SDK renaming or dropping the
> message across many version bumps — did not happen:
> `SDKConversationResetMessage` still exists at the pinned 0.3.233
> (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:4095-4098`, still in
> the `SDKMessage` union at `:4273`).
>
> We still drop it: `src/core/chat/session/messages.ts:261-267` has
> `case "conversation_reset": … return null;`, with a comment citing this issue
> and saying it is "not yet wired up on our side."
>
> The open design question is also unchanged — whether the chat UI has an
> analogous "fresh transcript" moment worth hooking this to.

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

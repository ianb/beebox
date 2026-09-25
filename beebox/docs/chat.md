# Chat

The conversational surface: web chat with the whole box, threads over external
chats such as Telegram, and everything that serves them. One page per member.

## Members

| Member | What it covers |
|---|---|
| [Sessions](chat/sessions.md) | The backend session lifecycle: phases, queue and drain, park and evict, the shared SDK pump. |
| [History](chat/history.md) | The transcript and the acceptance record, and how a replayed photo is served. |
| [Schedules](chat/schedules.md) | Agent-set timers from a `<schedule>` tag: lifecycle, targeting, persistence, Telegram threads. |
| [Review](chat/review.md) | The nightly pass that writes a title, `contains`, and `contains-evidence` to each session's husk card. |
| [Quick chat](chat/quick-chat.md) | Routing a captured thought to the right conversation, and the rubric that steers it. |
| [Composer](chat/composer.md) | The input bar: its coordination machine and a map of its rendered states. |
| [Scroll](chat/scroll.md) | Verifying the message list's scroll behavior: the harness, the browser procedure, the trace. |

## Owned elsewhere

- Which engine and model a chat thinks with, fixed at the chat's birth: [model policy](model-policy.md).
- The HTTP endpoints a client uses (send, upload, transcribe, default session): [mobile contract](mobile-contract.md).
- The chat component's invariants for code changes (scroll model, streaming to finalize, the input store): `src/frontend/src/components/chat/CLAUDE.md`.
- Husk cards (`_content/chat/web/*.chat.card`) have no current reference; the design is the [chat husks plan](plans/chat-husks.md).

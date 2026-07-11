---
title: "chat session shared core"
needs: [design, decision]
area: callback-box
filed-by: agent
discovered-in: worktree-architectural-review — while doing Track J.1 (chat-session lifecycle union)
---

Track J.1 replaced the `busy`/`intentionalStop`/nullable-`run` cluster in both
`ChatSession` and `ChatThreadSession` with the shared discriminated union in
`chat-session-lifecycle.ts`, and both now drive their SDK stream through the
shared `pumpChatRun` skeleton (`chat-session-consume.ts`). That closed the
easy, safe part of the "admitted near-duplicates" finding.

What's **not** done: collapsing the two classes into one base + two subclasses
(or one class with strategy hooks). The plan called for the extraction; this was
deferred as the entangled part, per the "a working incremental step beats a
broken big one" guidance.

Why it's genuinely entangled (the fork a design must resolve):

- **The per-turn bodies diverge.** ChatSession's message handler does transcript
  durability gating + turn-marker recording + queue draining; ChatThreadSession's
  does `<chat-response>` extraction and per-turn promise resolution, with no
  queue. The shared part is the *loop scaffolding* (already extracted), not the
  body.
- **`stopping` is ChatSession-only.** The queue/drain/intentional-stop machinery
  doesn't exist on the thread path, so a shared base would carry a phase and a
  `messageQueue` that half its subclasses never use.
- ~~**The deliberate SDK-message narrowing stays.**~~ **RESOLVED (Track 6,
  2026-07-09).** The thread-local `adaptSdkMessage` fork is gone —
  `ChatThreadSession` now calls the *shared* `adaptSdkMessage`
  (`core/chat/session/messages.ts`), and the thread-path narrowing lives as
  explicit flow control in `ChatThreadSession.handleMessage`: a `switch` where
  `stream_event` (partial deltas) and `task` (background-task lifecycle) are
  deliberate, commented, logged skips, terminated by `assertNever`. No divergent
  adapter to reconcile; a shared base/composition would inherit the shared
  adapter unchanged. Convergence surfaced no message-handling bug — the three
  newly-visible types (`user`/`stream_event`/`task`) are consumed by nothing on
  the thread path (the pool listens only to `chat-response`/`session`/`turn-text`/
  `close`/`done`), and none leak into `<chat-response>` extraction or turn text.
  Covered by `test/core/chat-thread-session-messages.doctest.md`.

So the remaining extraction is now a **single** design question: whether the
genuinely one-sided queue/durability/`stopping` cluster (the first two bullets,
which live only on `ChatSession`) justifies a base class or composition, or
whether two classes over the now-shared primitives (lifecycle union,
`pumpChatRun`, `adaptSdkMessage`) is the right resting point. No boxholder
decision is pending on the adapter anymore. Protocol/contract is documented at
`callback-box/docs/chat-session-lifecycle.md`.

---
needs: [design, decision]
area: callback-box
filed-by: agent
discovered-in: worktree-architectural-review — while doing Track J.1 (chat-session lifecycle union)
---

# Extract a shared run-lifecycle core from ChatSession and ChatThreadSession

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
- **The deliberate SDK-message narrowing stays.** ChatThreadSession's
  `adaptSdkMessage` intentionally drops `user`/`stream_event` (open boxholder
  question — see the comment at `chat-thread-session.ts`'s adapter). A shared
  adapter would have to preserve that as a per-subclass override, not unify it.

So the remaining extraction is a real design question (base class vs
composition vs leaving them as two classes over shared primitives), plus the
boxholder decision on whether the thread-path SDK narrowing should converge with
ChatSession's adapter first. Protocol/contract is documented at
`callback-box/docs/chat-session-lifecycle.md`.

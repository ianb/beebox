---
title: "Quick chat records a thought as sent when the chat run never starts"
workstream: unattached
area: beebox
labels: [quick-chat, chat]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-clerk-quick-send — a Clerk send to a new chat in the worktree box
---

A quick chat thought (box screen, iOS, or a Clerk send) can be stored as
`sent` while no agent turn ever runs. The person sees "Sent to <chat>"; the
chat has no message, and the new session is never written to disk. The text
survives only in the quick chat record.

Observed 2026-10-15 in the clerk-quick-send worktree box: the Claude login
preflight failed (cause fixed separately: box children lacked `USER`,
`src/hub/supervisor/child-env.ts`). The log showed only
`[ChatSession:error] Run not ready after start`.

The path:

1. `src/webapp/routes/chat/user-message-sender.ts:143-147`: `startAckedRun`
   returns `{ turnId }` once the send is admitted.
2. `src/core/chat/session/run/core.ts:327`: `sendAdmitted` calls
   `onAdmitted()` before composing content and before `startRun`, so the
   admission is settled before the preflight runs.
3. The preflight refuses (`core.ts:176`). The error reaches the turn buffer
   (`send-run.ts:72`) and session listeners; `send()` returns false.
4. `src/webapp/trpc/quick-chat-delivery.ts` maps `{ turnId }` to `accepted`,
   and `submit.ts` saves `state: "sent"`.

The web composer sees the failure through `chat.turnStream`. Quick chat never
subscribes, so it cannot.

Smallest fix found so far: when no run is live, run the provider/login
preflight before admission, and answer a refusal as `{ admitted: false,
reason }` with its own reason (today `send-run.ts:190` hardcodes the busy
text). Quick chat then records the thought as not delivered, with Retry. A
queued message that later fails to drain has the same blind spot.

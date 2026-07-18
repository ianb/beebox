---
title: "Chat backend port hygiene: keep SDK types inside the port, own our transcripts"
area: callback-box
filed-by: agent
discovered-in: worktree-backend-research — deep-pass backend-alternatives research
---

The [coupling audit](../../research/backend-alternatives/2026-07-18-sdk-coupling-audit.md)
(Layers 2–3) found the chat backend port leaks SDK types, and our history subsystem
reads Claude Code's private on-disk store. Three cleanups that shrink coupling and
stand on their own as hygiene, whether or not a second backend ever exists:

1. **Move `adaptSdkMessage` inside `ChatBackend`.** Today
   `ChatBackendRun.messages` is `AsyncIterable<SDKMessage>`
   (`src/services/claude-chat-types.ts:56`), so the SDK's message type flows
   through the port into `src/core/chat/session/{consume,messages,thread,options}.ts`
   and the adapter (`messages.ts:189`) runs above the port. The port should speak
   our stable `ChatMessage` wire union (`src/core/chat/message-types.ts`), with
   the fake scripting `ChatMessage`s directly.
2. **Normalize stream deltas.** `ChatMessageStreamEvent.event` carries raw
   Anthropic `BetaRawMessageStreamEvent` payloads all the way to the frontend
   (`src/frontend/src/machines/chat-actors.ts` narrows them itself). Define the
   small delta shape we actually consume.
3. **Own a durable transcript.** History/backfill/tail parse
   `~/.claude/projects/<encoded-cwd>/<id>.jsonl`
   (`src/core/chat/session/transcript-paths.ts`, `history.ts`, `backfill.ts`,
   `src/cli/lib/session.ts`) — Claude Code's private format, plus lossy cwd
   encoding we already work around. Logging our own `ChatMessage` stream would
   decouple history from the engine's store and remove the encoding hazards.
   Biggest of the three; needs a migration story for existing transcripts.

Order matters: 1 and 2 are mechanical; 3 is a design. Doing 1 first makes 3's
"log the wire messages" trivially well-defined.

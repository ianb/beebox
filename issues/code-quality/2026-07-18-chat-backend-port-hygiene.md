---
title: "Chat backend port hygiene: keep SDK types inside the port, own our transcripts"
workstream: backend-research
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

4. **(Boxholder, 2026-07-18) Consider file-reference images over inline blocks.**
   Chat uploads could be written into the box (alongside existing attachment
   conventions) and sent as paths for the agent to Read, instead of base64
   image blocks through `send()` (`src/services/claude-chat-content.ts`). That
   makes the port's send path text-only — one less backend capability any
   future engine must provide — at the cost of a tool round-trip and trusting
   the agent to look. Box media already works this way; this would unify chat
   with it.

Order matters: 1 and 2 are mechanical; 3 is a design (and 4 folds into its
design space). Doing 1 first makes 3's "log the wire messages" trivially
well-defined.

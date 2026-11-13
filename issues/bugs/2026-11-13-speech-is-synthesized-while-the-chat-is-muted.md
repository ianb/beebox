---
title: "Speech is synthesized while the chat is muted, and a failure shows on the message"
workstream: unattached
area: beebox
discovered-by: Ian
filed-by: agent
---

On a local test box, the chat was muted. A reply's `<speech>` chunk still showed:

> Speech failed: TTS backend answered 429 Too Many Requests: Rate limit exceeded for model gemini-3.8-flash-lite-tts (limit: 100 requests per day on Tier 1). Please retry in 55m53s …

A muted chat should not request speech audio. Here it requested audio, which used up the provider's daily quota, and it showed the failure on a message the person did not want spoken.

## How mute is meant to work

- `useComposerMirrors` in `beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/voice.ts` mirrors the mute state into the composer machine as `SET_MUTE`. It also sends `STOP_SPEECH` when mute turns on.
- In `beebox/src/frontend/src/machines/composerMachine.ts`, the voice `idle` state's `SPEECH_QUEUED` handler has an `isMuted` guard that marks the speech played without playing it.
- The `speaking` and `pausedForSpeech` states handle `SPEECH_QUEUED` with `playSpeech` and no `isMuted` guard.

## Leads (not verified)

- A path that reaches `playSpeech`, or `/api/chat/tts`, without going through the `idle` guard. Candidates:
  - `SPEECH_QUEUED` arriving in `speaking` or `pausedForSpeech`. For example, speech that started before mute was restored on page load: `SET_MUTE` is mirrored in an effect, and the machine starts with `muted: input.muted ?? false`.
  - Another caller of the TTS client. `InteractiveChat/ws.ts` speaks a schedule's `announce` text with `getTTSClient().speak` and does not check mute.
  - Prefetch of audio in `beebox/src/frontend/src/machines/speechPlaybackMachine.ts` or `beebox/src/frontend/src/hooks/useSpeechPlayback.ts`.
- Find which path sets the segment's failed state that `ChatMessages/view.tsx` passes to `SpeechChunk` as `failureReason`.

## Related

The quota of 100 requests a day for the Gemini flash-lite TTS model on Tier 1 is low enough that ordinary dev use runs out. That is a separate decision: change the key's tier, or fall back to another TTS backend on a 429.

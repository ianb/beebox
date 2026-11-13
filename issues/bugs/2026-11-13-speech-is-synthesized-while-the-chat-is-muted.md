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

## Probable cause: a stale failure moves to the newest reply (2026-11-13)

The developer reports that the failure appeared on an ordinary reply, after several muted replies that showed nothing. A failure that appears reliably points to a fixed path, and the code has one. The failure on screen may not come from a new request.

- `speechPlaybackMachine.ts` keeps failures sticky. When playback ends with a failed segment, `statusMessageId` and `segmentFailures` stay set (around lines 233 and 338). Only the next `PLAY` clears them.
- Streamed speech gets a message id of the form `stream-<time>-<index>` (`InteractiveChat/speech.ts`, `dispatch`).
- `InteractiveChat/message-items.tsx` (around line 289) shows the playback status on the newest assistant message whenever the status id starts with `stream`. It does not check which reply the stream belonged to.
- While the chat is muted, `SPEECH_QUEUED` runs only `markPlayed`, which records the id and sends no `PLAY`. So nothing clears the old failure.

So a 429 from an earlier spoken reply stays in the machine, and each new reply that becomes the newest assistant message shows it. The "retry in 55m53s" text is the provider's answer at the time of the original request.

Not yet confirmed: whether a new TTS request went out while the chat was muted. The box's request log for `/api/chat/tts` would show it. If no request went out, the display bug is the whole issue, and the title should change.

Fix direction: bind the playback status to the reply it belongs to, not "the newest message when the id is a stream id". Also clear sticky failures when speech for a later reply is queued, including a muted `markPlayed`.

## Log evidence (2026-11-13)

From the test box's `hub-child.log` and `client-debug.log`:

- A real TTS request went out. The server logged the 429 at 07:04:06.823Z, 0.1 s after a turn completed (`[ChatSession:done]` at 07:04:06.714Z). The page logged `[speech] segment failed` with the same text.
- There was one 429 for that reply, although the reply had 4 `<speech>` segments.
- Replies at 07:13, 07:17, 07:22, 07:25, 07:28 and 07:30 also had `<speech>` segments and logged no 429. The quota window reset at about 08:00Z (07:04 plus 55m53s). So those replies made no TTS request, and mute held for them.
- Successful TTS requests are not logged. So the log cannot show whether the muted replies before 07:04 made requests. In the quota day before the 429, replies on this box held 94 `<speech>` segments, close to the 100-request limit. Other dev boxes may share the key, so this is suggestive, not proof.

So the stale-failure display is not the whole bug: at least one request was made while the chat was muted. The `idle` guard did not apply to it. A composer machine left in `speaking` or `pausedForSpeech` fits the evidence: `SPEECH_QUEUED` there runs `playSpeech` with no mute check, and the failure ends the speech with `SPEECH_DONE`, which returns it to `idle`, where the guard holds for later replies. Not confirmed: how the machine got into that state with mute on.

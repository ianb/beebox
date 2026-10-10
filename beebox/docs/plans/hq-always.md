---
title: "HQ transcription for every dictated message"
status: active
workstream: hq-always
issues:
  - ../../../issues/features/2026-09-18-hq-dictation-default-when-a-key-exists.md
  - ../../../issues/closed/features/2026-08-26-sticky-hq-transcription-preference.md
---
# HQ transcription for every dictated message

Every dictated message gets the HQ pass. Live (streaming) text is sent only when
the HQ pass cannot run or fails. The HQ dictation setting, its defaults, and the
conditionals that choose between the two go away. The agent sees a marker on the
exception (live text), not on the norm.

**Issues addressed:** `2026-09-18-hq-dictation-default-when-a-key-exists.md`,
`2026-08-26-sticky-hq-transcription-preference.md` (superseded).

## Stated preferences this plan trades against

- Boxholder (2026-10-09): HQ is always worth the added seconds; no opt-in, no
  setting. Cost is noted, not gated on measurement.
- Boxholder: the agent sees the exceptional case. Today `stt="hq"` marks the
  norm-to-be.
- `feedback_minimal_concepts_prefer_primitives`: one marker, no new registry.

## What already exists

- Web: every voice send (spoken keyword, Send button via `submitSegment`,
  max-duration) runs through `runKeywordSend`
  (`InteractiveChat/voice-keyword-send.ts`). `wantsHq` there is the only choice
  point: `hq-dictation || narration || intent.hq`.
- The box HQ job (`core/voice-recording/hq-job/core.ts`) classifies a missing
  key as a permanent failure on the first piece. The waiter
  (`lib/audio/hq-wait.ts`) then falls back to the live text. So "no key" already
  resolves to "live text" without a client-side capability check.
- iOS: `NativeComposerView.send` and `sendKeywordIntent` choose live or durable
  HQ preparation from `hqDictationEnabled`/`narrationEnabled`/`.sendHq`. The
  preparation runs on-device `SpeechTranscriber`, then the server, then falls
  back to live text.
- Assembler (`input/targets/chat-assemble.ts`): `stt="hq"` + `stt-service` on
  HQ text, `stt="deepgram"` when live words were captured, `hq="failed"` on a
  fallback.

## Decisions

1. **The box decides availability.** Clients always request HQ when a recording
   exists. A box without a usable HQ key fails the job at once and the client
   sends live text. No client capability check.
2. **Removed:** chat feature `hq-dictation`; box config `hqDictation`; landmark
   `navigation.chat-app.hq-dictation`; `landmarks.hqPreferences` and
   `landmarks.setHqPreference`; admin `hqDictation`; `hq-preference.ts`;
   `HqPreferenceRow`; the per-chat toggle and its refs; narration's coupling to
   HQ; the iOS `hqDictationEnabled` plumbing and `NativeVoiceKeywordSendPlan`.
3. **Stored values tolerated, no migration.** Landmark frontmatter parses
   leniently (unknown keys stripped); `box.json` parses through a non-strict
   zod object; stored per-chat feature maps drop the retired name silently.
4. **Marker.** Every `<speech>` whose text is not the HQ transcript gets
   `stt="live"`: HQ failed, timed out, was skipped by the user, the box has no
   key, or no recording existed. HQ text carries only `stt-service`. The UI
   still reads the old `stt="hq"` and `hq="failed"` on existing messages.
5. **Keyword lost in HQ.** When the HQ transcript lacks the send keyword the
   live pass heard, the HQ text is sent unchanged with the tag appended as
   `<send-message phrase="…" heard="live" />`. The HQ text may still contain
   the spoken command, transcribed differently; the agent reads it for sense.
   The tag name is kept, so checkpoint and send-and-close semantics survive.
6. **Native contract.** Native says "HQ I produced" with `hqText:true` +
   `hqService`, and anything else is live. `hqFallback` stays legal on the wire
   but no longer changes the output. Web keeps posting
   `beeboxHqDictationState` with `enabled:true` so older iOS builds still run
   HQ; current native ignores `enabled` and reads only `diarized`.
7. **`clean up and send`** stays a recognized send phrase (persisted
   preparations decode `sendHq`), dropped from the hints.

## Paths

| Path | Treatment |
|---|---|
| Web keyword send, Send button, max-duration | HQ always (one choice point removed) |
| Web send that settled before parking (idle race) | live, marked `stt="live"` |
| Recovered dictation (no audio) | live, marked |
| iOS conversation composer (button and keyword) | HQ always: on-device, server, live |
| iOS quick chat (box screen) | on-device HQ, else live (`<speech source="box-screen" stt="live">`); no recording reaches the box, so no server pass ([ios-quick-chat-hq](ios-quick-chat-hq.md)) |
| Capture voice clips, preaction transcription | unchanged: already batch-transcribed whole recordings |

## Cost

One HQ call per dictated minute: about $0.006/min on `whisper` or `whisper-llm`,
$0.003/min on `whisper-llm-mini` (OpenAI list prices, 2026). On-device iOS
passes cost nothing.

## Failure modes

| What can fail | Handling | Clear-or-silent |
|---|---|---|
| No HQ key | job fails permanently at once; live text; one dismissible notice | clear (`stt="live"`, notice) |
| Revoked key (401/403) | permanent failure; live text | clear |
| Rate limit / 5xx | job retries; user can "Send live text now"; 5-min budget | clear (pending bubble) |
| Old iOS build | web posts `enabled:true`; old build runs HQ | compatible |
| Old stored feature / landmark / box value | dropped on read | silent, harmless |
| Old messages with `stt="hq"`/`hq="failed"` | UI parser keeps reading them | compatible |

## NOT in scope

- On-device HQ for iOS quick chat: done separately in [ios-quick-chat-hq](ios-quick-chat-hq.md).
- Typed-text-lost-after-error bug: same merge rule, not changed here (see the
  issue's update).
- Browser Web Speech no-key live path.

---
title: "The recording-drop alarm is too aggressive, and it sounds the same for a lost mic and a lost live-text socket"
workstream: unattached
area: beebox
labels: [voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main session — investigating repeated recording alarms on a prod box with a flaky upstream network
priority: important
---

The web client plays `recordingDropped` (`krell-alarm-7.wav`, volume 0.7)
for two different failures. The sound is also much too aggressive. It was a
placeholder choice. It is not a designed cue.

The two failures have different consequences:

1. **Microphone loss.** The OS takes the mic, or the capture pipeline dies.
   No audio is recorded. If the mic does not return within
   `RECONNECT_WINDOW` (8 s), the segment ends. The user must act. A loud cue
   is correct here.
2. **Live-transcription loss.** The Deepgram (or other) socket closes or
   stalls. Recording continues: audio stages to the box and the HQ pass still
   covers it. Only live text stops, and the connect loop reconnects on its
   own. The user loses spoken keywords ("send message" and others) until live
   text returns, because keywords are detected in the live text. The user
   needs to know that. They do not need an alarm.

Both paths call `playRecordingDropped` in
`beebox/src/frontend/src/machines/realtimeTranscriptionMachine.ts`
(`recording.CONNECTION_DEGRADED`, `WS_ERROR`, `SERVER_ERROR`, and the `micDrop`
branches). The cue definitions are in
`beebox/src/frontend/src/lib/audio/earcons.ts`.

## Observed

On 2026-09-30 a desktop Chrome session played the alarm at 21:31:52 UTC.
Deepgram then closed with `1011` NET-0001 at 21:32:00, and live text reconnected
the same second. Capture uploads continued without a gap, so no audio was lost.
The same client's box WebSocket also dropped within a second, which shows that
the cause was the client's upstream network. Later, during a live network test,
the boxholder heard two alarms that matched two measured bursts of upstream
packet loss. Each was a live-text loss with no audio loss.

## Direction

- Give a lost microphone a distinct, clear cue, much less harsh than the
  current klaxon.
- Give a lost live-text socket the smallest possible notice. Candidates: a
  quiet earcon, a small "live text paused — keywords unavailable" indicator
  near the composer, or both. The existing `recordingResumed` cue already marks
  the recovery.
- Replace the sound asset for whatever stays alarm-like. Coordinate with the
  fail-to-start cue (`recordingError`).

## Related gap

The liveness watchdog in
`beebox/src/frontend/src/machines/realtime-transcription-live/transcription-actor.ts`
(`startWatchdog` → `dropLink`) drops a stalled socket without a log line. Only
the server-side close path logs (`socket dropped mid-recording …`). The
client-debug log therefore undercounts drops. Add one `console.warn` on the stall
path so that the frequency can be measured.

The iOS app has its own audio feedback. Check whether it makes the same
conflation before closing this.

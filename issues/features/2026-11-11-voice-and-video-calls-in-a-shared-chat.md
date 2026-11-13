---
title: "People in the same chat can start a voice or video call, optionally transcribed into the chat"
workstream: unattached
area: beebox
labels: [chat, multi-user, voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — boxholder request, 2026-11-11"
---

When more than one person is in a chat, they should be able to start a voice
call, or a voice and video call, from it. The call may be transcribed, so
the conversation lands in the chat where the box agent can use it. Probably
WebRTC.

**Prerequisite:** [who is present in a chat](../closed/features/2026-11-11-chat-shows-who-is-present-and-typing.md)
comes first. A call rings the people present, and its signaling travels the
same per-chat channel that presence and typing signals set up.

## Pieces

- **Signaling.** WebRTC peers exchange offers and candidates through a
  server. The chat's existing WebSocket can carry them.
- **Getting media through.** The site is behind Cloudflare, which proxies
  HTTP and WebSockets but not WebRTC media. Peers on the same network or
  with simple NAT connect directly with a STUN server; others need a TURN
  relay. Options: run coturn on the box host (a new public port and
  service), or use a hosted TURN service (Cloudflare offers one), which is
  an outside account and per-use cost.
- **More than two people.** A direct mesh works for two or three. Beyond
  that, a media server (SFU) forwards each stream; that is a larger piece.
- **iOS app.** Whether calls run in the app's web view or need native
  WebRTC, and how a call keeps going with the app in the background.

## Transcription

Two ways to know who said what:

- **One channel per person (likely better).** Each person's own microphone
  is a separate track, so the speaker is known without guessing. Each
  client could record its own microphone with the existing recording and HQ
  transcription path, and the box merges the pieces by timestamp. No
  diarization needed, and it works the same for two or six people.
- **Diarization** of a mixed recording. Needed only when several people
  share one microphone (two people in one room). See
  [diarization as a capability](2026-08-31-request-diarization-as-capability-not-model.md)
  and [the same speaker across recordings](2026-10-20-same-speaker-names-across-recordings.md).

Related: [listening and note-taking mode](2026-08-29-listening-note-mode.md),
which is about transcribing a conversation the box overhears.

## Direction (boxholder, 2026-11-11)

- **Start with plain browser WebRTC:** direct connections between the
  browsers, signaling over the chat's WebSocket, and a TURN relay for
  networks that need one. A media server (LiveKit, self-hosted or hosted, was
  the leading option in a survey of the field) waits until calls need more
  than two or three people.
- **One recording per person**, transcribed separately, then **folded into
  one transcript.** Start by trusting device clocks: each device stamps its
  recording start with its own wall clock (NTP keeps ordinary computers and
  phones within tens of milliseconds), and transcription supplies word or
  segment timestamps, so utterances interleave in the order they were said.
  Overlapping speech stays as two lines. Take the stamp when the first audio
  arrives, not when recording was requested, since the microphone can take a
  moment to start. Use real time, not the box's simulated clock
  (`boxClockShiftMs`). Cheap guard: measure each device's offset from the
  box once per call (one round trip over the signaling socket) and flag a
  skew over a second, instead of correcting for it.
- **Fold in the activity as well,** the way chat already folds the agent's
  tool activity between replies: chat messages typed during the call, the
  agent's work, and cards opened or changed land on the same timeline as
  the speech.

## To decide

- Whether transcription is per call (someone turns it on) and how everyone
  in the call sees that it is on.
- What lands in the chat: the full transcript, a summary, or both, and
  whether the agent responds during the call or only after.
- Whether the box agent can take part in a call by voice.
- TURN: self-hosted or a hosted service.

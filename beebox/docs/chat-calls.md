# Chat calls

People who have the same chat open can call each other from it. A call is
voice first; anyone on it can turn their camera on, and anyone can turn
transcription on for everyone. A transcribed call lands in the chat as one
`<call>` entry when it ends. Plan: [implemented-plans/chat-calls.md](implemented-plans/chat-calls.md).
Presence, which decides who is offered a call: [chat-presence.md](chat-presence.md).

## Who is on a call

A call belongs to one chat room (`core/chat/presence/`), at most one per
room, held in memory. Holding a `chatCall.join` subscription is being on the
call; it does not depend on focus, so switching tabs keeps you on. People
present in the chat see the call on their `chatPresence.watch` stream
(`{ t: "call", call }`), which is how they are rung. Nobody who does not have
the chat open is rung.

- `join({ sessionId, callId: null })` starts a call, or joins the one going,
  so two people pressing call at once land in one call.
- A call holds three members (`CALL_MEMBER_CAP`); a fourth gets `{ t: "full" }`.
- A call nobody answers within 45 seconds ends with `{ t: "ended", reason: "no-answer" }`.
- The call ends when its last member leaves.
- The box's agent and a caller with no identity cannot join.

Each subscription is a peer with a server-made `peerId`. Every mutation
(`signal`, `setTranscribing`, `leave`, `registerRecording`) names the
caller's own `peerId`, and the server accepts it only when that peer is on
that call and belongs to `ctx.user`. The client also calls `leave`
explicitly, because tRPC drops a subscription stop that arrives before the
subscription registers
(`issues/bugs/2026-11-12-trpc-ws-drops-early-subscription-stop.md`).

## Media

Peers connect directly with WebRTC, one `RTCPeerConnection` per pair, using
perfect negotiation (the lexically smaller `peerId` is polite). Offers,
answers and candidates travel as `signal` frames; the server forwards them
without reading them. `chatCall.iceServers` returns STUN, plus short-lived
Cloudflare TURN credentials when the box is granted the `cloudflare-turn`
secret (`{ keyId, apiToken }`, see [secrets.md](secrets.md)). The token
stays on the server; each mint is logged. Without the key, calls connect
where a direct path exists, and a failed connection names the missing relay.

In the iOS app, the web view grants the microphone and camera to the box's
own page, and the page reports `beeboxCallState { active }`
([mobile-contract.md](mobile-contract.md) B16). While a call is active the app
holds a voice-chat audio role and native dictation, capture and voice notes
do not start. Putting the app in the background leaves the call.

## Transcription

Transcription is off until a member turns it on; everyone on the call and
everyone present sees that it is on. While it is on, each device records only
its own microphone, borrowing the call's own track, so muting mutes the
recording too. Each recording is registered with the call before capture
starts, then goes through the ordinary voice staging upload and HQ job with
word timing. The device stamps the real wall-clock time of its first audio;
the box's simulated clock is never used.

When a transcribed call ends, the server waits up to 30 minutes for every
registered recording, then folds them: words become utterances, placed by
each device's own clock, interleaved with the chat's typed messages, the
agent's replies and work, and card changes made during the call. A device
clock more than a second off the server's is noted in the entry, never
corrected. A recording that never arrives is named as missing. The fold
state lives in `_tmp/calls/<callId>.json` until the `<call>` message is in
the chat's transcript, so a restart in between delivers it again. Typed chat
messages are kept in that record as they are sent, because a busy agent
writes them to its transcript only when their turn starts.

The result is delivered as a `<call>` user message. The agent acknowledges
it with `<ack kind="no-response"/>` and uses it when someone asks. When the
entry holds no speech because nobody's audio could be transcribed (for
example, the box has no transcription key), the agent says so in one
sentence instead, so the failure is not silent.

## Known limits

- A desktop tab closed while recording leaves the call and finalizes its
  recording on `pagehide`, but the finalize is written to the page's
  IndexedDB queue asynchronously. If the page is gone before that write, the
  uploaded audio is never sealed, and after 30 minutes the call entry names
  that person as missing.
- When a server restart drops a call, the starter's page reconnects with its
  original "start or join" request, which starts a new call for a moment; the
  page sees a call it did not join and leaves it at once, but people present
  may see it ring briefly.
- Cards *opened* during a call are not on the timeline; card changes are.
- Calls hold three people; there is no media server.
- Nothing about calls has run on a real iPhone yet: echo cancellation in the
  voice-chat audio role, Bluetooth routing, and leaving on backgrounding are
  unverified.

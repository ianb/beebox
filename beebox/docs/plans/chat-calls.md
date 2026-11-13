---
title: "Calls in a shared chat, optionally transcribed into it"
status: draft
workstream: chat-presence
issues:
  - ../../../issues/features/2026-11-11-voice-and-video-calls-in-a-shared-chat.md
---
# Calls in a shared chat, optionally transcribed into it

Box members who have the same chat open can start a voice call from it, turn
their camera on, and turn on transcription. Media goes browser to browser
(WebRTC), with signaling over the chat's existing tRPC WebSocket and a
Cloudflare TURN relay when a direct path fails. When transcription is on,
each device records only its own microphone through the existing voice
recording and HQ transcription path; when the call ends, the box folds the
per-person transcripts by wall-clock time into one `<call>` entry in the chat.

**Issues addressed:** `issues/features/2026-11-11-voice-and-video-calls-in-a-shared-chat.md`.
Related, not resolved: `2026-08-29-listening-note-mode.md` (overheard
conversation, one mic), `2026-10-20-same-speaker-names-across-recordings.md`
(not needed here: one track per person names the speaker),
`2026-11-12-trpc-ws-drops-early-subscription-stop.md` (applies to the call
subscription too; see *Failure modes*). Searched the queue for "call",
"webrtc", "turn", "ring": no other items.

**Boxholder decisions, 2026-11-12** (asked in session; these settle the
issue's "To decide" list):

- Plan and build both calls and transcription in this round.
- Calls start as voice; anyone can turn their camera on during the call.
- Transcription: anyone in the call can turn it on or off; everyone sees
  that it is on.
- The folded transcript lands in the chat as one collapsible entry; the agent
  reads it and replies only when someone asks. The agent does not join calls
  by voice.
- TURN: Cloudflare's hosted TURN; the boxholder will create the key.
- Earlier direction (issue, 2026-11-11): plain browser WebRTC, mesh for two
  or three people, one recording per person stamped with the device's wall
  clock at first audio, real time and not `boxClockShiftMs`, one offset round
  trip per call to flag skew over a second, and fold chat activity onto the
  same timeline.

## Design

### Situations

- When Priya and Tomas both have the dinner-planning chat open in the
  evening, I want to talk it through instead of typing, so we can settle it
  in two minutes.
- When Odette joins a call already going, I want to see who is on it and
  hop in with one tap, so I do not interrupt by asking in text.
- When we are deciding something the box should remember (who brings what),
  I want the conversation written into the chat, so the agent can act on it
  afterwards without anyone retyping.
- When I want my face on screen (showing the dish), I want to turn on my
  camera mid-call without restarting it.
- When Tomas is just reading the chat while Priya's call rings, he wants to
  ignore it without being nagged; the ring stops when he does nothing.
- When I want an off-the-record chat, I want transcription off by default,
  and to see clearly if someone turns it on.

### Right place, right time

| Situation | Act, show, or quiet | Surface | Attention |
|---|---|---|---|
| Others present, no call | Show a call button | A phone button beside the presence heads under the profile avatar, only when someone else is present | Background |
| A call starts while I am present | Show | A call bar at the top of the chat: "Priya is calling · Join"; one short chime | Interrupts once, then waits |
| I am in the call | Show | The call bar: heads of who is on the call, mute, camera, transcribe, leave; video tiles above the transcript when anyone sends video | Waits to be found |
| Transcription turns on/off | Show | A "Transcribing" marker in the call bar for everyone, and a line in the chat timeline when it changes | Background |
| Call ends, transcribed | Show | One `<call>` entry in the chat, collapsed to a summary line ("Call · Priya, Tomas · 12 min"); expands to the transcript | Waits to be found |
| Call ends, not transcribed | Quiet | Nothing in the chat | — |
| I am not present (chat not open) | Quiet | No ring; the call is not visible until I open the chat | — |

Calls are only offered to people present, which reuses the presence rule:
nobody is rung on a chat they do not have open.

### Spirit

- **Serves:** "Feel like a place" — people in the same chat can talk, as in
  a room; and "the best stuff comes from people": the conversation lands
  where the agent can use it.
- **Risks:** being watched. A transcript nobody noticed is a surprise
  record. Guard: transcription is off by default, the marker is persistent
  for everyone, every change of state is a timeline line naming who did it,
  and nothing is recorded while it is off (the recorder does not run).

### Trust

The box takes no action of its own during a call. After the call it
delivers the `<call>` entry; the agent's rung is "read and acknowledge
silently" (`<ack>`), and it acts only when a person asks. Starting a call,
joining, camera, and transcription are each a person's own explicit tap.

### When it goes wrong or does nothing

- **No one answers:** the caller's bar says "Ringing…" and, after 45 seconds
  with nobody joined, "No one joined"; the call ends.
- **Connection fails** (no direct path and no relay configured, or relay
  failure): the bar shows "Can't connect to Tomas" on that person's head; the
  rest of the call continues. With no TURN key granted the call still works
  where a direct path exists; the bar says nothing until a connection fails,
  then names the cause ("this box has no relay; ask the boxholder").
- **Microphone or camera denied:** the bar says so and links the browser's
  standard way to allow it; the person can still listen.
- **Transcription partly fails** (one person's HQ job fails or times out):
  the `<call>` entry includes the others and says "Tomas's audio could not
  be transcribed".
- **A device clock is off by more than a second:** the entry says so
  ("Tomas's clock was 3 s off; order may be wrong near overlaps").

### Walkthrough

Priya and Tomas both have the chat open; each sees the other's head. Priya
taps the phone button. Her browser asks for the microphone, then the server
creates a call in the chat's room and sends every watcher a `call` frame.
Tomas's page chimes and shows "Priya is calling · Join". He taps Join; his
page opens the call subscription, and the two pages exchange an offer,
answer, and ICE candidates through the server. Audio flows. Priya taps
Transcribe; both bars show "Transcribing" and each page starts recording its
own mic into a voice staging session. After ten minutes Tomas leaves, then
Priya; each page finalizes the recording it registered with the call when transcription turned on. The
server waits for both HQ jobs, folds the words by wall-clock time with the
two chat messages Tomas typed during the call, and delivers one `<call>`
message. The agent acknowledges silently. The next morning Priya asks "what
did we decide about dessert?" and the agent answers from the transcript.

## Smallest fix and budget

The smallest thing that answers the issue's first sentence is a two-person
voice call with no transcription: a call frame on the presence channel, a
signal mutation, one peer connection, and a bar. About 700 lines with tests.
The boxholder asked for both halves in this round.

Estimated changed lines (source + tests), by track:

| Track | Source | Tests |
|---|---|---|
| A. Call room and signaling (server) | 260 | 220 |
| B. ICE servers and the TURN key | 110 | 60 |
| C. Call engine (browser: mesh, perfect negotiation, media) | 420 | 120 |
| D. Call UI (button, bar, ring, video tiles) | 330 | 60 |
| E. iOS: media permission, call audio session, bridge | 140 | 50 |
| F. Recording a call (mic stream injection, first-audio stamp, word timing) | 260 | 140 |
| G. Fold and deliver the `<call>` entry | 320 | 220 |
| **Total** | **1,840** | **870** |

**BIG CHANGE: about 2,700 changed lines.** The size comes from three
independent halves the boxholder asked for together: live media (C, D, E),
the call room (A, B), and transcription (F, G). Each half is already near
its minimum: no SFU, no CallKit, no new card type, the transcript lives in
the chat message instead of a card. Authored docs (reference doc, contract
rows, secrets row, agent prompt line) add about 200 lines. **Approved:** the
boxholder chose "plan and build both" from an option that stated it would
be near or over the 2,000-line mark (2026-11-12). The plan review added
recording registration, borrowed-track capture, and the HQ timing change;
revised estimate about 2,900.

## Stated preferences this plan trades against

- **Boxholder: avoid bridge changes where web signals suffice** (chat
  presence direction). Calls need two iOS changes web signals cannot do: the
  web view must be allowed the microphone and camera without a second
  prompt each time, and the app's audio session must switch to a voice-chat
  role during a call or native dictation will tear the call's mic down
  (`ios-app/BeeBox/Services/AudioSessionRouting.swift:115-130`, `deactivate()`
  restores `.playback`). Both are recorded in `docs/mobile-contract.md`.
- **Operational simplicity beats per-call cost** (boxholder memory): hosted
  TURN instead of running coturn; the server mints short-lived credentials
  with the existing secrets pattern.
- **Minimize invented concepts:** the call is a frame kind on the existing
  presence room, the recording is the existing voice staging session, the
  result is a delivered user message like `<capture>`. New nouns: call,
  call member, signal, call recording registration.
- **`beebox/AGENTS.md` "no features beyond the task":** no call history UI,
  no missed-call notifications, no SFU.

## What already exists

- **Presence room and channel** (reuse): `src/core/chat/presence/room.ts`
  keeps one in-memory room per `(boxRoot, sessionId)`; its frame union says
  later kinds "(typing, call signaling, ringing) join this union".
  `src/webapp/trpc/routers/chat-presence.ts` derives identity from
  `ctx.user`, never the client.
- **Mint-a-short-lived-key procedures** (copy the shape):
  `src/webapp/trpc/routers/transcription.ts:67-117` `deepgramTempKey`:
  `resolveSecret`, `PRECONDITION_FAILED` "ask the boxholder to grant…",
  `recordSecretMint`, `ky.post(…, { retry: 1, timeout: 15_000 })`.
- **Secret reader per key** (copy): `src/core/deepgram-key.ts:42-60`; key
  names in `docs/secrets.md:68-78` and `src/core/secrets/uses.ts`.
- **PCM mic capture for HQ** (reuse, add stream injection):
  `src/frontend/src/machines/realtime-transcription-live/transcription-mic.ts:106-133`
  acquires its own stream and feeds a `MediaStreamAudioSourceNode` (`:123`).
- **Voice staging upload and HQ job** (reuse): `lib/audio/voice-stager.ts:120`
  `startStagedRecording`; routes `webapp/routes/capture/{create,upload,finalize-voice}.ts`;
  `core/voice-recording/hq-job/core.ts:78` calls `transcribeAudioHq(params, {service})`
  with no options and joins piece text only (`:161`).
- **Word timestamps** (reuse): `core/transcription/dispatch/core.ts:83`
  `wordTimestamps?: boolean`; supported by whisper (`whisper.ts:120`),
  voxtral (`voxtral/request.ts:62`), OpenRouter verbose; "whisper-llm
  variants never return word timing" (`capture/prepare/transcribe-clips.ts:116-118`).
- **Wall-clock timeline merge** (model): `core/capture/prepare/timeline.ts:99-120`
  `absoluteStart = recordedMs + w.start*1000`.
- **Delivered user messages** (reuse): `src/shared/delivered-user-message.ts:53`
  closed kind registry; `core/chat/session/deliver-user-message.ts:154`
  `deliverUserMessage`; transcript chip in `user-message/user-entry-content.tsx:54-70`.
- **Silent agent turns** (reuse): the agent's `<ack>` (prompts.ts:31,
  narration mode at prompts.ts:214).
- **WebSocket path** already proxies through hub, dev router, nginx, and
  Cloudflare (`src/hub/server/core.ts:555-610`, `deploy/nginx/beebox.conf:18-36`).
- **Headers:** Permissions-Policy leaves camera and microphone at defaults
  (`src/webapp/document-security-headers.ts:16-18,33`). The server, not the
  browser, calls Cloudflare, so `src/lib/csp.ts` `connect-src` is unaffected.
- **iOS:** `Info.plist:50-55` has microphone and camera usage strings (their
  wording does not mention calls); `UIBackgroundModes` has only `audio`
  (`:66-69`); no `requestMediaCapturePermissionFor` in `ChatWebView.swift`.

## Prior art (external)

- WebRTC "perfect negotiation" pattern for glare-free offers between two
  peers that may both start: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation — adopted (pattern only, no code copied; no ACKNOWLEDGEMENTS entry needed for a documented API usage pattern).
- Cloudflare Realtime TURN: the server POSTs to
  `https://rtc.live.cloudflare.com/v1/turn/keys/{keyId}/credentials/generate-ice-servers`
  with `Authorization: Bearer <api token>` and `{ "ttl": seconds }`, and gets
  `{ iceServers: [...] }` to hand to `RTCPeerConnection`:
  https://developers.cloudflare.com/realtime/turn/generate-credentials/ — adopted. Verify the response shape with the boxholder's key before track B lands.
- WKWebView `getUserMedia` (iOS 14.3+) and `WKUIDelegate.webView(_:requestMediaCapturePermissionFor:initiatedByFrame:type:decisionHandler:)`
  (iOS 15+): https://developer.apple.com/documentation/webkit/wkuidelegate/3763087-webview — adopted. Unverified: whether WebKit keeps a call's audio alive with the app backgrounded and `UIBackgroundModes: audio`; the plan treats backgrounding as leaving the call.
- Mesh limits: each person uploads one stream per other member; two to four
  people on a voice call is routine, video at four strains phone uplinks.
  Evaluated-only; the cap below follows from it.

## Ontology

- **Room** (exists, `room.ts`): `(boxRoot, sessionId)`; holds watchers.
- **Watcher** (exists): one presence subscription.
- **Call** (new): at most one per room. Identified by `callId` (random,
  server-made). Holds `members`, `transcribing`, `startedAt` (real ms),
  `startedBy`, `transcribingChanges[]`. Not a card, not persisted, except the
  fold record below. Ends when its last member leaves or nobody joins within
  45 s.
- **Call member** (new): one call subscription (one tab or app). Identified
  by `peerId` (server-made per subscription), carries the `person`. Every
  call mutation names its `peerId`. A person with two tabs could join twice;
  the client prevents it, the server does not need to.
- **Signal** (new): an opaque SDP or ICE payload from one `peerId` to
  another in the same call. The server forwards it and never reads it.
- **Call recording** (new link, existing thing): a voice staging session
  (`core/capture/staging-store`, kind `voice`) that a member registers with the
  call before capture starts (`registerRecording`); its finalize carries
  `firstAudioAtMs` (real wall clock at first audio).
- **Fold record** (new, small file): `_tmp/calls/<callId>.json` written when
  transcription first turns on, listing members, transcription changes, chat
  events, and registered recordings, so a server restart between call end and
  fold does not lose the call. Removed after delivery.
- **`<call>` message** (new delivered-user-message kind): attributes
  `people`, `duration`, `started`, optional `partial` and `skew`; the body
  is the folded transcript.

## Tracks / scope

### A. Call room and signaling (server)

- **What:** add calls to the presence room, a call subscription that is the
  membership, and a signal mutation.
- **Why:** presence ends on blur, but a call must survive the person
  switching tabs; ringing and signaling need a server path.
- **Direction:**
  - `room.ts`: per room `call: Call | null`. Watcher frames gain
    `{ t: "call", call: { callId, members: PresentPerson[], transcribing, startedAt } | null }`,
    sent on join and on change, so present people see ringing and who is on.
    `others` and `call` are both states, so the watch router keeps the
    latest unsent frame per kind instead of replacing the whole queue
    (`chat-presence.ts:47` clears it today); a test interleaves both kinds.
  - New `src/webapp/trpc/routers/chat-call.ts`:
    - `chatCall.join({ sessionId, callId? })` subscription: with no
      `callId` it starts a call (refused if one exists, returning the
      existing id); with one it joins. First frame `{ t: "joined", peerId,
      callId, serverNowMs }` (real `Date.now()`, for the clock check). Then
      `{ t: "members", members: { peerId, person }[] }` on change and
      `{ t: "signal", from: peerId, data }`. `finally` leaves.
    - `chatCall.signal({ sessionId, callId, from: peerId, to: peerId, data })`
      mutation: forwards to that member only; `data` is a JSON object under
      64 KB.
    - `chatCall.setTranscribing({ sessionId, callId, peerId, on })` and
      `chatCall.leave({ sessionId, callId, peerId })` mutations.
    - Every mutation names the caller's `peerId`; the server accepts it only
      when that peer is a current member of that call and its person's email
      matches `ctx.user`. A person with two subscriptions has two peers, and
      each request says which one it comes from.
    - Identity from `ctx.user` as presence does; the agent never joins.
  - Mesh cap: three members, per the issue's "two or three people". A fourth
    is refused with a frame `{ t: "full" }`.
  - 45-second no-answer timeout ends a call with only its starter.
- **Vocabulary lock-ins:** `callId`, `peerId`, frame kinds `call`,
  `joined`, `members`, `signal`, `full`, `ended`.
- **First chunk:** `room.ts` call state + pure `callFrame` / membership
  logic with tests; no router yet.

### B. ICE servers and the TURN key

- **What:** `chatCall.iceServers` query returning STUN plus, when the box is
  granted `cloudflare-turn`, short-lived TURN credentials.
- **Direction:** `src/core/cloudflare-turn-key.ts` reads
  `{ keyId, apiToken }` via `resolveSecret({ name: "cloudflare-turn", purpose: "calls", access: "server" })`;
  the procedure calls `generate-ice-servers` with `ttl` 3 hours and
  `recordSecretMint`. Without the key it returns `stun:stun.cloudflare.com:3478`
  and `relay: false`. Add rows to `docs/secrets.md`, `uses.ts`, and the
  security report's egress table.
- **First chunk:** reader + query + test with a stubbed fetch.

### C. Call engine (browser)

- **What:** a `CallEngine` per joined call: local media, one
  `RTCPeerConnection` per other member, perfect negotiation (polite = the
  smaller `peerId`), mute, camera on/off, connection state per peer.
- **Direction:** `src/frontend/src/lib/call/` with a pure reducer for call
  UI state (members, per-peer connection state, local mic/camera state) and
  a thin effectful engine. getUserMedia `{ audio: { echoCancellation: true, noiseSuppression: true } }`;
  camera adds a video track via `addTrack` + renegotiation. Leaving closes
  every peer and stops local tracks.
- **First chunk:** the reducer and negotiation decision functions, tested.

### D. Call UI

- **What:** phone button beside the presence heads (only with someone else
  present); call bar at the top of the chat for ringing and in-call
  controls; video tiles when any video exists; one short chime on ring.
- **Direction:** faces in `components/app-bar-faces/` (pure) and wiring in
  `components/call/`. The bar renders in the chat's `statusBanners` slot
  (`components/chat/everywhere/InteractiveChat/view.tsx:295-323`), which also shows under the iOS
  native composer. Remote audio plays through hidden `<audio autoplay>`
  elements.

### E. iOS

- **What:** grant media capture to the box's own origin; switch the audio
  session to a call role while the page reports an active call; disable
  native dictation during a call.
- **Direction:** `Coordinator` implements `requestMediaCapturePermissionFor`:
  `.grant` when the frame's origin is `allowedOrigin`, `.deny` otherwise.
  New web→native channel `beeboxCallState { active }` (contract row B16).
  `AudioSessionRouting` gains `activateCall()` (`.playAndRecord`,
  `.voiceChat`, `[.defaultToSpeaker, .allowBluetoothHFP]`); dictation and
  capture refuse to start while the call role is held. Backgrounding the app
  leaves the call (the page goes hidden; the engine leaves on `pagehide` /
  `visibilitychange` hidden in the native shell). Usage strings mention
  calls.

### F. Recording a call

- **What:** while transcription is on, each member records its own mic into
  a voice staging session, stamped at first audio.
- **Direction:**
  - **Register before recording.** When transcription turns on, each member
    creates a voice staging session and calls
    `chatCall.registerRecording({ callId, peerId, voiceSessionId })`; the
    server writes it into the fold record before the page starts capture.
    Capture starts only after that succeeds. The fold therefore knows every
    recording it must wait for, even if the tab closes and the staging queue
    uploads the audio later.
  - **Borrow the call's track.** `MicCapture` gains a borrowed mode: it takes
    the call engine's own mic `MediaStream`, never stops its tracks, and
    never reacquires (`transcription-mic.ts:181` recovery is skipped). Mute
    is `track.enabled = false` on that one track, so the recording is silent
    while muted. If the track ends (mic lost), the recording finalizes; when
    the call engine gets a new track, it registers and starts a new
    recording.
  - **Stamp at first audio.** `firstAudioAtMs = Date.now()` when the worklet
    delivers its first frame.
  - **Wire and storage change.** `VoiceFinalizeBodySchema`
    (`finalize-voice.ts:36-40`) gains an optional
    `call: { callId, firstAudioAtMs }`; with it, `hq` may be null-emission
    (no composer emission waits on a call recording). `transcribeAudioHq`
    (`dispatch/core.ts:258`) gains a `wordTimestamps` option passed through to
    the service; the HQ job adds each piece's start offset; the stored HQ
    result (`staging-schema.ts:94`) gains optional `words: { start, end, text }[]`.
    Additive fields in `_tmp` staging manifests; no migration.
  - **Words, not segments.** The direction allows segment timing, but no
    service returns segments through the dispatcher today (they are parsed
    inside voxtral and OpenRouter only for diarized text); words are the
    exposed API. When the configured `hqService` cannot return word timing
    (whisper-llm variants), the job uses `whisper` for that recording.
  - Turning transcription off finalizes the current recording; on again
    registers a new one.
- **Vocabulary lock-ins:** `firstAudioAtMs`, `clockOffsetMs` (client minus
  server, real clocks; used only for the skew warning).

### G. Fold and deliver

- **What:** when a transcribed call ends, wait for its recordings' HQ jobs,
  fold, and deliver one `<call>` message.
- **Direction:**
  - Fold record `_tmp/calls/<callId>.json`: written when transcription first
    turns on, updated on every member change, transcription change,
    recording registration, and card change, so it alone can rebuild the
    fold. At startup the server resumes any fold record whose call has no
    live members.
  - **Activity on the timeline**, by source:
    - Typed chat messages and the agent's replies and tool work: read at fold
      time from the chat's own transcript (`session/load-history.ts`), the
      entries timestamped inside the call. Agent work is one line per turn
      naming its tools ("Box edited Dinner plan.card"); replies are their
      text. Nothing is recorded during the call for these, so a restart
      loses none.
    - Cards changed: `file-change` events (`event-bus/schemas.ts:91`) for
      card paths during the call, appended to the fold record.
    - Cards *opened* by a person are UI state reported only in each page's
      `<chat-app>` snapshot; not folded (see *NOT in scope*).
  - Pure `foldCall({ recordings, activity, transcribingChanges })`: words →
    utterances (split on a pause over 1.2 s), absolute time
    `firstAudioAtMs + word.start`, merged and sorted with activity;
    overlapping utterances stay as separate lines. Device clocks are
    trusted; `clockOffsetMs` over one second only adds the skew warning, per
    the direction ("flag a skew over a second, instead of correcting for it").
  - Wait budget 30 minutes per call; missing recordings become a `partial`
    note naming the person.
  - Deliver `<call people="Priya, Tomas" duration="12:04" started="…">…</call>`
    via `deliverUserMessage`. New codec kind `call`, chip
    `CallChip` (collapsed summary, expandable transcript).
  - Agent prompt line: a `<call>` is a transcript of a call between people
    in this chat. Reply with exactly `<ack kind="no-response"/>` and take no
    action on delivery, even when the call mentions tasks; use it when
    someone asks. The knowledge audit checks both halves.

## Could this be simpler?

- **Simplest:** two-person voice, no transcription, no TURN, no iOS change.
  It fails on cellular and office networks (no relay), on iOS (no mic grant,
  dictation tearing down the call), and on the boxholder's request for
  transcription. Each kept piece answers one of those.
- **Transcribe the mixed call on one device:** smaller (one recording, no
  fold), but loses who said what and needs diarization; the boxholder's
  direction picks one track per person.
- **Store the transcript as a card:** the capture precedent. Rejected: a new
  card type adds schema and instructions; the chat message is already the
  durable record the agent reads.
- **Separate call room module:** rejected; calls live in the presence room
  so ringing reaches exactly the people present.

## Subplans

None.

## Failure modes

> **Critical gap (accepted risk):** tRPC drops a `subscription.stop` that
> arrives before registration (`issues/bugs/2026-11-12-trpc-ws-drops-early-subscription-stop.md`).
> A call member who leaves within milliseconds of joining could stay a
> member until the socket closes. The call engine sends an explicit
> `chatCall.leave` mutation on leave as well, which closes that window for
> calls.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Both sides send an offer at once | Planned: negotiation unit test | Perfect negotiation, polite peer rolls back | Clear (connects) |
| No direct path, no TURN key | No (network) | ICE state `failed` → per-person "Can't connect" with the cause | Clear |
| TURN mint fails (Cloudflare down, key revoked) | Planned: stubbed fetch | Falls back to STUN, logs, UI as above | Clear |
| Signal for a peer that left | Planned | Dropped server-side; sender ignores | Silent, harmless |
| Fourth person joins | Planned | `full` frame → "Call is full (3)" | Clear |
| Server restart mid-call | Planned (fold-record resume test) | Subscriptions drop; clients show "Call ended"; the fold record lists members and registered recordings and is resumed at startup | Clear |
| Member closes tab mid-transcription | Planned | The recording was registered before capture, so the fold waits for it; the staging queue (IndexedDB) uploads it on next open; after 30 min the fold marks it partial, naming the person | Clear in the entry |
| HQ service lacks word timing | Planned | Job switches to whisper; if whisper is not granted, segment of the whole recording placed at its start time, marked `partial` | Clear |
| Muted person's mic while transcribing | Planned (borrowed-track test) | Recorder borrows the call's one track; mute disables it, so the recording is silent; mic loss finalizes and a new recording is registered | Clear |
| Device clock skew > 1 s | Planned (fold test) | `skew` attribute and a sentence in the entry | Clear |
| iOS dictation started during a call | Planned (Swift test) | Refused while the call role is held | Clear (button disabled) |
| iOS app backgrounded during a call | No (device) | Page hides → engine leaves | Clear to others (member leaves) |
| Very long call (2 h) makes a huge message | No | Accepted: ~25k tokens; noted in docs | Visible |

## Agent-flow / user-flow edge cases

- **Wrong tag:** ADDRESSED — the agent reads `<call>` only; prompt line in G.
- **Stale ref:** ADDRESSED — no doc reference; the transcript is inline.
- **Two agents:** ADDRESSED — delivery goes through `deliverUserMessage`,
  which queues when the session is busy.
- **Hand-edit drift / fabricated values:** not applicable; nothing hand-written.
- **Validation error UX:** ADDRESSED — a malformed `<call>` parses to text.
- **Transition state:** ADDRESSED — old clients without call UI never join;
  old iOS builds without B16 keep the default audio session (call may break
  when dictation runs) — release note.
- **Two tabs of one person:** ADDRESSED by the client (a tab already in the
  call shows "On the call in another tab").

## NOT in scope

- SFU / more than three people: mesh cap; LiveKit later.
- CallKit, ringing people who are not present, push notifications for calls.
- Calls continuing with the iOS app in the background.
- Screen sharing.
- The agent joining by voice or replying during the call.
- Folding cards *opened* into the timeline: the direction asked for "cards
  opened or changed". Changes are folded (`file-change` events); openings
  exist only in each page's `<chat-app>` snapshot and would need a new
  page→server report. Boxholder decision to confirm.
- Call history UI or missed-call markers.
- Fixing the tRPC early-stop bug itself (own issue).

## Open design questions

1. **Ring sound:** one short chime once (lean), or silent.
2. **No-answer timeout** 45 s (lean).
3. **Mesh cap** 3, per the direction.
4. **Whisper fallback** for word timing costs an OpenAI call per recording
   when the configured service is whisper-llm. Lean: accept.

## Knowledge audits

One `knows_directly` entry: the agent, given a `<call>` message, acknowledges
silently and later answers a question from it. Run against a worktree box
with the scripted message before landing.

## What will hold this after it ships

- `room.test.ts` / `chat-call` router tests: call start, join, cap,
  no-answer end, signal forwarding only within a call, leave.
- Pure tests: negotiation decision (`polite`), call UI reducer, `foldCall`
  (ordering, overlap, skew, partial), HQ word-offset join.
- Codec round-trip test for `<call>`.
- Swift test: media-capture decision by origin; audio session refuses
  dictation in the call role.
- One browser exhibit with two simulated members: ring, join, transcribe,
  the `<call>` entry. Real media between two headless browsers uses Chrome's
  fake devices (`--use-fake-device-for-media-stream`).

## Implementation order

1. A: room call state and pure logic, then the router.
2. B: TURN key reader and `iceServers`.
3. C: call engine reducer, negotiation, then the effectful engine.
4. D: faces, bar, wiring; browser check with fake devices.
5. F: mic stream injection, first-audio stamp, HQ word timing.
6. G: fold record, `foldCall`, delivery, codec, chip, prompt line.
7. E: iOS permission, call audio role, B16.
8. Docs: `docs/chat-calls.md`, contract rows, secrets row, security report.

## Rollout shape

Done when the tests named above pass, the exhibit shows a two-person call
with transcription producing a `<call>` entry, and the iOS build compiles
with the Swift tests passing. The TURN path is verified once with the
boxholder's key (test data only). No data migration. The knowledge audit
lands run.

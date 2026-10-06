---
title: "Stream speech audio from the provider to the browser"
status: draft
workstream: gemini-tts-38
issues:
  - ../../../issues/features/2026-10-04-gemini-tts-streamed-playback.md
---
# Stream speech audio from the provider to the browser

When the box answers in chat with speech, I want the voice to start as soon as
the provider has the first words ready, so the reply does not sit silent for one
to three seconds after the text appears.

Today the server waits for the provider's whole clip before it sends a byte, for
both speech backends. This plan streams the provider's audio through the
server as MP3, so the desktop browser's existing streaming player starts the
first segment after its first chunk.

**Issues addressed:**
[gemini-tts-streamed-playback](../../../issues/features/2026-10-04-gemini-tts-streamed-playback.md).
Searched the open queue for `tts`, `text-to-speech`, `speech playback`, and
`MediaSource`: the other hits are about speech *input* or iOS microphone
behavior (`ios-input-plane-parity`, `ios-mic-pause-during-speech-not-shown`,
`ios-record-button-silently-waits-for-speech`) or exploration of other vendors.
No duplicate.

The issue proposed a Web Audio PCM player in the client. This plan replaces that
direction: the client already streams MP3, so the server encodes to MP3 instead.

## Smallest fix and budget

**Smallest fix:** pipe the provider's response through the route instead of
buffering it. For OpenAI that is the whole change. Gemini answers raw PCM in
server-sent events, which no browser streaming path plays, so Gemini also needs
an encoder: PCM in, MP3 out, through `ffmpeg`.

**Chosen design:** the same thing, plus the guards that keep today's failure
reporting intact (an empty or failed stream still reaches the chat as a reason,
never as silence), and cleanup when the browser goes away.

One track, four commits. Estimate: about 380 changed source lines (service
stream shape ~150, MP3 encoder ~80, route ~80, client `appendChunk` ~10, two
scripts ~40, removing the WAV path ~20) and about 330 test lines. Docs: this plan plus small edits to
`docs/plans/tts-backend-selection.md` and the services table. Not a BIG CHANGE.

**Measured before planning (2026-10-05, synthetic text, Tier 1 Gemini key):**
- Both backends: first audio bytes at the provider about 0.66–1.02 s (OpenAI)
  and 0.72–0.77 s (Gemini); complete clip at 0.96–1.76 s (OpenAI) and
  1.31–2.45 s (Gemini) for 3–15 s of speech (`src/scripts/tts-latency.ts`).
- Gemini PCM through `ffmpeg -f s16le -ar 24000 -ac 1 -i pipe:0 -c:a libmp3lame
  -b:a 64k -flush_packets 1 -f mp3 pipe:1`: the first MP3 bytes came 3–9 ms after
  the first PCM, and encoding finished within 2 ms of the last PCM chunk (three
  runs). At 64 kbit/s the MP3 was about one sixth the size of the WAV the route
  sends today.

## Stated preferences this plan trades against

- **iOS is out of scope, by the boxholder's decision** (2026-10-05: "if ios is
  super hard maybe we shouldn't support it there"). iOS keeps buffered playback.
  It gains smaller downloads (MP3 instead of WAV) and nothing else.
- **Principle 4, resilient and never silent**
  (`docs/engineering-principles.md:49`). Streaming moves the moment of failure
  from "before the response" to "possibly during it". A failure after the first
  byte cannot become a 502 any more; the plan must keep it visible.
- **Principle 8, one way to do each thing** (`docs/engineering-principles.md:95`).
  The service gets one streaming method; the buffered `textToSpeech` goes. The
  two scripts that wanted a buffer collect the stream themselves.
- **Shipped precedent for a streamed upstream body:**
  `src/webapp/routes/api/register/adapters.ts:121`,
  `return reply.send(Readable.fromWeb(upstream.body));`.

## What already exists

- **The browser already streams MP3 for the head segment** (clean path traced
  end to end; real-route check in Implementation order step 3).
  `src/frontend/src/lib/audio/tts-client/client.ts:229`,
  `if (supportsMediaSource()) { await this.streamAndPlay(...)`, and
  `playable.ts:40`, `if (contentType !== null && MediaSource.isTypeSupported(contentType))`,
  routes `audio/mpeg` into `playAudioStream` (`src/frontend/src/lib/audio/context.ts:281`),
  which appends chunks to a `SourceBuffer` as they arrive, calls
  `endOfStream()` when the body ends, and caches the assembled buffer. Reuse,
  with one fix to `appendChunk` error handling (Track 1). Gemini audio misses
  this today only because the route labels it `audio/wav`. The existing browser
  test plays fixture MP3s from the mock, not an unknown-length ffmpeg stream, so
  the real-route check is part of this plan.
- **Prefetch and cache already read whole streams.** `client.ts:350`,
  `const buffer = await this.readStreamToBuffer(response);` then
  `this.cache.set(resolved.key, buffer)`. Reuse unchanged.
- **iOS falls back to buffered playback by itself.** `context.ts:111`,
  `supportsMediaSource()` returns false on iOS, so `playItem` downloads the
  whole response and plays it as a blob. Reuse unchanged.
- **The server buffers on purpose today.** `src/services/tts.ts:27`,
  `audio: Buffer;` in `TTSResult`; OpenAI at `tts.ts:153`,
  `const audio = Buffer.from(await res.arrayBuffer());`; Gemini at `tts.ts:223`,
  `pcm = ... await collectInteractionAudio(res.body);` then `tts.ts:231`,
  `return { audio: pcmToWav(pcm), contentType: "audio/wav" };`. Rebuild: this
  is the change.
- **The empty-audio guard.** `tts.ts:37`, `const MIN_PLAUSIBLE_AUDIO_BYTES = 512;`
  and `assertPlayable` at `tts.ts:81`. Keep the rule; apply it to the head of the
  stream instead of the whole buffer.
- **The route's failure mapping.** `src/webapp/routes/chat/audio-routes.ts:241`,
  `const result = await service.textToSpeech(text, ttsOpts);` then
  `reply.send(result.audio)`; `EmptyTtsResponseError` becomes a 502 at line 245,
  and `describeBackendFailure` carries the provider's message. Keep for
  failures before the first byte.
- **The SSE reader.** `src/core/tts/interaction-stream.ts`,
  `collectInteractionAudio`, concatenates every audio delta. Rebuild as an async
  generator of PCM chunks; the event parsing and its doctest stay.
- **ffmpeg is a required runtime tool.** `deploy/deploy.sh:945` checks for it at
  deploy; `deploy/hetzner/setup-server.sh:30` and `docker/Dockerfile:73` install
  it. No new dependency.
- **The speech browser test and dev mock** (`src/scripts/test-speech-browser.sh`,
  `src/webapp/routes/chat/tts-mock.ts`) already assert that streaming playback
  starts before the download completes, against fixture MP3s. Reuse as is; the
  mock path does not change.

## Prior art (external)

- iOS Safari's audio element requires byte-range responses and silently fails a
  live stream answered with 200
  ([Apple forum](https://developer.apple.com/forums/thread/749842),
  [WebKit 219167](https://auto-bugs.webkit.org/show_bug.cgi?id=219167)).
  ManagedMediaSource exists from iOS 17.1, but its MP3 support is unconfirmed
  ([WebKit 266764](https://bugs.webkit.org/show_bug.cgi?id=266764)). This is why
  iOS is out of scope.
- ffmpeg emits MP3 frames incrementally from a pipe with `-flush_packets 1`.
  Verified locally (above), so no external premise remains open for the encoder.
- No decision depends on Firefox's MSE support for `audio/mpeg`: when
  `MediaSource.isTypeSupported` is false, `playable.ts:40` already buffers the
  whole response and plays it as a blob.

## Ontology

- **`TtsService`** (`src/services/tts.ts:49`): one speech backend. Its method
  changes from `textToSpeech` (a whole buffer) to `streamSpeech` (a stream).
- **`TtsAudioStream`** (new): `{ contentType: "audio/mpeg"; head: Buffer; rest:
  AsyncIterable<Buffer>; cancel(): void }`. `head` is the audio already received
  when the stream was handed over, at least `MIN_PLAUSIBLE_AUDIO_BYTES` or the
  whole clip. `rest` is the remainder. Not a promise of completion: `rest` can
  still fail.
- **Head** (new term): the first plausible bytes. Everything before the head
  fails as today (a typed error the route turns into a 502 with a reason).
  Everything after it fails mid-stream.
- **Mid-stream failure** (new term): the provider or encoder fails after the
  route sent its 200. The route ends the response with an error, so the browser
  sees a network error, never a clean but truncated clip.
- **`pcmToMp3`** (new, `src/core/tts/mp3-encoder.ts`): PCM chunks in, MP3
  chunks out, through one `ffmpeg` child process per clip. Replaces `pcmToWav`
  on the speech path (`src/core/tts/wav.ts`, which then has no caller and goes).
- **`interactionAudioChunks`** (renamed from `collectInteractionAudio`): an async
  generator of PCM chunks from the Gemini stream.

## Tracks / scope

### Track 1: stream speech from provider to browser

**What.** The service hands the route a stream once its head has arrived. The
route sends the head, then pipes the rest. Gemini's PCM goes through an MP3
encoder on the way. If the browser disconnects, the route cancels the stream,
which aborts the provider request and kills the encoder.

**Why this needs to change.** For both backends the first sound waits for the
whole clip: 1.0–1.8 s (OpenAI) and 1.3–2.5 s (Gemini), where the first audio
bytes exist at about 0.7 s. The browser can already play from the first chunk.

**Direction.**

- `TtsService.streamSpeech(text, opts): Promise<TtsAudioStream>` replaces
  `textToSpeech`. The promise resolves once the head is in hand, and rejects
  with today's errors before that (`HTTPError`, `TimeoutError`,
  `InteractionStreamError`, `EmptyTtsResponseError` when the clip ends shorter
  than the head).
- A shared helper `takeHead(chunks: AsyncIterable<Buffer>, { backend, cancel })`
  reads until `MIN_PLAUSIBLE_AUDIO_BYTES` or the end, and returns the
  `TtsAudioStream`. Both backends use it, so the empty-audio rule stays one rule.
- OpenAI: `ky.post(...)` as today, then the response body as chunks. No
  re-encoding; it is already MP3.
- Gemini: `interactionAudioChunks(res.body)` piped into `pcmToMp3`. The
  90-second whole-call deadline (`GEMINI_STREAM_DEADLINE_MS`) still aborts the
  provider request; it now also fails the stream mid-way.
- `pcmToMp3(pcm: AsyncIterable<Buffer>, { signal }): AsyncIterable<Buffer>`
  spawns `ffmpeg -hide_banner -loglevel error -f s16le -ar 24000 -ac 1 -i pipe:0
  -c:a libmp3lame -b:a 64k -flush_packets 1 -id3v2_version 0 -write_xing 0
  -f mp3 pipe:1`. `-id3v2_version 0 -write_xing 0` leaves bare MP3 frames, so the
  first bytes a `SourceBuffer` sees are audio. A spawn failure (`ENOENT`) or a
  non-zero exit is a typed `Mp3EncoderError` naming ffmpeg. The child is killed
  when `signal` aborts or the consumer stops early.
- Route: `const audio = await service.streamSpeech(text, ttsOpts)`; set
  `Content-Type: audio/mpeg`; send `Readable.from(guarded(audio))`, where
  `guarded` is an async generator that yields `head`, then each chunk of `rest`,
  inside its own `try/catch`. The route's existing `try/catch`
  (`audio-routes.ts:240`) only covers work before `reply.send` returns, so
  failures after the head need this wrapper: on a throw from `rest` it logs
  `[chat-tts] stream failed after <n> bytes: <reason>`, calls `audio.cancel()`,
  and destroys `reply.raw` with the error. The browser's `playAudioStream` pump
  then rejects and the segment shows as failed.
- Disconnect: listen on `reply.raw` `close` and cancel only when
  `!reply.raw.writableFinished`, the pattern at
  `src/webapp/routes/chat/screenshot-routes.ts:243` (*"a close with an
  unfinished body is the disconnect; a close after we've written the reply is
  benign"*). The request side is already fully read when synthesis starts, so
  `request.raw` would miss a disconnect.
- Client, one small change: `appendChunk` (`src/frontend/src/lib/audio/context.ts:255`)
  resolves on `updateend` only. Per the MSE spec a failed append fires `error`
  and then `updateend`, so today a bad chunk resolves as success and the clip
  may hang or fail late. Listen for `error` and `abort` too and reject, so a
  stream the browser cannot decode fails the segment at once.
- `createFakeTts` returns a `TtsAudioStream` from a fixed MP3 buffer, with an
  option to fail after the head, so route tests can drive the mid-stream path.
- `gen-tts-fixtures.ts` and `tts-latency.ts` collect the stream into a buffer.
  `tts-latency.ts` reports time to head as its "first audio" figure.

**Vocabulary lock-ins.** `streamSpeech`, `TtsAudioStream`, `pcmToMp3`,
`Mp3EncoderError`, `interactionAudioChunks`. Speech responses are always
`audio/mpeg`.

**First implementation chunk.** `src/core/tts/mp3-encoder.ts` (`pcmToMp3`,
`Mp3EncoderError`) and `interactionAudioChunks`, with doctests: PCM in gives
MP3 frames out before the input ends; a missing ffmpeg binary (spawned under a
name that does not exist) gives `Mp3EncoderError`; aborting kills the child.
Nothing calls them yet.

## Could this be simpler?

- **Simplest version:** stream OpenAI only; leave Gemini buffered. It changes
  one line in the service and the route, but the backend in use is Gemini, so it
  does not fix the reported problem.
- **Gemini-only streaming beside the buffered method:** add a streaming method
  for Gemini, keep `textToSpeech` for OpenAI. Smaller by perhaps 60 lines, but
  leaves two ways to produce speech (principle 8) and keeps OpenAI's 0.3–0.7 s
  wait after its first bytes, which is the baseline the boxholder compares
  Gemini against. OpenAI streaming costs a few lines in the same path, so the
  plan does both.
- **Next simplest:** stream Gemini's PCM to the browser as an endless WAV and
  play it with Web Audio, as the issue first proposed. It avoids ffmpeg but needs
  a second player in the client, beside `playAudioStream`, with its own stop,
  cache, and failure handling, and a different content type per backend. Per
  principle 8 (one way to do each thing), one MP3 path for both backends is
  smaller in total, and MP3 is a sixth of the bytes.
- **What the head and mid-stream handling buy.** Without the head, an empty
  Gemini answer (observed before: an HTTP 200 with no audio) would reach the
  browser as a 200 with no body, which plays as silence. Principle 4 forbids
  that. Without the mid-stream destroy, a provider failure halfway would end the
  response normally, and the boxholder would hear half a sentence with no sign
  of failure.
- **Not added:** retry after the head (the clip is already playing), a server
  cache of streams (the client cache already covers replay), and an iOS path.

## Subplans

None. The one external premise, incremental MP3 from ffmpeg, was settled by
measurement before writing.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Provider answers 200 with no audio (Gemini, observed 2026-09-06) | Planned: service doctest, empty SSE stream | `takeHead` throws `EmptyTtsResponseError` before the route sends anything | Clear: 502 with reason, failed segment shows it |
| Provider rejects before audio (400, 401, long 429) | Yes: `tts-mock.doctest.md`, `tts.doctest.md` | Unchanged: rejects before head, 502 with provider message | Clear |
| ffmpeg missing on the host | Planned: encoder doctest with a bad binary name | `Mp3EncoderError` before head → 502 naming ffmpeg | Clear |
| Provider stream errors after the head (error event, connection reset) | Planned: route doctest with a fake that fails after the head | Route logs and destroys the response | Clear: browser pump error → segment failed. The reason the chat shows is the browser's generic network error; the server log has the provider's |
| ffmpeg exits non-zero mid-clip | Planned: encoder doctest | `Mp3EncoderError` from `rest` → same as above | Clear, as above |
| Browser stops or navigates away mid-clip | Planned: route doctest, close the connection mid-body, assert `cancel` ran | `reply.raw` close with `!writableFinished` → `cancel()` aborts the provider fetch and kills ffmpeg | Silent by design: nobody is listening. Without it, ffmpeg children and provider requests would leak |
| Whole-call deadline passes mid-stream (stalled provider) | Existing deadline doctest covers before head; planned case after head | Deadline aborts fetch → `InteractionStreamError` from `rest` → destroy | Clear, as above |
| Firefox or another browser without MSE `audio/mpeg` | Existing: `playable.tts-container-routing.doctest.md` | `playable.ts:40` buffers the whole response and plays it | Clear: works, just not streamed |
| A `SourceBuffer` rejects the ffmpeg output (unexpected header, truncated frame) | Planned: browser check against the real route, including a clip cut off mid-stream | `appendChunk` rejects on `error`/`abort` (new), `addSourceBuffer` throw and media `onerror` (existing) → failed segment | Clear after the `appendChunk` fix; today it can resolve as success and hang |

No critical gap: every new codepath has handling, and none fails silently except
the deliberate cancel on disconnect.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field.** Not applicable: no agent-facing vocabulary
  changes. The agent still writes `<speech>` tags; how audio travels is invisible
  to it.
- **Stale ref, two agents on one card, hand-edit drift, fabricated values.** Not
  applicable: no cards or refs are involved.
- **Validation error UX.** ADDRESSED: failures before the head keep the reason
  the chat shows today (`SpeechChunk` "Speech failed: …"). Mid-stream failures
  show the browser's generic error; the server log carries the provider's reason.
  Accepted, because a response that has sent a 200 cannot carry a JSON reason.
- **Replay after a mid-stream failure.** ADDRESSED: `playAudioStream` caches
  only complete downloads (`settleBuffer(null)` on error), so replay asks the
  server again.
- **Prefetched segments.** ADDRESSED: they still download whole
  (`client.ts:350`); streaming changes only how soon the bytes arrive.
- **Partial rollout.** Not applicable: server and client deploy together, and
  the client needs no change. An old client receiving `audio/mpeg` for Gemini
  takes the same streaming path it already takes for OpenAI.

## NOT in scope

- **iOS streaming.** Boxholder decision 2026-10-05; Safari needs byte-range
  responses for the audio element, and ManagedMediaSource's MP3 support is
  unconfirmed. iOS keeps buffered playback of the MP3.
- **A Web Audio PCM player.** Superseded by encoding on the server (see *Could
  this be simpler?*).
- **Starting speech before the agent finishes a `<speech>` segment.** The client
  asks for audio per closed tag
  (`src/frontend/src/components/chat/everywhere/InteractiveChat/speech.ts:76`,
  *"Mid-stream: dispatch complete <speech>...</speech> segments as they
  arrive."*). Starting earlier is a change to the chat stream parser, not to the
  audio path.
- **Prefetch changes.** Later segments are fetched while the first plays; their
  latency is already hidden.
- **A reason for mid-stream failures in the chat UI.** Would need a side channel
  (a trailer or a status lookup); the server log covers it for now.
- **Bitrate as a setting.** 64 kbit/s mono is fixed; a voice reply does not
  need more.

## Open design questions

- **Should the head threshold be larger than 512 bytes?** 512 bytes of 64 kbit/s
  MP3 is about 64 ms of audio, which is enough to prove the stream is audio and
  small enough not to delay the start. Lean: keep 512, the rule that exists.

## Knowledge audits

None: this is transport infrastructure with no agent-facing concept.

## What will hold this after it ships

- **Doctests** for the pure and process pieces: `interactionAudioChunks` (event
  parsing, chunk boundaries, error events, as today's
  `interaction-stream.doctest.md`), `pcmToMp3` against the real ffmpeg (a
  declared runtime dependency, present in every environment that runs the
  suite), and `takeHead`.
- **Route doctests** in `tts-mock.doctest.md` with `createFakeTts` streams:
  head then rest, empty clip, failure after the head, cancel on close.
- **The speech browser test** (`src/scripts/test-speech-browser.sh`) keeps
  asserting that playback starts before the download ends, against the mock.
- No new test tier.

## Implementation order

1. **Encoder and chunked Gemini reader.** `pcmToMp3`, `Mp3EncoderError`,
   `interactionAudioChunks`, their doctests. No callers change.
2. **Service and route.** `streamSpeech`, `TtsAudioStream`, `takeHead`; both
   backends; the route streams through `guarded` with the `reply.raw` close
   handler; `createFakeTts` streams; the two scripts collect; `pcmToWav` and
   `wav.ts` removed with their doctest. Route and service doctests updated,
   including a failure after the head and a disconnect mid-body.
3. **Client `appendChunk` rejects on `SourceBuffer` `error`/`abort`.** One
   function in `context.ts`.
4. **Verify end to end.** Run `src/scripts/tts-latency.ts` for both backends and
   record time to head. On the dev router with a test box, play a three-segment
   reply in desktop Chrome on each backend and confirm the first segment starts
   at about the head time and plays to the end, that a stopped clip leaves no
   `ffmpeg` process behind, and that a clip cut off mid-stream (kill the
   provider connection) shows as failed. Record the numbers in this plan.

## Rollout shape

Done when:
- the doctests named above pass, with `pnpm test:changed`, typecheck, and lint
  clean;
- `tts-latency.ts` shows the head at roughly the provider's first audio
  (about 0.7–1.0 s) for both backends;
- a real chat reply in desktop Chrome starts speaking at about the head time on
  Gemini and on OpenAI, and plays to the end;
- an iOS reply still plays (buffered).

No migration: no stored data changes. No knowledge audits.

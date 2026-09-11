# Capture routes

The capture routes stage media into the box; finalize seals the staging session
and kicks off the background preparation worker (Track 3), returning immediately.
Uploads are multipart with `X-Capture-*` headers; audio chunks carry a segment id
so preparation can concatenate within a segment. (The full prepare → transcribe →
assemble → deliver pipeline is covered by `test/core/capture/prepare.doctest.md`;
here we test the route boundary only.)

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { buildMultipartForm } from "../../../src/lib/multipart.js";
import { setStagingState, readStagingSession, writeStagingSession } from "../../../src/core/capture/staging-store.js";
import { MAX_STAGED_BYTES } from "../../../src/core/capture/staging-limits.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";

// Stage one upload via multipart, mirroring the browser client.
async function upload(ctx, opts) {
  const { body, boundary } = buildMultipartForm([
    {
      kind: "file",
      file: {
        name: "file",
        filename: opts.filename,
        contentType: opts.contentType ?? "application/octet-stream",
        data: opts.data,
      },
    },
  ]);
  return ctx.request({
    method: "POST",
    url: `/api/capture/sessions/${opts.sessionId}/upload`,
    payload: body,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "x-capture-filename": opts.filename,
      ...opts.headers,
    },
  });
}

// Stage one raw body exactly as URLSessionUploadTask does from a file URL.
// Wait for a voice session's (fire-and-forget) HQ job to settle before a
// test's cleanup closes the event bus — a still-running job emitting into a
// torn-down bus would throw asynchronously into the NEXT test.
async function waitForHqDone(ctx, id, timeoutMs = 2000) {
  const start = Date.now();
  for (;;) {
    const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${id}/session.json`));
    if (manifest.voice.hq.state === "failed" || manifest.voice.hq.state === "ready") return manifest;
    if (Date.now() - start > timeoutMs) return manifest;
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function uploadRaw(ctx, opts) {
  return ctx.request({
    method: "POST",
    url: `/api/capture/sessions/${opts.sessionId}/upload`,
    payload: opts.data,
    headers: {
      "content-type": "application/octet-stream",
      "x-capture-filename": opts.filename,
      "x-capture-kind": opts.kind,
      "x-capture-started-at": opts.startedAt ?? "2026-07-09T14:00:00.000Z",
      "x-capture-source": opts.source ?? "camera-environment",
      ...opts.headers,
    },
  });
}
```

## Create → two audio segments land in the staging manifest

Creating a session records the chat `targetSessionId` it was started from:

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST",
  url: "/api/capture/sessions",
  payload: { targetSessionId: "chat-abc" },
});
created.statusCode
=> 200

const sessionId = created.body.sessionId;
typeof sessionId
=> string

JSON.stringify(created.body.capabilities)
=> {"acceptedAudioFormats":["webm-opus","m4a-aac"],"acceptedUploadEncodings":["raw-body-v1"]}
```

Upload one chunk for each of two recording segments:

```ts continue
const a = await upload(ctx, {
  sessionId, filename: "audio-0-001.webm", contentType: "audio/webm", data: Buffer.from("SEGMENT-A"),
  headers: {
    "x-capture-kind": "audio",
    "x-capture-source": "microphone",
    "x-capture-segment-id": "seg-a",
    "x-capture-segment-started-at": "2026-07-09T14:00:00.000Z",
    "x-capture-started-at": "2026-07-09T14:00:00.000Z",
  },
});
a.statusCode
=> 200

const b = await upload(ctx, {
  sessionId, filename: "audio-1-001.webm", contentType: "audio/webm", data: Buffer.from("SEGMENT-B"),
  headers: {
    "x-capture-kind": "audio",
    "x-capture-source": "microphone",
    "x-capture-segment-id": "seg-b",
    "x-capture-segment-started-at": "2026-07-09T14:05:00.000Z",
    "x-capture-started-at": "2026-07-09T14:05:00.000Z",
  },
});
b.statusCode
=> 200
```

The staging manifest records both segments in order, each with its chunk:

```ts continue
const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${sessionId}/session.json`));
manifest.segments.map((s) => s.id).join(",")
=> seg-a,seg-b

manifest.segments[0].chunks.join(",")
=> audio-0-001.webm

manifest.segments[0].format
=> webm-opus
```

```ts cleanup
await ctx.cleanup();
```

## Raw JPEG and complete M4A bodies reach the upload handler

The native transport sends `application/octet-stream`; Fastify must parse it to
a Buffer before the route runs. M4A is one complete file per segment, while a
second file or a mixed format is rejected before either filename is staged.

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { targetSessionId: "chat-native" },
});
const sessionId = created.body.sessionId;

const photo = await uploadRaw(ctx, {
  sessionId, filename: "ios-photo-a.jpg", kind: "photo", data: Buffer.from("JPEG-BYTES"),
});
photo.statusCode
=> 200
```

```ts continue
const audio = await uploadRaw(ctx, {
  sessionId, filename: "ios-audio-a.m4a", kind: "audio", data: Buffer.from("M4A-BYTES"),
  headers: {
    "x-capture-segment-id": "native-segment",
    "x-capture-segment-started-at": "2026-07-09T14:01:00.000Z",
    "x-capture-audio-format": "m4a-aac",
  },
});
audio.statusCode
=> 200
```

```ts continue
const photoReplay = await uploadRaw(ctx, {
  sessionId, filename: "ios-photo-a.jpg", kind: "photo", data: Buffer.from("JPEG-BYTES"),
});
const audioReplay = await uploadRaw(ctx, {
  sessionId, filename: "ios-audio-a.m4a", kind: "audio", data: Buffer.from("M4A-BYTES"),
  headers: {
    "x-capture-segment-id": "native-segment",
    "x-capture-segment-started-at": "2026-07-09T14:01:00.000Z",
    "x-capture-audio-format": "m4a-aac",
  },
});
JSON.stringify({ photo: photoReplay.statusCode, audio: audioReplay.statusCode })
=> {"photo":200,"audio":200}
```

Exact background-upload retries are idempotent. Reusing the same filename for
different bytes remains a conflict:

```ts continue
const conflictingReplay = await uploadRaw(ctx, {
  sessionId, filename: "ios-photo-a.jpg", kind: "photo", data: Buffer.from("DIFFERENT"),
});
conflictingReplay.statusCode
=> 409
```

```ts continue
const duplicate = await uploadRaw(ctx, {
  sessionId, filename: "ios-audio-b.m4a", kind: "audio", data: Buffer.from("SECOND"),
  headers: {
    "x-capture-segment-id": "native-segment",
    "x-capture-audio-format": "m4a-aac",
  },
});
duplicate.statusCode
=> 409
```

The rejected body never lands on disk or in the manifest:

```ts continue
const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${sessionId}/session.json`));
JSON.stringify({
  photos: manifest.photos.map((item) => item.filename),
  audio: manifest.segments.map((segment) => ({ format: segment.format, chunks: segment.chunks })),
  totalBytes: manifest.totalBytes,
})
=> {"photos":["ios-photo-a.jpg"],"audio":[{"format":"m4a-aac","chunks":["ios-audio-a.m4a"]}],"totalBytes":19}
```

```ts cleanup
await ctx.cleanup();
```

## REST resume uses the paired device owner

The user who created the pairing QR is persisted onto the device and becomes
the same `createdBy` value used by cookie-authenticated web capture.

```ts
const ctx = await makeTestServer();
const ticket = createMobilePairingTicket(ctx.boxRoot, { createdBy: "owner@example.com" });
const paired = await redeemMobilePairingTicket(ctx.boxRoot, {
  pairingToken: ticket.token,
  deviceLabel: "Owner's phone",
});
if (!paired) throw new Error("pairing failed");
const auth = { authorization: `Bearer ${paired.deviceToken}` };
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { targetSessionId: "chat-owner" }, headers: auth,
});
const sessionId = created.body.sessionId;
await uploadRaw(ctx, {
  sessionId, filename: "ios-photo-owner.jpg", kind: "photo", data: Buffer.from("OWNER"), headers: auth,
});
const resumed = await ctx.request({
  method: "GET",
  url: `/api/capture/sessions/resumable?targetSessionId=chat-owner&clientSessionId=${sessionId}`,
  headers: auth,
});
JSON.stringify({ status: resumed.statusCode, matches: resumed.body.resumable[0]?.id === sessionId })
=> {"status":200,"matches":true}
```

```ts continue
const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${sessionId}/session.json`));
manifest.createdBy
=> owner@example.com
```

A different paired identity cannot upload to, finalize, or cancel the owner's
session:

```ts continue
const otherTicket = createMobilePairingTicket(ctx.boxRoot, { createdBy: "other@example.com" });
const otherPaired = await redeemMobilePairingTicket(ctx.boxRoot, {
  pairingToken: otherTicket.token,
  deviceLabel: "Other phone",
});
if (!otherPaired) throw new Error("second pairing failed");
const otherAuth = { authorization: `Bearer ${otherPaired.deviceToken}` };
const forbiddenUpload = await uploadRaw(ctx, {
  sessionId, filename: "other.jpg", kind: "photo", data: Buffer.from("OTHER"), headers: otherAuth,
});
const forbiddenFinalize = await ctx.request({
  method: "POST", url: `/api/capture/sessions/${sessionId}/finalize`, headers: otherAuth,
});
const forbiddenCancel = await ctx.request({
  method: "DELETE", url: `/api/capture/sessions/${sessionId}`, headers: otherAuth,
});
JSON.stringify([
  forbiddenUpload.statusCode,
  forbiddenFinalize.statusCode,
  forbiddenCancel.statusCode,
])
=> [403,403,403]
```

```ts continue
const stillOpen = JSON.parse(await ctx.read(`_tmp/capture-staging/${sessionId}/session.json`));
JSON.stringify({ state: stillOpen.state, photos: stillOpen.photos.map((item) => item.filename) })
=> {"state":"open","photos":["ios-photo-owner.jpg"]}
```

```ts cleanup
await ctx.cleanup();
```

## An ownerless legacy device must re-pair when auth is enabled

Old device records decode with `createdBy: null`. They remain valid for ordinary
mobile access, but cannot create captures in an authenticated box because all
such devices would otherwise share the anonymous resume scope.

```ts
// "Auth enabled" is now the always-on default; makeTestServer opens the wall by
// default, so construct with openAccess: false to exercise the authenticated path.
const ctx = await makeTestServer({ openAccess: false });
const ticket = createMobilePairingTicket(ctx.boxRoot);
const paired = await redeemMobilePairingTicket(ctx.boxRoot, {
  pairingToken: ticket.token,
  deviceLabel: "Legacy phone",
});
if (!paired) throw new Error("pairing failed");
const created = await ctx.request({
  method: "POST",
  url: "/api/capture/sessions",
  payload: { targetSessionId: "chat-owner" },
  headers: { authorization: `Bearer ${paired.deviceToken}` },
});
JSON.stringify({ status: created.statusCode, error: created.body.error })
=> {"status":403,"error":"This paired device predates mobile identity. Re-pair it before using Capture."}
```

```ts cleanup
await ctx.cleanup();
```

## Finalize seals the session and returns staged

Finalize returns immediately with `staged: true` (preparation runs in the
background). An empty session — nothing uploaded — is discarded by the worker
with no delivery:

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { targetSessionId: null },
});
const sessionId = created.body.sessionId;

const done = await ctx.request({ method: "POST", url: `/api/capture/sessions/${sessionId}/finalize` });
done.statusCode
=> 200

done.body.staged
=> true

done.body.sessionId
=> «*»
```

```ts cleanup
await ctx.cleanup();
```

## Path traversal in the filename is rejected

An upload whose filename escapes the session directory returns 400 and stages
nothing:

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { targetSessionId: null },
});
const sessionId = created.body.sessionId;
const res = await upload(ctx, {
  sessionId, filename: "../../evil.webm", data: Buffer.from("PWN"),
  headers: { "x-capture-kind": "audio", "x-capture-segment-id": "seg-a" },
});
res.statusCode
=> 400
```

```ts continue
res.body.error
=> Invalid filename
```

```ts cleanup
await ctx.cleanup();
```

## Uploading to a sealed session returns 409

Once a session is sealed (finalize fired), it is past the point of accepting
media — an upload returns 409, distinct from the 404 for a session that is gone
(X3). Here we seal directly via the store to avoid racing the async worker:

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { targetSessionId: null },
});
const sessionId = created.body.sessionId;
await setStagingState({ boxRoot: ctx.boxRoot, id: sessionId, state: "sealed" });

const res = await upload(ctx, {
  sessionId, filename: "photo-001.jpg", data: Buffer.from("X"),
  headers: { "x-capture-kind": "photo" },
});
res.statusCode
=> 409
```

```ts continue
res.body.error
=> Session is sealed; uploads are only accepted while it is open
```

```ts cleanup
await ctx.cleanup();
```

## Exceeding the per-session byte cap returns 413

An upload that would push the session past `MAX_STAGED_BYTES` is rejected with
413 (X3). We seed the manifest's accumulated bytes to the cap so a single byte
tips it over, without staging a real gigabyte:

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { targetSessionId: null },
});
const sessionId = created.body.sessionId;
const session = await readStagingSession({ boxRoot: ctx.boxRoot, id: sessionId });
session.totalBytes = MAX_STAGED_BYTES;
await writeStagingSession({ boxRoot: ctx.boxRoot, session });

const res = await upload(ctx, {
  sessionId, filename: "photo-001.jpg", data: Buffer.from("X"),
  headers: { "x-capture-kind": "photo" },
});
res.statusCode
=> 413
```

```ts continue
res.body.error
=> Capture exceeds the staging byte limit
```

```ts cleanup
await ctx.cleanup();
```

## Uploading to an unknown session returns 404

```ts
const ctx = await makeTestServer();
const res = await upload(ctx, {
  sessionId: "no-such-session", filename: "photo-001.jpg", data: Buffer.from("X"),
  headers: { "x-capture-kind": "photo" },
});
res.statusCode
=> 404
```

```ts cleanup
await ctx.cleanup();
```

## Discard is guarded: the client may only delete what is still its own

`DELETE` is both the overlay's cancel and the chat chip's discard. It used to
tear the session directory down unconditionally, which meant it could delete a
capture the background worker was in the middle of preparing — the worker then
reads `null` and silently returns, so the client reports success and no message
ever arrives. It now goes through `discardStagingSessionIfCancellable`, which
takes the per-session lock and re-checks the state inside it.

An `open` session — the uploader's own cancel — is still the client's to delete:

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { targetSessionId: "chat-discard" },
});
const sessionId = created.body.sessionId;
await uploadRaw(ctx, { sessionId, filename: "shot.jpg", kind: "photo", data: Buffer.from("PHOTO") });
const cancelled = await ctx.request({ method: "DELETE", url: `/api/capture/sessions/${sessionId}` });
JSON.stringify([cancelled.statusCode, await readStagingSession({ boxRoot: ctx.boxRoot, id: sessionId })])
=> [200,null]
```

A session the worker owns is refused, and survives:

```ts continue
const inFlight = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { targetSessionId: "chat-discard" },
});
const busyId = inFlight.body.sessionId;
await uploadRaw(ctx, { sessionId: busyId, filename: "busy.jpg", kind: "photo", data: Buffer.from("PHOTO") });
await setStagingState({ boxRoot: ctx.boxRoot, id: busyId, state: "preparing" });
const refused = await ctx.request({ method: "DELETE", url: `/api/capture/sessions/${busyId}` });
JSON.stringify([refused.statusCode, refused.body.error])
=> [409,"Capture is already preparing and can no longer be discarded"]

const survivor = await readStagingSession({ boxRoot: ctx.boxRoot, id: busyId });
survivor.state
=> preparing
```

A dead `failed:*` session is discardable — this is the verb the chat chip
needed, and the one the boxholder had no way to reach for sixteen days:

```ts continue
await setStagingState({ boxRoot: ctx.boxRoot, id: busyId, state: "failed:prepare" });
const discarded = await ctx.request({ method: "DELETE", url: `/api/capture/sessions/${busyId}` });
JSON.stringify([discarded.statusCode, await readStagingSession({ boxRoot: ctx.boxRoot, id: busyId })])
=> [200,null]
```

Discarding one that is already gone is a 404, as it was before: there is no
session to authorize the caller against.

```ts continue
const again = await ctx.request({ method: "DELETE", url: `/api/capture/sessions/${busyId}` });
again.statusCode
=> 404
```

```ts cleanup
await ctx.cleanup();
```

## Voice sessions: idempotent client-generated create, and a fenced-off owner/kind

A voice recording (`docs/plans/resilient-voice-recording.md`) creates its
staging session with a client-generated UUID v4, so the browser can start
staging before the box confirms the session exists. A repeat of the same id,
kind and owner is a no-op that returns the existing session:

```ts
const ctx = await makeTestServer();
const recordingId = "6a6e6b1e-2f8a-4c9a-8b1a-1a2b3c4d5e6f";
const created = await ctx.request({
  method: "POST",
  url: "/api/capture/sessions",
  payload: { kind: "voice", targetSessionId: "chat-voice", id: recordingId },
});
JSON.stringify({ status: created.statusCode, sessionId: created.body.sessionId })
=> {"status":200,"sessionId":"6a6e6b1e-2f8a-4c9a-8b1a-1a2b3c4d5e6f"}
```

```ts continue
const repeat = await ctx.request({
  method: "POST",
  url: "/api/capture/sessions",
  payload: { kind: "voice", targetSessionId: "chat-voice", id: recordingId },
});
JSON.stringify({ status: repeat.statusCode, sessionId: repeat.body.sessionId })
=> {"status":200,"sessionId":"6a6e6b1e-2f8a-4c9a-8b1a-1a2b3c4d5e6f"}
```

The manifest carries the `voice` object with `hq: none` and `handoff: open`,
and was created only once (one directory, not two):

```ts continue
const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${recordingId}/session.json`));
JSON.stringify({ kind: manifest.kind, voice: manifest.voice })
=> {"kind":"voice","voice":{"targetSessionId":"chat-voice","startedAt":"«*»","hq":{"state":"none"},"handoff":{"mode":"open"}}}
```

A non-UUID-v4 id is rejected before any session is created:

```ts continue
const badId = await ctx.request({
  method: "POST",
  url: "/api/capture/sessions",
  payload: { kind: "voice", targetSessionId: "chat-voice", id: "not-a-uuid" },
});
badId.statusCode
=> 400
```

A voice session may start without a `targetSessionId`: the mic can open in a
brand-new chat before it has a session. The manifest records `null`; the HQ
job and late delivery read the session from finalize's `hq.sessionId` instead.

```ts continue
const unboundId = "8c8d8e3f-4a0b-4e1c-8d3c-3c4d5e6f7081";
const noTarget = await ctx.request({
  method: "POST",
  url: "/api/capture/sessions",
  payload: { kind: "voice", id: unboundId },
});
noTarget.statusCode
=> 200

const unbound = JSON.parse(await ctx.read(`_tmp/capture-staging/${unboundId}/session.json`));
unbound.voice.targetSessionId
=> null
```

```ts cleanup
await ctx.cleanup();
```

A different mobile-pairing owner reusing the same recording id is a conflict,
not a silent takeover:

```ts
const ctx = await makeTestServer();
const ticket = createMobilePairingTicket(ctx.boxRoot, { createdBy: "owner@example.com" });
const paired = await redeemMobilePairingTicket(ctx.boxRoot, { pairingToken: ticket.token, deviceLabel: "Owner's phone" });
if (!paired) throw new Error("pairing failed");
const ownerAuth = { authorization: `Bearer ${paired.deviceToken}` };

const otherTicket = createMobilePairingTicket(ctx.boxRoot, { createdBy: "other@example.com" });
const otherPaired = await redeemMobilePairingTicket(ctx.boxRoot, { pairingToken: otherTicket.token, deviceLabel: "Other phone" });
if (!otherPaired) throw new Error("second pairing failed");
const otherAuth = { authorization: `Bearer ${otherPaired.deviceToken}` };

const recordingId = "7b7f7c2f-3f9b-4d0b-9c2b-2b3c4d5e6f70";
const created = await ctx.request({
  method: "POST",
  url: "/api/capture/sessions",
  payload: { kind: "voice", targetSessionId: "chat-voice", id: recordingId },
  headers: ownerAuth,
});
created.statusCode
=> 200
```

```ts continue
const stolen = await ctx.request({
  method: "POST",
  url: "/api/capture/sessions",
  payload: { kind: "voice", targetSessionId: "chat-voice", id: recordingId },
  headers: otherAuth,
});
JSON.stringify({ status: stolen.statusCode, error: stolen.body.error })
=> {"status":409,"error":"Session id already used by a different recording"}
```

```ts cleanup
await ctx.cleanup();
```

## Voice sessions stage `pcm-s16le-16k` chunks; capture sessions cannot

The upload route accepts one segment of raw PCM chunks per voice recording,
its id the recording's own id, filenames `pcm-000001.raw` in sequence — the
same idempotent-replay mechanism as every other capture upload:

```ts
const ctx = await makeTestServer();
const recordingId = "8c8f8d3f-4f0c-4e1c-8d3c-3c4d5e6f7081";
await ctx.request({
  method: "POST",
  url: "/api/capture/sessions",
  payload: { kind: "voice", targetSessionId: "chat-voice", id: recordingId },
});

const chunk1 = await uploadRaw(ctx, {
  sessionId: recordingId, filename: "pcm-000001.raw", kind: "audio", data: Buffer.from("PCM1"),
  headers: { "x-capture-segment-id": recordingId, "x-capture-audio-format": "pcm-s16le-16k" },
});
const chunk2 = await uploadRaw(ctx, {
  sessionId: recordingId, filename: "pcm-000002.raw", kind: "audio", data: Buffer.from("PCM2"),
  headers: { "x-capture-segment-id": recordingId, "x-capture-audio-format": "pcm-s16le-16k" },
});
JSON.stringify([chunk1.statusCode, chunk2.statusCode])
=> [200,200]
```

```ts continue
const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${recordingId}/session.json`));
JSON.stringify({
  segments: manifest.segments.map((s) => ({ id: s.id, format: s.format, chunks: s.chunks })),
})
=> {"segments":[{"id":"8c8f8d3f-4f0c-4e1c-8d3c-3c4d5e6f7081","format":"pcm-s16le-16k","chunks":["pcm-000001.raw","pcm-000002.raw"]}]}
```

An exact-bytes replay of the first chunk is idempotent, as any other capture
upload's is:

```ts continue
const replay = await uploadRaw(ctx, {
  sessionId: recordingId, filename: "pcm-000001.raw", kind: "audio", data: Buffer.from("PCM1"),
  headers: { "x-capture-segment-id": recordingId, "x-capture-audio-format": "pcm-s16le-16k" },
});
replay.statusCode
=> 200
```

```ts cleanup
await ctx.cleanup();
```

A `pcm-s16le-16k` chunk aimed at an ordinary capture session is refused —
capture's finalize path never learned to concatenate or convert raw PCM:

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { targetSessionId: "chat-abc" },
});
const sessionId = created.body.sessionId;
const res = await uploadRaw(ctx, {
  sessionId, filename: "pcm-000001.raw", kind: "audio", data: Buffer.from("PCM"),
  headers: { "x-capture-segment-id": "seg-a", "x-capture-audio-format": "pcm-s16le-16k" },
});
JSON.stringify({ status: res.statusCode, error: res.body.error })
=> {"status":400,"error":"pcm-s16le-16k audio is only accepted for voice sessions"}
```

```ts cleanup
await ctx.cleanup();
```

## Voice finalize verifies contiguity before sealing

Uploads are refused once a session isn't `open`, so a chunk missing at
finalize time is gone for good — finalize checks the manifest holds exactly
`pcm-000001.raw … pcm-<chunkCount>.raw` and refuses to seal on a gap:

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { kind: "voice", targetSessionId: "chat-voice" },
});
const sessionId = created.body.sessionId;
// Only chunk 2 uploaded — chunk 1 never arrived.
await uploadRaw(ctx, {
  sessionId, filename: "pcm-000002.raw", kind: "audio", data: Buffer.from("PCM2"),
  headers: { "x-capture-segment-id": sessionId, "x-capture-audio-format": "pcm-s16le-16k" },
});
const finalize = await ctx.request({
  method: "POST", url: `/api/capture/sessions/${sessionId}/finalize`, payload: { chunkCount: 2, hq: null },
});
JSON.stringify({ status: finalize.statusCode, code: finalize.body.code })
=> {"status":409,"code":"missing-chunks"}
```

The session was NOT sealed — it's still `open`, so the missing chunk could
still be uploaded and finalize retried:

```ts continue
const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${sessionId}/session.json`));
manifest.state
=> open
```

```ts cleanup
await ctx.cleanup();
```

## Voice finalize is idempotent; a conflicting repeat is refused

A finalize with no HQ requested seals the session and leaves `hq: none`,
`handoff: open`:

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { kind: "voice", targetSessionId: "chat-voice" },
});
const sessionId = created.body.sessionId;
await uploadRaw(ctx, {
  sessionId, filename: "pcm-000001.raw", kind: "audio", data: Buffer.from("PCM1"),
  headers: { "x-capture-segment-id": sessionId, "x-capture-audio-format": "pcm-s16le-16k" },
});
const finalize = await ctx.request({
  method: "POST", url: `/api/capture/sessions/${sessionId}/finalize`, payload: { chunkCount: 1, hq: null },
});
JSON.stringify({ status: finalize.statusCode, hq: finalize.body.hq, handoff: finalize.body.handoff })
=> {"status":200,"hq":{"state":"none"},"handoff":{"mode":"open"}}
```

A repeat with the SAME body is a no-op that returns the current state, not a
second seal:

```ts continue
const repeat = await ctx.request({
  method: "POST", url: `/api/capture/sessions/${sessionId}/finalize`, payload: { chunkCount: 1, hq: null },
});
JSON.stringify({ status: repeat.statusCode, hq: repeat.body.hq, handoff: repeat.body.handoff })
=> {"status":200,"hq":{"state":"none"},"handoff":{"mode":"open"}}
```

```ts cleanup
await ctx.cleanup();
```

A repeat that asks for HQ under a DIFFERENT emission than what already sealed
the recording is refused, not silently accepted — it does not overwrite the
recorded `hqRequest`:

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { kind: "voice", targetSessionId: "chat-voice" },
});
const sessionId = created.body.sessionId;
await uploadRaw(ctx, {
  sessionId, filename: "pcm-000001.raw", kind: "audio", data: Buffer.from("PCM1"),
  headers: { "x-capture-segment-id": sessionId, "x-capture-audio-format": "pcm-s16le-16k" },
});
await ctx.request({
  method: "POST", url: `/api/capture/sessions/${sessionId}/finalize`,
  payload: { chunkCount: 1, hq: { emissionId: "e1", sessionId: "chat-voice" } },
});
const conflicting = await ctx.request({
  method: "POST", url: `/api/capture/sessions/${sessionId}/finalize`,
  payload: { chunkCount: 1, hq: { emissionId: "e-other", sessionId: "chat-voice" } },
});
conflicting.statusCode
=> 409
```

```ts continue
// Wait for the (fire-and-forget, credential-less) HQ job's fast permanent
// failure to settle before this test's cleanup closes the event bus, so it
// can't emit into a torn-down bus mid-flight.
const settled = await waitForHqDone(ctx, sessionId);
settled.voice.hqRequest.emissionId
=> e1
```

```ts cleanup
await ctx.cleanup();
```

## Voice finalize with `hq` set writes the request and queues the job

```ts
const ctx = await makeTestServer();
const created = await ctx.request({
  method: "POST", url: "/api/capture/sessions", payload: { kind: "voice", targetSessionId: "chat-voice" },
});
const sessionId = created.body.sessionId;
await uploadRaw(ctx, {
  sessionId, filename: "pcm-000001.raw", kind: "audio", data: Buffer.from("PCM1"),
  headers: { "x-capture-segment-id": sessionId, "x-capture-audio-format": "pcm-s16le-16k" },
});
const finalize = await ctx.request({
  method: "POST", url: `/api/capture/sessions/${sessionId}/finalize`,
  payload: { chunkCount: 1, hq: { emissionId: "e1", sessionId: "chat-voice" } },
});
JSON.stringify({ status: finalize.statusCode, hq: finalize.body.hq })
=> {"status":200,"hq":{"state":"queued"}}
```

The manifest's `hqRequest` records the resolved service and the emission it's
tied to — the job (fired fire-and-forget, and left to fail in the background
here since this test box holds no HQ credentials) reads it back on resume:

```ts continue
const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${sessionId}/session.json`));
JSON.stringify({ emissionId: manifest.voice.hqRequest.emissionId, sessionId: manifest.voice.hqRequest.sessionId, service: manifest.voice.hqRequest.service })
=> {"emissionId":"e1","sessionId":"chat-voice","service":"whisper"}
```

```ts continue
// Let the credential-less job settle before cleanup closes the event bus.
await waitForHqDone(ctx, sessionId);
```

```ts cleanup
await ctx.cleanup();
```

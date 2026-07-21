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
const manifest = JSON.parse(await ctx.read(`tmp/capture-staging/${sessionId}/session.json`));
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
const manifest = JSON.parse(await ctx.read(`tmp/capture-staging/${sessionId}/session.json`));
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
const manifest = JSON.parse(await ctx.read(`tmp/capture-staging/${sessionId}/session.json`));
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
const stillOpen = JSON.parse(await ctx.read(`tmp/capture-staging/${sessionId}/session.json`));
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

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

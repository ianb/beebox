# Capture routes

The capture routes stage media into the box and, on finalize, write a
capture-session card. Uploads are multipart with `X-Capture-*` headers; audio
chunks carry a segment id so preparation can concatenate within a segment.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { buildMultipartForm } from "../../../src/lib/multipart.js";

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

## Create → two audio segments → finalize writes two audio cards

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

Finalize writes exactly one capture-session card, and its attach scope holds one
audio card per segment:

```ts continue
const done = await ctx.request({ method: "POST", url: `/api/capture/sessions/${sessionId}/finalize` });
done.statusCode
=> 200

done.body.cards.length
=> 1

const cardPath = done.body.cards[0];
const attachDir = cardPath.replace(".capture-session.card", ".attach");
const audioCard1 = await ctx.read(`${attachDir}/audio-001.audio.card`);
audioCard1.includes("recorded: 2026-07-09T14:00:00.000Z")
=> true

const audioCard2 = await ctx.read(`${attachDir}/audio-002.audio.card`);
audioCard2.includes("recorded: 2026-07-09T14:05:00.000Z")
=> true
```

The concatenated segment bytes land in each audio card's attach scope:

```ts continue
await ctx.read(`${attachDir}/audio-001.attach/audio-001.webm`)
=> SEGMENT-A

await ctx.read(`${attachDir}/audio-002.attach/audio-002.webm`)
=> SEGMENT-B
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

# Capture staging store

The staging store keeps a capture session under
`<boxRoot>/tmp/capture-staging/<id>/` with a `session.json` manifest. Uploads
stage as raw files; audio chunks group under their recording segment. The
lifecycle is `open → sealed → …` and a cancel tears the directory down.

```ts setup
import {
  createStagingSession,
  readStagingSession,
  addAudioChunk,
  addPhoto,
  addFile,
  setStagingState,
  sealStagingSession,
  cleanupStagingSession,
  stagingSessionIsEmpty,
} from "../../../src/core/capture/staging-store.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## Create → upload segments → seal lifecycle

A fresh session starts `open` and empty, with a `targetSessionId` recorded:

```ts
const box = await makeTmpBox();
const session = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-123", createdBy: null });
session.state
=> open

session.targetSessionId
=> chat-123

stagingSessionIsEmpty(session)
=> true
```

`session.json` is written to disk under the staging path:

```ts continue
(await box.list("tmp/capture-staging")).includes(`tmp/capture-staging/${session.id}/session.json`)
=> true
```

Two recording segments, each with two chunks, group under their segment id in
upload order:

```ts continue
await addAudioChunk({
  boxRoot: box.root, id: session.id,
  segmentId: "seg-a", segmentStartedAt: "2026-07-09T14:00:00.000Z",
  filename: "audio-0-001.webm", buffer: Buffer.from("A0"),
});
await addAudioChunk({
  boxRoot: box.root, id: session.id,
  segmentId: "seg-a", segmentStartedAt: "2026-07-09T14:00:00.000Z",
  filename: "audio-0-002.webm", buffer: Buffer.from("A1"),
});
await addAudioChunk({
  boxRoot: box.root, id: session.id,
  segmentId: "seg-b", segmentStartedAt: "2026-07-09T14:05:00.000Z",
  filename: "audio-1-001.webm", buffer: Buffer.from("B0"),
});
const afterAudio = await readStagingSession({ boxRoot: box.root, id: session.id });
afterAudio.segments.length
=> 2

JSON.stringify(afterAudio.segments.map((s) => ({ id: s.id, chunks: s.chunks })))
=> [{"id":"seg-a","chunks":["audio-0-001.webm","audio-0-002.webm"]},{"id":"seg-b","chunks":["audio-1-001.webm"]}]
```

Photos and files land in their own collections (photos keep `source`; files
keep `originalName`/`mimeType`):

```ts continue
await addPhoto({
  boxRoot: box.root, id: session.id,
  filename: "photo-001.jpg", capturedAt: "2026-07-09T14:01:00.000Z",
  source: "camera-environment", buffer: Buffer.from("JPEG"),
});
await addFile({
  boxRoot: box.root, id: session.id,
  filename: "file-001-report.pdf", uploadedAt: "2026-07-09T14:02:00.000Z",
  originalName: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("PDF"),
});
const staged = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify(staged.photos)
=> [{"filename":"photo-001.jpg","capturedAt":"2026-07-09T14:01:00.000Z","source":"camera-environment"}]

JSON.stringify(staged.files)
=> [{"filename":"file-001-report.pdf","uploadedAt":"2026-07-09T14:02:00.000Z","originalName":"report.pdf","mimeType":"application/pdf"}]

stagingSessionIsEmpty(staged)
=> false
```

The raw bytes are on disk, and sealing advances the lifecycle state:

```ts continue
await box.read(`tmp/capture-staging/${session.id}/audio-0-001.webm`)
=> A0

await setStagingState({ boxRoot: box.root, id: session.id, state: "sealed" });
(await readStagingSession({ boxRoot: box.root, id: session.id })).state
=> sealed
```

Cleanup removes the whole session directory:

```ts continue
await cleanupStagingSession({ boxRoot: box.root, id: session.id });
await readStagingSession({ boxRoot: box.root, id: session.id })
=> null
```

```ts cleanup
await box.cleanup();
```

## Concurrent chunk uploads to one segment all land (per-session lock)

Ten chunks fired at once on a single segment read-modify-write `session.json`;
the per-session promise-chain lock serializes them so none is lost:

```ts
const box = await makeTmpBox();
const session = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
await Promise.all(
  Array.from({ length: 10 }, (_v, i) =>
    addAudioChunk({
      boxRoot: box.root, id: session.id,
      segmentId: "seg-a", segmentStartedAt: "2026-07-09T14:00:00.000Z",
      filename: `audio-0-${String(i).padStart(3, "0")}.webm`, buffer: Buffer.from(`chunk-${i}`),
    }),
  ),
);
const after = await readStagingSession({ boxRoot: box.root, id: session.id });
after.segments.length
=> 1

after.segments[0].chunks.length
=> 10

new Set(after.segments[0].chunks).size
=> 10
```

```ts cleanup
await box.cleanup();
```

## `sealStagingSession` is a single-winner compare-and-swap

Two concurrent finalize POSTs both call the CAS; exactly one wins the
`open → sealed` transition, so preparation fires once:

```ts
const box = await makeTmpBox();
const session = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
const [a, b] = await Promise.all([
  sealStagingSession({ boxRoot: box.root, id: session.id }),
  sealStagingSession({ boxRoot: box.root, id: session.id }),
]);
[a.sealed, b.sealed].filter(Boolean).length
=> 1

[a.alreadySealed, b.alreadySealed].filter(Boolean).length
=> 1

(await readStagingSession({ boxRoot: box.root, id: session.id })).state
=> sealed
```

A `failed:*` session is fire-eligible again (the retry affordance), while an
in-flight `preparing`/`delivering`/`delivered` one is not:

```ts continue
await setStagingState({ boxRoot: box.root, id: session.id, state: "failed:deliver" });
(await sealStagingSession({ boxRoot: box.root, id: session.id })).sealed
=> true

await setStagingState({ boxRoot: box.root, id: session.id, state: "delivering" });
(await sealStagingSession({ boxRoot: box.root, id: session.id })).alreadySealed
=> true
```

```ts cleanup
await box.cleanup();
```

## Reading an unknown session returns null

```ts
const box = await makeTmpBox();
const missing = await readStagingSession({ boxRoot: box.root, id: "does-not-exist" });
missing
=> null
```

```ts cleanup
await box.cleanup();
```

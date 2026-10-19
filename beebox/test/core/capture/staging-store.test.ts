// # Capture staging store
//
// The staging store keeps a capture session under
// `<boxRoot>/_tmp/capture-staging/<id>/` with a `session.json` manifest. Uploads
// stage as raw files; audio chunks group under their recording segment. The
// lifecycle is `open → sealed → …` and a cancel tears the directory down.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str, unordered } from "@ianbicking/tap-check/check";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  createStagingSession,
  readStagingSession,
  addAudioChunk,
  addPhoto,
  addFile,
  registerBulkItems,
  setStagingState,
  sealStagingSession,
  stagingSessionIsEmpty,
} from "../../../src/core/capture/staging-store/core.js";
import { cleanupStagingSession } from "../../../src/core/capture/staging-teardown.js";
import { addFileStreamed } from "../../../src/core/capture/staging-stream.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

function errorName(e: unknown): string {
  return e instanceof Error ? e.name : String(e);
}

async function streamOrThrow(boxRoot: string, opts: { id: string; filename: string; itemId: string; bytes?: string }) {
  try {
    await addFileStreamed({
      boxRoot, id: opts.id, filename: opts.filename,
      uploadedAt: "2026-07-27T14:00:00.000Z", originalName: opts.filename,
      mimeType: "application/octet-stream", itemId: opts.itemId,
      source: Readable.from([Buffer.from(opts.bytes ?? "DATA")]),
    });
    return "ok";
  } catch (error) {
    return errorName(error);
  }
}

// ## Create → upload segments → seal lifecycle
//
// A fresh session starts `open` and empty:
void test("A fresh session starts open and empty:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const session = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-123", createdBy: null });
  t.check(session, {
    id: session.id,
    createdAt: isoDate(),
    lastActivityAt: isoDate(),
    targetSessionId: "chat-123",
    createdBy: null,
    kind: "capture",
    state: "open",
    segments: [],
    photos: [],
    files: [],
    totalBytes: 0,
  });

  t.check(stagingSessionIsEmpty(session), true);

  // Two recording segments, each with two chunks, group under their segment id in
  // upload order:

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
  assert.ok(afterAudio);
  const segments = [
    { id: "seg-a", startedAt: "2026-07-09T14:00:00.000Z", format: "webm-opus" as const, chunks: ["audio-0-001.webm", "audio-0-002.webm"] },
    { id: "seg-b", startedAt: "2026-07-09T14:05:00.000Z", format: "webm-opus" as const, chunks: ["audio-1-001.webm"] },
  ];
  t.check(afterAudio.segments, segments);

  // Photos and files land in their own collections (photos keep `source`; files
  // keep `originalName`/`mimeType`):

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
  assert.ok(staged);
  t.check(staged.photos, [
    {
      filename: "photo-001.jpg",
      capturedAt: "2026-07-09T14:01:00.000Z",
      source: "camera-environment",
    },
  ]);

  t.check(staged.files, [
    {
      filename: "file-001-report.pdf",
      uploadedAt: "2026-07-09T14:02:00.000Z",
      originalName: "report.pdf",
      mimeType: "application/pdf",
    },
  ]);

  t.check(stagingSessionIsEmpty(staged), false);

  // The raw bytes are on disk, and sealing advances the lifecycle state:

  t.check(await box.read(`_tmp/capture-staging/${session.id}/audio-0-001.webm`), "A0");

  await setStagingState({ boxRoot: box.root, id: session.id, state: "sealed" });
  t.check(await readStagingSession({ boxRoot: box.root, id: session.id }), {
    id: session.id,
    createdAt: isoDate(),
    lastActivityAt: isoDate(),
    targetSessionId: "chat-123",
    createdBy: null,
    kind: "capture",
    state: "sealed",
    segments,
    photos: staged.photos,
    files: staged.files,
    totalBytes: 13,
  });

  // Cleanup removes the whole session directory:

  await cleanupStagingSession({ boxRoot: box.root, id: session.id });
  t.check(await readStagingSession({ boxRoot: box.root, id: session.id }), null);
});

// ## M4A segments accept exactly one complete file
//
// Native audio declares `m4a-aac`; a second file or a WebM chunk under the same
// segment id is rejected before the bytes or manifest mutate.
void test("Native audio declares m4a-aac; a second file or a WebM chunk under the same s...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const session = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
  await addAudioChunk({
    boxRoot: box.root,
    id: session.id,
    segmentId: "native-audio",
    segmentStartedAt: "2026-07-09T14:00:00.000Z",
    filename: "ios-audio-a.m4a",
    buffer: Buffer.from("COMPLETE"),
    audioFormat: "m4a-aac",
  });
  let message = "";
  try {
    await addAudioChunk({
      boxRoot: box.root,
      id: session.id,
      segmentId: "native-audio",
      segmentStartedAt: "2026-07-09T14:00:00.000Z",
      filename: "ios-audio-b.m4a",
      buffer: Buffer.from("SECOND"),
      audioFormat: "m4a-aac",
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const after = await readStagingSession({ boxRoot: box.root, id: session.id });
  assert.ok(after);
  const files = await box.list(`_tmp/capture-staging/${session.id}`);
  t.check(message, "M4A segment must contain exactly one complete file");
  t.check(after.segments, [{
    id: "native-audio",
    startedAt: "2026-07-09T14:00:00.000Z",
    format: "m4a-aac",
    chunks: ["ios-audio-a.m4a"],
  }]);
  t.checkText(files, `_tmp/capture-staging/${session.id}/ios-audio-a.m4a
_tmp/capture-staging/${session.id}/session.json`);
});

// ## Concurrent chunk uploads to one segment all land (per-session lock)
//
// Ten chunks fired at once on a single segment read-modify-write `session.json`;
// the per-session promise-chain lock serializes them so none is lost:
void test("Ten chunks fired at once on a single segment read-modify-write session.json;...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
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
  assert.ok(after);
  t.check(after.segments, [{
    id: "seg-a",
    startedAt: "2026-07-09T14:00:00.000Z",
    format: "webm-opus",
    chunks: Array.from({ length: 10 }, (_v, i) => `audio-0-${String(i).padStart(3, "0")}.webm`),
  }]);
});

// ## `sealStagingSession` is a single-winner compare-and-swap
//
// Two concurrent finalize POSTs both call the CAS; exactly one wins the
// `open → sealed` transition, so preparation fires once:
void test("Two concurrent finalize POSTs both call the CAS; exactly one wins the open →...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const session = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
  const [a, b] = await Promise.all([
    sealStagingSession({ boxRoot: box.root, id: session.id }),
    sealStagingSession({ boxRoot: box.root, id: session.id }),
  ]);
  t.check([a, b], unordered([{ sealed: true, alreadySealed: false }, { sealed: false, alreadySealed: true }]));

  t.check((await readStagingSession({ boxRoot: box.root, id: session.id }))?.state, "sealed");

  // A `failed:*` session is fire-eligible again (the retry affordance), while an
  // in-flight `preparing`/`delivering`/`delivered` one is not:

  await setStagingState({ boxRoot: box.root, id: session.id, state: "failed:deliver" });
  t.check(await sealStagingSession({ boxRoot: box.root, id: session.id }), { sealed: true, alreadySealed: false });

  await setStagingState({ boxRoot: box.root, id: session.id, state: "delivering" });
  t.check(await sealStagingSession({ boxRoot: box.root, id: session.id }), { sealed: false, alreadySealed: true });

  // The uploader's failed-item report rides in the SAME atomic seal write — a fresh
  // session seals to `sealed` and records `failedItems` in one mutation (no window
  // where a sealed batch lacks its failed list):

  const withFailed = await createStagingSession({
    boxRoot: box.root, targetSessionId: null, createdBy: null, kind: "bulk",
    contextDir: "", expectedItems: [{ id: "a", name: "a.bin" }],
  });
  await sealStagingSession({ boxRoot: box.root, id: withFailed.id, failedItems: [{ id: "a", name: "a.bin", reason: "timed out" }] });
  const sealedWithFailed = await readStagingSession({ boxRoot: box.root, id: withFailed.id });
  assert.ok(sealedWithFailed);
  t.check({ state: sealedWithFailed.state, failed: sealedWithFailed.failedItems }, {
    state: "sealed",
    failed: [
      {
        id: "a",
        name: "a.bin",
        reason: "timed out",
      },
    ],
  });
});

// ## The seal is a barrier: a commit racing finalize is rejected, temp file cleaned
//
// A streamed upload re-checks the session state AND item registration *under the
// lock* at commit time. A finalize that sealed the session between the route's
// pre-lock check and the commit can't slip bytes into a sealed batch — the commit
// throws, no file is added, and the streaming temp file is cleaned up (no
// `.upload-tmp-*` leak):
void test("A streamed upload re-checks the session state AND item registration under the...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const session = await createStagingSession({
    boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "bulk",
    contextDir: "", expectedItems: [{ id: "a", name: "x.bin" }],
  });

  // Seal (as a concurrent finalize would), then attempt the commit.
  await setStagingState({ boxRoot: box.root, id: session.id, state: "sealed" });
  const sealedResult = await streamOrThrow(box.root, { id: session.id, filename: "s-a.bin", itemId: "a" });
  const after = await readStagingSession({ boxRoot: box.root, id: session.id });
  assert.ok(after);
  t.check(sealedResult, "StagingSessionNotOpenError");
  t.check(after.files, []);
  t.checkText(await box.list(`_tmp/capture-staging/${session.id}`), `_tmp/capture-staging/${session.id}/session.json`);

  // An unregistered `itemId` is likewise rejected under the lock (registration is
  // the record of what may arrive):

  const openBox = await createStagingSession({
    boxRoot: box.root, targetSessionId: "chat-1", createdBy: null, kind: "bulk",
    contextDir: "", expectedItems: [{ id: "a", name: "x.bin" }],
  });
  const ghostResult = await streamOrThrow(box.root, { id: openBox.id, filename: "s-g.bin", itemId: "ghost" });
  t.check(ghostResult, "StagingItemNotRegisteredError");

  // Registration itself is frozen by the seal — appending an item to a sealed
  // session throws rather than mutating the frozen registry:

  let registerResult = "ok";
  try {
    await registerBulkItems({ boxRoot: box.root, id: session.id, items: [{ id: "late", name: "late.bin" }] });
  } catch (error) {
    registerResult = errorName(error);
  }
  const registerOutcome = registerResult;
  t.check(registerOutcome, "StagingSessionNotOpenError");
});

// ## Reading an unknown session returns null
//
// Missing (ENOENT) is a silently-absent session — no quarantine, no log:
void test("Missing (ENOENT) is a silently-absent session — no quarantine, no log:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const missing = await readStagingSession({ boxRoot: box.root, id: "does-not-exist" });
  t.check(missing, null);

  t.check(await box.list("_tmp/capture-staging").catch(() => ""), "");
});

// ## `session.json` is written atomically (temp-file + rename)
//
// A write never leaves a bare `session.json.tmp-*` file behind — only the
// final `session.json`:
void test("A write never leaves a bare session.json.tmp- file behind — only the final se...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const session = await createStagingSession({ boxRoot: box.root, targetSessionId: "chat-1", createdBy: null });
  const entries = await box.list(`_tmp/capture-staging/${session.id}`);
  t.check(entries, `_tmp/capture-staging/${session.id}/session.json`);
});

// ## A corrupt manifest is quarantined, logged, and read as null
//
// Invalid JSON in `session.json` is not indistinguishable from an absent
// session: the read logs a `console.error`, renames the bad file to
// `session.json.corrupt` (preserving it for inspection), and returns `null`
// rather than silently stranding the staged bytes next to it:
void test("Invalid JSON in session.json is not indistinguishable from an absent session:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const session = await createStagingSession({ boxRoot: box.root, targetSessionId: null, createdBy: null });
  await box.write(`_tmp/capture-staging/${session.id}/session.json`, "{ not valid json");
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
  const result = await readStagingSession({ boxRoot: box.root, id: session.id });
  console.error = originalError;
  t.check(result, null);

  t.check(errors, [str`[capture] Corrupt staging manifest for session ${session.id} in box ${box.root}: ${any(String)}`]);

  t.check(await box.list(`_tmp/capture-staging/${session.id}`), `_tmp/capture-staging/${session.id}/session.json.corrupt`);

  // A schema-invalid manifest (valid JSON, wrong shape) quarantines the same way,
  // and a repeated read against the already-quarantined session doesn't blow up
  // on a missing file — it's ENOENT again, silent:

  await box.write(`_tmp/capture-staging/${session.id}/session.json.corrupt`, "");
  await box.write(`_tmp/capture-staging/${session.id}/session.json`, JSON.stringify({ not: "a session" }));
  console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
  const schemaResult = await readStagingSession({ boxRoot: box.root, id: session.id });
  console.error = originalError;
  t.check(schemaResult, null);

  const corruptNotice = str`[capture] Corrupt staging manifest for session ${session.id} in box ${box.root}: ${any(String)}`;
  t.check(errors, [corruptNotice, corruptNotice]);

  t.check(await box.list(`_tmp/capture-staging/${session.id}`), `_tmp/capture-staging/${session.id}/session.json.corrupt`);

  const secondRead = await readStagingSession({ boxRoot: box.root, id: session.id });
  t.check(secondRead, null);

  t.check(errors, [corruptNotice, corruptNotice]);
});

// ## A sealed session refuses new media
//
// The upload route checks `state === "open"` before it reads the request body, so a
// finalize can seal the session while the bytes are still arriving — and aborting
// the client's request cannot help, because the server may already hold the whole
// body. Without a barrier the media would append after preparation had already
// snapshotted the manifest, and then be discarded along with the staging directory.
//
// So the store re-asserts it under the lock. A sealed session rejects every kind of
// media add:
void test("The upload route checks state === \"open\" before it reads the request body, so...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const session = await createStagingSession({
    boxRoot: box.root, targetSessionId: "chat-1", createdBy: null,
  });
  await addPhoto({
    boxRoot: box.root, id: session.id, filename: "photo-001.jpg",
    capturedAt: "2026-07-29T12:00:00.000Z", source: "camera-user",
    buffer: Buffer.from("BEFORE"),
  });
  await sealStagingSession({ boxRoot: box.root, id: session.id });

  async function addOrFail(fn: () => Promise<void>) {
    try { await fn(); return "accepted"; } catch (error) { return errorName(error); }
  }

  const photo = await addOrFail(() => addPhoto({
    boxRoot: box.root, id: session.id, filename: "photo-002.jpg",
    capturedAt: "2026-07-29T12:00:01.000Z", source: "camera-user",
    buffer: Buffer.from("LATE"),
  }));
  const audio = await addOrFail(() => addAudioChunk({
    boxRoot: box.root, id: session.id, segmentId: "seg-1",
    segmentStartedAt: "2026-07-29T12:00:00.000Z", filename: "audio-0-001.webm",
    buffer: Buffer.from("LATE"),
  }));
  const file = await addOrFail(() => addFile({
    boxRoot: box.root, id: session.id, filename: "file-001-notes.txt",
    uploadedAt: "2026-07-29T12:00:02.000Z", originalName: "notes.txt",
    mimeType: "text/plain", buffer: Buffer.from("LATE"),
  }));
  t.check([photo, audio, file], ["StagingSessionNotOpenError", "StagingSessionNotOpenError", "StagingSessionNotOpenError"]);

  // The manifest is untouched by the rejected adds — it still holds only the photo
  // that landed while the session was open, and no stray bytes were written:

  const after = await readStagingSession({ boxRoot: box.root, id: session.id });
  assert.ok(after);
  t.check({ photos: after.photos, segments: after.segments, files: after.files }, {
    photos: [{ filename: "photo-001.jpg", capturedAt: "2026-07-29T12:00:00.000Z", source: "camera-user" }],
    segments: [],
    files: [],
  });

  t.checkText(await box.list(`_tmp/capture-staging/${session.id}`), `_tmp/capture-staging/${session.id}/photo-001.jpg
_tmp/capture-staging/${session.id}/session.json`);

  // Lifecycle transitions themselves still work on a sealed session — the barrier is
  // specific to *media*, so preparation can keep moving the state forward:

  await setStagingState({ boxRoot: box.root, id: session.id, state: "delivered" });
  const delivered = await readStagingSession({ boxRoot: box.root, id: session.id });
  t.check(delivered?.state, "delivered");
});

// # Capture routes: voice sessions
//
// Continues [capture.doctest.md](capture.doctest.md). This part covers voice sessions: idempotent client-generated create with an owner and kind fence, staging of `pcm-s16le-16k` chunks, finalize contiguity checks, idempotent finalize, and finalize with `hq` set.

import { test } from "tap";
import "agent-doctest/tap";
import { any, str } from "agent-doctest/check";
import { z } from "zod";
import { makeTestServer, type InjectResult, type TestServer } from "../../helpers/test-route-server.js";
import { StagingSessionSchema, type StagingSession, type StagingVoice } from "../../../src/core/capture/staging-schema.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";

// Response bodies of the capture routes; every field is optional because
// success and error responses carry different keys.
const CaptureBody = z.looseObject({
  sessionId: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  staged: z.boolean().optional(),
  capabilities: z.unknown().optional(),
  hq: z.unknown().optional(),
  handoff: z.unknown().optional(),
  resumable: z.array(z.looseObject({ id: z.string() })).optional(),
});

async function respond(pending: Promise<InjectResult>) {
  const res = await pending;
  return { statusCode: res.statusCode, body: CaptureBody.parse(res.body) };
}

// The id of a created session; fails the test when the response carried none.
function sessionIdOf(res: { body: { sessionId?: string | undefined } }): string {
  if (res.body.sessionId === undefined) throw new Error("response carried no sessionId");
  return res.body.sessionId;
}

interface UploadOpts {
  sessionId: string;
  filename: string;
  data: Buffer;
  contentType?: string;
  kind?: string;
  startedAt?: string;
  source?: string;
  headers?: Record<string, string>;
}

// Wait for a voice session's (fire-and-forget) HQ job to settle before a
// test's cleanup closes the event bus — a still-running job emitting into a
// torn-down bus would throw asynchronously into the NEXT test.
async function waitForHqDone(ctx: TestServer, id: string) {
  const timeoutMs = 2000;
  const start = Date.now();
  for (;;) {
    const manifest = await manifestOf(ctx, id);
    if (voiceOf(manifest).hq.state === "failed" || voiceOf(manifest).hq.state === "ready") return manifest;
    if (Date.now() - start > timeoutMs) return manifest;
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Stage one raw body exactly as URLSessionUploadTask does from a file URL.
async function uploadRaw(ctx: TestServer, opts: UploadOpts & { kind: string }) {
  return respond(ctx.request({
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
  }));
}

const SESSIONS = "/api/capture/sessions";

// Create a capture/voice session; returns the response.
function createSession(ctx: TestServer, payload: object) {
  return createSessionWithHeaders(ctx, { payload, headers: {} });
}

// Create a session as the paired device whose bearer headers are given.
function createSessionWithHeaders(ctx: TestServer, { payload, headers }: { payload: object; headers: Record<string, string> }) {
  return respond(ctx.request({ method: "POST", url: SESSIONS, payload, headers }));
}

// A voice session's `voice` object; fails the test on any other kind.
function voiceOf(session: StagingSession): StagingVoice {
  if (session.voice === undefined) throw new Error(`session ${session.id} has no voice object`);
  return session.voice;
}

// A voice session's recorded HQ request; fails the test when none was recorded.
function hqRequestOf(session: StagingSession) {
  const request = voiceOf(session).hqRequest;
  if (request === undefined) throw new Error(`session ${session.id} recorded no HQ request`);
  return request;
}

async function manifestOf(ctx: TestServer, id: string) {
  return StagingSessionSchema.parse(JSON.parse(await ctx.read(`_tmp/capture-staging/${id}/session.json`)));
}

// Pair a device whose identity is `createdBy`; returns its bearer headers.
async function pairedAuth(ctx: TestServer, { createdBy, deviceLabel }: { createdBy: string; deviceLabel: string }) {
  const ticket = createMobilePairingTicket(ctx.boxRoot, { createdBy });
  const paired = await redeemMobilePairingTicket(ctx.boxRoot, { pairingToken: ticket.token, deviceLabel });
  if (!paired) throw new Error(`pairing failed for ${createdBy}`);
  return { authorization: `Bearer ${paired.deviceToken}` };
}

// Upload PCM chunk `n` (1-based) of a voice recording; its segment id is the recording id.
function pcmChunk(ctx: TestServer, { recordingId, n, text }: { recordingId: string; n: number; text: string }) {
  return uploadRaw(ctx, {
    sessionId: recordingId, filename: `pcm-${String(n).padStart(6, "0")}.raw`, kind: "audio", data: Buffer.from(text),
    headers: { "x-capture-segment-id": recordingId, "x-capture-audio-format": "pcm-s16le-16k" },
  });
}

// A voice session with one uploaded chunk; returns its id.
async function voiceWithChunk(ctx: TestServer) {
  const created = await createSession(ctx, { kind: "voice", targetSessionId: "chat-voice" });
  await pcmChunk(ctx, { recordingId: sessionIdOf(created), n: 1, text: "PCM1" });
  return sessionIdOf(created);
}

function finalize(ctx: TestServer, { sessionId, payload, headers }: { sessionId: string; payload?: object; headers?: Record<string, string> }) {
  const url = `${SESSIONS}/${sessionId}/finalize`;
  const requestHeaders = headers ?? {};
  return respond(ctx.request(payload === undefined ? { method: "POST", url, headers: requestHeaders } : { method: "POST", url, payload, headers: requestHeaders }));
}

// ## Voice sessions: idempotent client-generated create, and a fenced-off owner/kind
//
// A voice recording (`docs/plans/resilient-voice-recording.md`) creates its
// staging session with a client-generated UUID v4, so the browser can start
// staging before the box confirms the session exists. A repeat of the same id,
// kind and owner is a no-op that returns the existing session:
void test("A voice recording (docs/plans/resilient-voice-recording.md) creates its stagi...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L163
  const ctx = await makeTestServer();
  const recordingId = "6a6e6b1e-2f8a-4c9a-8b1a-1a2b3c4d5e6f";
  const voice = { kind: "voice", targetSessionId: "chat-voice", id: recordingId };
  const created = await createSession(ctx, voice);
  const repeat = await createSession(ctx, voice);
  t.check([created, repeat].map((r) => ({ status: r.statusCode, sessionId: r.body.sessionId })), [
    {
      status: 200,
      sessionId: "6a6e6b1e-2f8a-4c9a-8b1a-1a2b3c4d5e6f",
    },
    {
      status: 200,
      sessionId: "6a6e6b1e-2f8a-4c9a-8b1a-1a2b3c4d5e6f",
    },
  ]);

  // The manifest carries the `voice` object with `hq: none` and `handoff: open`,
  // and was created only once (one directory, not two):

  // doctest:L176
  const manifest = await manifestOf(ctx, recordingId);
  t.check(({ kind: manifest.kind, voice: manifest.voice }), {
    kind: "voice",
    voice: {
      targetSessionId: "chat-voice",
      startedAt: str`${any(String)}`,
      hq: {
        state: "none",
      },
      handoff: {
        mode: "open",
      },
    },
  });

  // A non-UUID-v4 id is rejected before any session is created:

  // doctest:L184
  const badId = await createSession(ctx, { ...voice, id: "not-a-uuid" });
  t.check(badId.statusCode, 400);

  // A voice session may start without a `targetSessionId`: the mic can open in a
  // brand-new chat before it has a session. The manifest records `null`; the HQ
  // job and late delivery read the session from finalize's `hq.sessionId` instead.

  // doctest:L194
  const unboundId = "8c8d8e3f-4a0b-4e1c-8d3c-3c4d5e6f7081";
  const noTarget = await createSession(ctx, { kind: "voice", id: unboundId });
  t.check(noTarget.statusCode, 200);

  // doctest:L199
  t.check(voiceOf(await manifestOf(ctx, unboundId)).targetSessionId, null);
});

// A different mobile-pairing owner reusing the same recording id is a conflict,
// not a silent takeover:
void test("A different mobile-pairing owner reusing the same recording id is a conflict,...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L211
  const ctx = await makeTestServer();
  const ownerAuth = await pairedAuth(ctx, { createdBy: "owner@example.com", deviceLabel: "Owner's phone" });
  const otherAuth = await pairedAuth(ctx, { createdBy: "other@example.com", deviceLabel: "Other phone" });
  const voice = { kind: "voice", targetSessionId: "chat-voice", id: "7b7f7c2f-3f9b-4d0b-9c2b-2b3c4d5e6f70" };
  const created = await createSessionWithHeaders(ctx, { payload: voice, headers: ownerAuth });
  t.check(created.statusCode, 200);

  // doctest:L219
  const stolen = await createSessionWithHeaders(ctx, { payload: voice, headers: otherAuth });
  t.check(({ status: stolen.statusCode, error: stolen.body.error }), {
    status: 409,
    error: "Session id already used by a different recording",
  });
});

// ## Voice sessions stage `pcm-s16le-16k` chunks; capture sessions cannot
//
// The upload route accepts one segment of raw PCM chunks per voice recording,
// its id the recording's own id, filenames `pcm-000001.raw` in sequence — the
// same idempotent-replay mechanism as every other capture upload. An exact-bytes
// replay of the first chunk is idempotent, as any other capture upload's is:
void test("The upload route accepts one segment of raw PCM chunks per voice recording, i...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L236
  const ctx = await makeTestServer();
  const recordingId = "8c8f8d3f-4f0c-4e1c-8d3c-3c4d5e6f7081";
  await createSession(ctx, { kind: "voice", targetSessionId: "chat-voice", id: recordingId });

  // doctest:L240
  const chunk1 = await pcmChunk(ctx, { recordingId, n: 1, text: "PCM1" });
  const chunk2 = await pcmChunk(ctx, { recordingId, n: 2, text: "PCM2" });
  t.check([chunk1.statusCode, chunk2.statusCode], [
    200,
    200,
  ]);

  // doctest:L245
  const manifest = await manifestOf(ctx, recordingId);
  t.check(manifest.segments.map((s) => ({ id: s.id, format: s.format, chunks: s.chunks })), [
    {
      id: "8c8f8d3f-4f0c-4e1c-8d3c-3c4d5e6f7081",
      format: "pcm-s16le-16k",
      chunks: [
        "pcm-000001.raw",
        "pcm-000002.raw",
      ],
    },
  ]);

  // doctest:L249
  t.check((await pcmChunk(ctx, { recordingId, n: 1, text: "PCM1" })).statusCode, 200);
});

// A `pcm-s16le-16k` chunk aimed at an ordinary capture session is refused —
// capture's finalize path never learned to concatenate or convert raw PCM:
void test("A pcm-s16le-16k chunk aimed at an ordinary capture session is refused — captu...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L261
  const ctx = await makeTestServer();
  const created = await createSession(ctx, { targetSessionId: "chat-abc" });
  const res = await uploadRaw(ctx, {
    sessionId: sessionIdOf(created), filename: "pcm-000001.raw", kind: "audio", data: Buffer.from("PCM"),
    headers: { "x-capture-segment-id": "seg-a", "x-capture-audio-format": "pcm-s16le-16k" },
  });
  t.check(({ status: res.statusCode, error: res.body.error }), {
    status: 400,
    error: "pcm-s16le-16k audio is only accepted for voice sessions",
  });
});

// ## Voice finalize verifies contiguity before sealing
//
// Uploads are refused once a session isn't `open`, so a chunk missing at
// finalize time is gone for good — finalize checks the manifest holds exactly
// `pcm-000001.raw … pcm-<chunkCount>.raw` and refuses to seal on a gap. The
// session is NOT sealed — it's still `open`, so the missing chunk could still be
// uploaded and finalize retried:
void test("Uploads are refused once a session isn't open, so a chunk missing at finalize...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L284
  const ctx = await makeTestServer();
  const created = await createSession(ctx, { kind: "voice", targetSessionId: "chat-voice" });
  const sessionId = sessionIdOf(created);
  // Only chunk 2 uploaded — chunk 1 never arrived.
  await pcmChunk(ctx, { recordingId: sessionId, n: 2, text: "PCM2" });
  const res = await finalize(ctx, { sessionId, payload: { chunkCount: 2, emissionId: null, hq: null } });
  t.check(({ status: res.statusCode, code: res.body.code }), {
    status: 409,
    code: "missing-chunks",
  });

  // doctest:L293
  t.check((await manifestOf(ctx, sessionId)).state, "open");
});

// ## Voice finalize is idempotent; a conflicting repeat is refused
//
// A finalize with no HQ requested seals the session and leaves `hq: none`,
// `handoff: open`. It records `voice.emissionId` even with no HQ requested, so a
// non-HQ send is still findable by its message id (`get-last-audio`). A repeat
// with the SAME body is a no-op that returns the current state, not a second seal:
void test("A finalize with no HQ requested seals the session and leaves hq:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L309
  const ctx = await makeTestServer();
  const sessionId = await voiceWithChunk(ctx);
  const body = { chunkCount: 1, emissionId: "em-idem", hq: null };
  const first = await finalize(ctx, { sessionId, payload: body });
  const repeat = await finalize(ctx, { sessionId, payload: body });
  t.check([first, repeat].map((r) => ({ status: r.statusCode, hq: r.body.hq, handoff: r.body.handoff })), [
    {
      status: 200,
      hq: {
        state: "none",
      },
      handoff: {
        mode: "open",
      },
    },
    {
      status: 200,
      hq: {
        state: "none",
      },
      handoff: {
        mode: "open",
      },
    },
  ]);

  // doctest:L317
  t.check(voiceOf(await manifestOf(ctx, sessionId)).emissionId, "em-idem");
});

// Finalize refuses when `hq.emissionId` disagrees with the top-level
// `emissionId` — the two must name the same message:
void test("Finalize refuses when hq.emissionId disagrees with the top-level emissionId —...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L329
  const ctx = await makeTestServer();
  const sessionId = await voiceWithChunk(ctx);
  const mismatch = await finalize(ctx, {
    sessionId,
    payload: { chunkCount: 1, emissionId: "em-top", hq: { emissionId: "em-different", sessionId: "chat-voice" } },
  });
  t.check(({ status: mismatch.statusCode, code: mismatch.body.code }), {
    status: 409,
    code: "emission-mismatch",
  });
});

// A repeat that asks for HQ under a DIFFERENT emission than what already sealed
// the recording is refused, not silently accepted — it does not overwrite the
// recorded `hqRequest`:
void test("A repeat that asks for HQ under a DIFFERENT emission than what already sealed...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L347
  const ctx = await makeTestServer();
  const sessionId = await voiceWithChunk(ctx);
  await finalize(ctx, { sessionId, payload: { chunkCount: 1, emissionId: "e1", hq: { emissionId: "e1", sessionId: "chat-voice" } } });
  const conflicting = await finalize(ctx, {
    sessionId,
    payload: { chunkCount: 1, emissionId: "e-other", hq: { emissionId: "e-other", sessionId: "chat-voice" } },
  });
  t.check(conflicting.statusCode, 409);

  // doctest:L358
  // Wait for the (fire-and-forget, credential-less) HQ job's fast permanent
  // failure to settle before this test's cleanup closes the event bus, so it
  // can't emit into a torn-down bus mid-flight.
  const settled = await waitForHqDone(ctx, sessionId);
  t.check(hqRequestOf(settled).emissionId, "e1");
});

// ## Voice finalize with `hq` set writes the request and queues the job
//
// The manifest's `hqRequest` records the resolved service and the emission it's
// tied to — the job (fired fire-and-forget, and left to fail in the background
// here since this test box holds no HQ credentials) reads it back on resume:
void test("The manifest's hqRequest records the resolved service and the emission it's t...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L377
  const ctx = await makeTestServer();
  const sessionId = await voiceWithChunk(ctx);
  const res = await finalize(ctx, {
    sessionId,
    payload: { chunkCount: 1, emissionId: "e1", hq: { emissionId: "e1", sessionId: "chat-voice" } },
  });
  t.check(({ status: res.statusCode, hq: res.body.hq }), {
    status: 200,
    hq: {
      state: "queued",
    },
  });

  // doctest:L385
  const manifest = await manifestOf(ctx, sessionId);
  const { emissionId, sessionId: hqSessionId, service } = hqRequestOf(manifest);
  t.check(({ emissionId, sessionId: hqSessionId, service }), {
    emissionId: "e1",
    sessionId: "chat-voice",
    service: "whisper",
  });

  // doctest:L392
  // Let the credential-less job settle before cleanup closes the event bus.
  await waitForHqDone(ctx, sessionId);
});

// ## Voice finalize may request HQ before the chat has a session
//
// The first voice message of a new chat is finalized before the box assigns a
// session, so `hq.sessionId` is null. The request is still recorded (and the
// job queued); `voiceRecording.fallBack` names the session later.
void test("The first voice message of a new chat is finalized before the box assigns a s...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L407
  const ctx = await makeTestServer();
  const created = await createSession(ctx, { kind: "voice" });
  const sessionId = sessionIdOf(created);
  await pcmChunk(ctx, { recordingId: sessionId, n: 1, text: "PCM1" });
  const res = await finalize(ctx, {
    sessionId,
    payload: { chunkCount: 1, emissionId: "e-new", hq: { emissionId: "e-new", sessionId: null } },
  });
  t.check(({ status: res.statusCode, hq: res.body.hq }), {
    status: 200,
    hq: {
      state: "queued",
    },
  });

  // doctest:L417
  const { emissionId, sessionId: hqSessionId } = hqRequestOf(await manifestOf(ctx, sessionId));
  t.check(({ emissionId, sessionId: hqSessionId }), {
    emissionId: "e-new",
    sessionId: null,
  });

  // doctest:L423
  await waitForHqDone(ctx, sessionId);
});

// # Capture routes
//
// The capture routes stage media into the box; finalize seals the staging session
// and kicks off the background preparation worker (Track 3), returning immediately.
// Uploads are multipart with `X-Capture-*` headers; audio chunks carry a segment id
// so preparation can concatenate within a segment. (The full prepare → transcribe →
// assemble → deliver pipeline is covered by `test/core/capture/prepare.doctest.md`;
// here we test the route boundary only.)

import { test } from "tap";
import "agent-doctest/tap";
import { str, uuid } from "agent-doctest/check";
import { z } from "zod";
import { makeTestServer, type InjectResult, type TestServer } from "../../helpers/test-route-server.js";
import { StagingSessionSchema } from "../../../src/core/capture/staging-schema.js";
import { buildMultipartForm } from "../../../src/lib/multipart.js";
import { setStagingState, readStagingSession, writeStagingSession } from "../../../src/core/capture/staging-store/core.js";
import { MAX_STAGED_BYTES } from "../../../src/core/capture/staging-limits.js";
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

// Stage one upload via multipart, mirroring the browser client.
async function upload(ctx: TestServer, opts: UploadOpts) {
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
  return respond(ctx.request({
    method: "POST",
    url: `/api/capture/sessions/${opts.sessionId}/upload`,
    payload: body,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "x-capture-filename": opts.filename,
      ...opts.headers,
    },
  }));
}

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

function finalize(ctx: TestServer, { sessionId, payload, headers }: { sessionId: string; payload?: object; headers?: Record<string, string> }) {
  const url = `${SESSIONS}/${sessionId}/finalize`;
  const requestHeaders = headers ?? {};
  return respond(ctx.request(payload === undefined ? { method: "POST", url, headers: requestHeaders } : { method: "POST", url, payload, headers: requestHeaders }));
}

// ## Create → two audio segments land in the staging manifest
//
// Creating a session records the chat `targetSessionId` it was started from and
// advertises the accepted formats. One chunk for each of two recording segments
// lands in the staging manifest, in order, each with its chunk:
void test("Creating a session records the chat targetSessionId it was started from and a...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L127
  const ctx = await makeTestServer();
  const created = await createSession(ctx, { targetSessionId: "chat-abc" });
  t.check([created.statusCode, created.body.capabilities], [
    200,
    {
      acceptedAudioFormats: [
        "webm-opus",
        "m4a-aac",
      ],
      acceptedUploadEncodings: [
        "raw-body-v1",
      ],
    },
  ]);

  // doctest:L132
  const sessionId = sessionIdOf(created);
  const segment = ({ id, filename, startedAt }: { id: string; filename: string; startedAt: string }) =>
    upload(ctx, {
      sessionId, filename, contentType: "audio/webm", data: Buffer.from(`SEGMENT-${id.toUpperCase()}`),
      headers: {
        "x-capture-kind": "audio",
        "x-capture-source": "microphone",
        "x-capture-segment-id": `seg-${id}`,
        "x-capture-segment-started-at": startedAt,
        "x-capture-started-at": startedAt,
      },
    });
  const a = await segment({ id: "a", filename: "audio-0-001.webm", startedAt: "2026-07-09T14:00:00.000Z" });
  const b = await segment({ id: "b", filename: "audio-1-001.webm", startedAt: "2026-07-09T14:05:00.000Z" });
  t.check([a.statusCode, b.statusCode], [
    200,
    200,
  ]);

  // doctest:L149
  const manifest = await manifestOf(ctx, sessionId);
  t.check(manifest.segments.map((s) => ({ id: s.id, chunks: s.chunks, format: s.format })), [
    {
      id: "seg-a",
      chunks: [
        "audio-0-001.webm",
      ],
      format: "webm-opus",
    },
    {
      id: "seg-b",
      chunks: [
        "audio-1-001.webm",
      ],
      format: "webm-opus",
    },
  ]);
});

// ## Raw JPEG and complete M4A bodies reach the upload handler
//
// The native transport sends `application/octet-stream`; Fastify must parse it to
// a Buffer before the route runs. M4A is one complete file per segment, while a
// second file or a mixed format is rejected before either filename is staged.
void test("The native transport sends application/octet-stream; Fastify must parse it to...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L165
  const ctx = await makeTestServer();
  const created = await createSession(ctx, { targetSessionId: "chat-native" });
  const sessionId = sessionIdOf(created);
  const m4a = { "x-capture-segment-id": "native-segment", "x-capture-segment-started-at": "2026-07-09T14:01:00.000Z", "x-capture-audio-format": "m4a-aac" };
  const sendPhoto = (data: string) => uploadRaw(ctx, { sessionId, filename: "ios-photo-a.jpg", kind: "photo", data: Buffer.from(data) });
  const sendAudio = () => uploadRaw(ctx, { sessionId, filename: "ios-audio-a.m4a", kind: "audio", data: Buffer.from("M4A-BYTES"), headers: m4a });

  // doctest:L172
  const photo = await sendPhoto("JPEG-BYTES");
  const audio = await sendAudio();
  t.check([photo.statusCode, audio.statusCode], [
    200,
    200,
  ]);

  // Exact background-upload retries are idempotent. Reusing the same filename for
  // different bytes remains a conflict, as does a second M4A file in the segment:

  // doctest:L182
  const photoReplay = await sendPhoto("JPEG-BYTES");
  const audioReplay = await sendAudio();
  t.check([photoReplay.statusCode, audioReplay.statusCode], [
    200,
    200,
  ]);

  // doctest:L187
  const conflictingReplay = await sendPhoto("DIFFERENT");
  t.check(conflictingReplay.statusCode, 409);

  // doctest:L191
  const duplicate = await uploadRaw(ctx, {
    sessionId, filename: "ios-audio-b.m4a", kind: "audio", data: Buffer.from("SECOND"),
    headers: { "x-capture-segment-id": "native-segment", "x-capture-audio-format": "m4a-aac" },
  });
  t.check(duplicate.statusCode, 409);

  // The rejected body never lands on disk or in the manifest:

  // doctest:L202
  const manifest = await manifestOf(ctx, sessionId);
  t.check(
    ({
      photos: manifest.photos.map((item) => item.filename),
      audio: manifest.segments.map((segment) => ({ format: segment.format, chunks: segment.chunks })),
      totalBytes: manifest.totalBytes,
    }),
    {
    photos: [
      "ios-photo-a.jpg",
    ],
    audio: [
      {
        format: "m4a-aac",
        chunks: [
          "ios-audio-a.m4a",
        ],
      },
    ],
    totalBytes: 19,
  },
  );
});

// ## REST resume uses the paired device owner
//
// The user who created the pairing QR is persisted onto the device and becomes
// the same `createdBy` value used by cookie-authenticated web capture.
void test("The user who created the pairing QR is persisted onto the device and becomes...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L221
  const ctx = await makeTestServer();
  const auth = await pairedAuth(ctx, { createdBy: "owner@example.com", deviceLabel: "Owner's phone" });
  const created = await createSessionWithHeaders(ctx, { payload: { targetSessionId: "chat-owner" }, headers: auth });
  const sessionId = sessionIdOf(created);
  await uploadRaw(ctx, {
    sessionId, filename: "ios-photo-owner.jpg", kind: "photo", data: Buffer.from("OWNER"), headers: auth,
  });
  const resumed = await respond(ctx.request({
    method: "GET",
    url: `${SESSIONS}/resumable?targetSessionId=chat-owner&clientSessionId=${sessionId}`,
    headers: auth,
  }));
  t.check(({ status: resumed.statusCode, matches: resumed.body.resumable?.[0]?.id === sessionId }), {
    status: 200,
    matches: true,
  });

  // doctest:L236
  t.check((await manifestOf(ctx, sessionId)).createdBy, "owner@example.com");

  // A different paired identity cannot upload to, finalize, or cancel the owner's
  // session, and the session is left open and unchanged:

  // doctest:L244
  const otherAuth = await pairedAuth(ctx, { createdBy: "other@example.com", deviceLabel: "Other phone" });
  const forbiddenUpload = await uploadRaw(ctx, {
    sessionId, filename: "other.jpg", kind: "photo", data: Buffer.from("OTHER"), headers: otherAuth,
  });
  const forbiddenFinalize = await finalize(ctx, { sessionId, headers: otherAuth });
  const forbiddenCancel = await respond(ctx.request({ method: "DELETE", url: `${SESSIONS}/${sessionId}`, headers: otherAuth }));
  t.check([forbiddenUpload.statusCode, forbiddenFinalize.statusCode, forbiddenCancel.statusCode], [
    403,
    403,
    403,
  ]);

  // doctest:L253
  const stillOpen = await manifestOf(ctx, sessionId);
  t.check(({ state: stillOpen.state, photos: stillOpen.photos.map((item) => item.filename) }), {
    state: "open",
    photos: [
      "ios-photo-owner.jpg",
    ],
  });
});

// ## An ownerless legacy device must re-pair when auth is enabled
//
// Old device records decode with `createdBy: null`. They remain valid for ordinary
// mobile access, but cannot create captures in an authenticated box because all
// such devices would otherwise share the anonymous resume scope.
void test("Old device records decode with createdBy:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L269
  // "Auth enabled" is now the always-on default; makeTestServer opens the wall by
  // default, so construct with openAccess: false to exercise the authenticated path.
  const ctx = await makeTestServer({ openAccess: false });
  const ticket = createMobilePairingTicket(ctx.boxRoot);
  const paired = await redeemMobilePairingTicket(ctx.boxRoot, {
    pairingToken: ticket.token,
    deviceLabel: "Legacy phone",
  });
  if (!paired) throw new Error("pairing failed");
  const created = await createSessionWithHeaders(ctx, {
    payload: { targetSessionId: "chat-owner" },
    headers: { authorization: `Bearer ${paired.deviceToken}` },
  });
  t.check(({ status: created.statusCode, error: created.body.error }), {
    status: 403,
    error: "This paired device predates mobile identity. Re-pair it before using Capture.",
  });
});

// ## Finalize seals the session and returns staged
//
// Finalize returns immediately with `staged: true` (preparation runs in the
// background). An empty session — nothing uploaded — is discarded by the worker
// with no delivery:
void test("Finalize returns immediately with staged:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L294
  const ctx = await makeTestServer();
  const created = await createSession(ctx, { targetSessionId: null });
  const done = await finalize(ctx, { sessionId: sessionIdOf(created) });
  t.check([done.statusCode, done.body.staged, done.body.sessionId], [
    200,
    true,
    str`${uuid()}`,
  ]);
});

// ## Upload rejections: traversal, sealed, over the cap, unknown
//
// Each refusal has its own status and error. An upload whose filename escapes the
// session directory returns 400. Once a session is sealed (finalize fired) it is
// past the point of accepting media, so an upload returns 409, distinct from the
// 404 for a session that is gone (X3); we seal directly via the store to avoid
// racing the async worker. An upload that would push the session past
// `MAX_STAGED_BYTES` is rejected with 413 (X3); we seed the manifest's accumulated
// bytes to the cap so a single byte tips it over, without staging a real gigabyte.
void test("Each refusal has its own status and error.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L316
  const ctx = await makeTestServer();
  const photo = (sessionId: string, filename: string) =>
    upload(ctx, { sessionId, filename, data: Buffer.from("X"), headers: { "x-capture-kind": "photo" } });
  const fresh = async () => sessionIdOf(await createSession(ctx, { targetSessionId: null }));

  // doctest:L321
  const traversalId = await fresh();
  const traversal = await upload(ctx, {
    sessionId: traversalId, filename: "../../evil.webm", data: Buffer.from("PWN"),
    headers: { "x-capture-kind": "audio", "x-capture-segment-id": "seg-a" },
  });
  t.check([traversal.statusCode, traversal.body.error], [
    400,
    "Invalid filename",
  ]);

  // doctest:L329
  const sealedId = await fresh();
  await setStagingState({ boxRoot: ctx.boxRoot, id: sealedId, state: "sealed" });
  const sealed = await photo(sealedId, "photo-001.jpg");
  t.check([sealed.statusCode, sealed.body.error], [
    409,
    "Session is sealed; uploads are only accepted while it is open",
  ]);

  // doctest:L335
  const fullId = await fresh();
  const session = await manifestOf(ctx, fullId);
  session.totalBytes = MAX_STAGED_BYTES;
  await writeStagingSession({ boxRoot: ctx.boxRoot, session });
  const over = await photo(fullId, "photo-001.jpg");
  t.check([over.statusCode, over.body.error], [
    413,
    "Capture exceeds the staging byte limit",
  ]);

  // doctest:L343
  t.check((await photo("no-such-session", "photo-001.jpg")).statusCode, 404);
});

// ## Discard is guarded: the client may only delete what is still its own
//
// `DELETE` is both the overlay's cancel and the chat chip's discard. It used to
// tear the session directory down unconditionally, which meant it could delete a
// capture the background worker was in the middle of preparing — the worker then
// reads `null` and silently returns, so the client reports success and no message
// ever arrives. It now goes through `discardStagingSessionIfCancellable`, which
// takes the per-session lock and re-checks the state inside it.
//
// An `open` session — the uploader's own cancel — is still the client's to delete:
void test("DELETE is both the overlay's cancel and the chat chip's discard.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L363
  const ctx = await makeTestServer();
  const withPhoto = async (filename: string) => {
    const created = await createSession(ctx, { targetSessionId: "chat-discard" });
    await uploadRaw(ctx, { sessionId: sessionIdOf(created), filename, kind: "photo", data: Buffer.from("PHOTO") });
    return sessionIdOf(created);
  };
  const discard = (id: string) => respond(ctx.request({ method: "DELETE", url: `${SESSIONS}/${id}` }));
  const gone = (id: string) => readStagingSession({ boxRoot: ctx.boxRoot, id });

  // doctest:L372
  const sessionId = await withPhoto("shot.jpg");
  const cancelled = await discard(sessionId);
  t.check([cancelled.statusCode, await gone(sessionId)], [
    200,
    null,
  ]);

  // A session the worker owns is refused, and survives:

  // doctest:L381
  const busyId = await withPhoto("busy.jpg");
  await setStagingState({ boxRoot: ctx.boxRoot, id: busyId, state: "preparing" });
  const refused = await discard(busyId);
  t.check([refused.statusCode, refused.body.error], [
    409,
    "Capture is already preparing and can no longer be discarded",
  ]);

  // doctest:L387
  t.check((await gone(busyId))?.state, "preparing");

  // A dead `failed:*` session is discardable — this is the verb the chat chip
  // needed, and the one the boxholder had no way to reach for sixteen days:

  // doctest:L395
  await setStagingState({ boxRoot: ctx.boxRoot, id: busyId, state: "failed:prepare" });
  const discarded = await discard(busyId);
  t.check([discarded.statusCode, await gone(busyId)], [
    200,
    null,
  ]);

  // Discarding one that is already gone is a 404, as it was before: there is no
  // session to authorize the caller against.

  // doctest:L405
  t.check((await discard(busyId)).statusCode, 404);
});

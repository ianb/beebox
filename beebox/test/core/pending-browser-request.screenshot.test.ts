// # Agent-initiated screenshot rendezvous
//
// Tests for `bbx chat screenshot`'s server side: the two HTTP routes that
// connect the CLI long-poll to the browser tab holding the session. The
// registry behind them is covered by `pending-browser-request.doctest.md`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isoDate } from "@ianbicking/tap-check/check";
import { getOrCreateAgentToken } from "../../src/core/agent/token.js";
import { makeTestServer, type TestServer } from "../helpers/test-route-server.js";

// An 8-byte PNG signature plus a trailing byte — enough to pass the route's
// magic-byte check.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

// A syntactically-valid (but not pending) request id — the answer route rejects
// a non-UUID param before any lookup, so answer-route tests use a real UUID.
const VALID_ID = "00000000-0000-0000-0000-000000000000";

// The request route is loopback-only: it requires the per-box agent bearer.
// getOrCreateAgentToken mints/reads the same token file verifyAgentBearer checks.
function agentAuth(ctx: TestServer) {
  return { authorization: `Bearer ${getOrCreateAgentToken(ctx.boxRoot)}` };
}

// The browser learns which id to answer from the transient `screenshot-request`
// bus event (no id is caller-supplied). Subscribe BEFORE starting the long-poll,
// then await the emitted id — this is the real server-generated-id path.
function captureRequestId(ctx: TestServer) {
  return new Promise<string>((resolve) => {
    ctx.eventBus.subscribe({
      listener: (e) => {
        if (e.event === "screenshot-request") resolve(e.data.requestId);
      },
    });
  });
}

// Build a multipart body with an optional file + text fields. Returns a Buffer
// so binary PNG bytes survive intact.
function multipart(opts: { boundary: string; file?: Buffer; fields?: Record<string, string> }): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(opts.fields ?? {})) {
    parts.push(Buffer.from(`--${opts.boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (opts.file !== undefined) {
    parts.push(Buffer.from(`--${opts.boundary}\r\nContent-Disposition: form-data; name="file"; filename="shot.png"\r\nContent-Type: image/png\r\n\r\n`));
    parts.push(opts.file);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${opts.boundary}--\r\n`));
  return Buffer.concat(parts);
}

// ## Route: answering an unknown/settled request returns 404
//
// Also the normal multi-tab outcome — a second tab answering after the first
// already won, or a tab answering a request the CLI already abandoned.
void test("Also the normal multi-tab outcome — a second tab answering after the first al...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: `/api/chat/screenshot/${VALID_ID}`,
    payload: { declined: true },
  });
  t.check({ status: res.statusCode, body: res.body }, { status: 404, body: { error: "unknown-request" } });
});

// ## Route: a malformed request id is rejected before any lookup
//
// A live pending id is always a server-minted UUID, so a param that isn't one
// (here a path-traversal attempt) is a 400 at the boundary — it never reaches the
// registry or the filesystem.
void test("A live pending id is always a server-minted UUID, so a param that isn't one (...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/screenshot/..%2F..%2Ftarget",
    payload: { declined: true },
  });
  t.check({ status: res.statusCode, body: res.body }, { status: 400, body: { error: "bad-request-id" } });
});

// ## Route: a non-PNG multipart upload is rejected at the boundary
void test("Route: a non-PNG multipart upload is rejected at the boundary", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const boundary = "----cbshot";
  const body = multipart({ boundary, file: Buffer.from("not a png"), fields: { fidelity: "displaymedia" } });
  const res = await ctx.request({
    method: "POST",
    url: `/api/chat/screenshot/${VALID_ID}`,
    payload: body,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  t.check({ status: res.statusCode, body: res.body }, { status: 400, body: { error: "not-png", message: "Upload is not a PNG" } });
});

// ## Route: an oversized PNG is rejected at the boundary
//
// A valid PNG signature followed by >25 MB of bytes trips the size cap (checked
// after the magic bytes, so the error is `too-large`, not `not-png`).
void test("A valid PNG signature followed by >25 MB of bytes trips the size cap (checked...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const boundary = "----cbbig";
  const oversized = Buffer.concat([PNG, Buffer.alloc(26 * 1024 * 1024)]);
  const body = multipart({ boundary, file: oversized, fields: { fidelity: "extension" } });
  const res = await ctx.request({
    method: "POST",
    url: `/api/chat/screenshot/${VALID_ID}`,
    payload: body,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  t.check({ status: res.statusCode, body: res.body }, { status: 400, body: { error: "too-large", message: "Image exceeds the size cap" } });
});

// ## Route: a plain user session (no agent bearer) is rejected 403
//
// The request route is agent-initiated. Without the loopback bearer — what an
// ordinary browser session would present — it is forbidden, so no user can start
// a screenshot request.
void test("The request route is agent-initiated.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/screenshot/request",
    payload: { session: "s1", timeoutMs: 3000 },
  });
  t.check({ status: res.statusCode, body: res.body }, { status: 403, body: { error: "forbidden", message: "Screenshot requests are agent-initiated (loopback bearer required)" } });
});

// ## Route: a request nobody acks returns 504 no-client
//
// No tab acks within the 2s ack window, so the request resolves `no-client`
// (distinct from `timeout`). `timeoutMs` is clamped to a 3s floor kept above the
// ack window.
void test("No tab acks within the 2s ack window, so the request resolves no-client (dist...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const res = await ctx.request({
    method: "POST",
    url: "/api/chat/screenshot/request",
    payload: { session: "s1", timeoutMs: 3000 },
    headers: agentAuth(ctx),
  });
  t.check({ status: res.statusCode, body: res.body }, { status: 504, body: { error: "no-client" } });
});

// ## Route: acked-then-silent returns 504 timeout
//
// The "browser" learns the server-minted id from the `screenshot-request` bus
// event, then acks via `{ack: true}`. The ack cancels the `no-client` window; with
// no image the overall 3s timeout then fires as `timeout` — distinct from
// `no-client`.
void test("The \"browser\" learns the server-minted id from the screenshot-request bus eve...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const gotId = captureRequestId(ctx);
  const longPoll = ctx.request({
    method: "POST",
    url: "/api/chat/screenshot/request",
    payload: { session: "s1", timeoutMs: 3000 },
    headers: agentAuth(ctx),
  });
  const requestId = await gotId;
  const ackRes = await ctx.request({
    method: "POST",
    url: `/api/chat/screenshot/${requestId}`,
    payload: { ack: true },
  });
  const res = await longPoll;
  t.check(
    { ack: ackRes.body, status: res.statusCode, body: res.body },
    { ack: { ok: true }, status: 504, body: { error: "timeout" } },
  );
});

// ## Route: a decline answer returns 409
void test("Route: a decline answer returns 409", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const gotId = captureRequestId(ctx);
  const longPoll = ctx.request({
    method: "POST",
    url: "/api/chat/screenshot/request",
    payload: { session: "s1", timeoutMs: 8000 },
    headers: agentAuth(ctx),
  });
  const requestId = await gotId;
  const answer = await ctx.request({
    method: "POST",
    url: `/api/chat/screenshot/${requestId}`,
    payload: { declined: true },
  });
  const res = await longPoll;
  t.check(
    { answer: answer.body, status: res.statusCode, body: res.body },
    { answer: { ok: true }, status: 409, body: { error: "declined" } },
  );
});

// ## Route: full loop — long-poll answered by a multipart PNG upload
//
// The long-poll is started; the "browser" reads the server-minted id off the bus
// and answers with a PNG plus `viewport`/`fidelity` fields; the route writes the
// image under `_tmp/screenshot-<requestId>.png` and returns its absolute path with
// the metadata. The saved bytes match what was uploaded.
void test("The long-poll is started; the \"browser\" reads the server-minted id off the bu...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  const gotId = captureRequestId(ctx);
  const longPoll = ctx.request({
    method: "POST",
    url: "/api/chat/screenshot/request",
    payload: { session: "s1", timeoutMs: 8000 },
    headers: agentAuth(ctx),
  });
  const requestId = await gotId;
  const boundary = "----cbshotloop";
  const body = multipart({
    boundary,
    file: PNG,
    fields: { fidelity: "extension", viewport: JSON.stringify({ cssWidth: 1440, cssHeight: 900, dpr: 2 }) },
  });
  const answer = await ctx.request({
    method: "POST",
    url: `/api/chat/screenshot/${requestId}`,
    payload: body,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  const res = await longPoll;
  t.check(
    { answer: answer.body, status: res.statusCode, body: res.body },
    {
      answer: { ok: true },
      status: 200,
      body: {
        path: `${ctx.boxRoot}/_tmp/screenshot-${requestId}.png`,
        fidelity: "extension",
        capturedAt: isoDate(),
        viewport: { cssWidth: 1440, cssHeight: 900, dpr: 2 },
      },
    },
  );
  // The 200 is sent only after the PNG is written; the file therefore exists.
  t.check(await ctx.read(`_tmp/screenshot-${requestId}.png`), PNG.toString("utf-8"));
});

// ## Route: a genuine client abort cancels the pending entry
//
// The plan's abort semantics, exercised over a REAL listening socket (Fastify's
// `inject` can't model a mid-flight client disconnect). A real `fetch` starts the
// long-poll, is aborted after the request has parked, and the server's
// disconnect-detection cancels the entry — so a late browser answer to that id
// settles nothing (404). A normal completed long-poll is never hijacked (the
// `writableFinished` gate above), which the other full-loop cases confirm.
void test("The plan's abort semantics, exercised over a REAL listening socket (Fastify's...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const ctx = await makeTestServer();
  await ctx.server.listen({ port: 0, host: "127.0.0.1" });
  const addr = ctx.server.server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const token = getOrCreateAgentToken(ctx.boxRoot);

  const gotId = captureRequestId(ctx);
  const controller = new AbortController();
  const poll = fetch(`http://127.0.0.1:${port}/test/api/chat/screenshot/request`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ session: "s1", timeoutMs: 30000 }),
    signal: controller.signal,
  }).then(() => "resolved", (e) => (e instanceof Error ? e.name : String(e)));

  // Wait until the request has parked (its id is on the bus), then sever the
  // client connection mid-poll.
  const requestId = await gotId;
  controller.abort();
  const pollOutcome = await poll;

  // Give the server a moment to observe the socket close and cancel the entry.
  await new Promise((resolve) => setTimeout(resolve, 250));

  // A late answer to the now-cancelled request settles nothing → 404.
  const late = await ctx.request({
    method: "POST",
    url: `/api/chat/screenshot/${requestId}`,
    payload: { declined: true },
  });
  t.check(
    { pollOutcome, lateStatus: late.statusCode, lateBody: late.body },
    { pollOutcome: "AbortError", lateStatus: 404, lateBody: { error: "unknown-request" } },
  );
});

// </content>

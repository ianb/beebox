// # Bulk-upload routes
//
// The bulk routes stage a batch of files into the box: create binds a required
// target chat, uploads stream one registered item at a time (hash + byte-count
// computed server-side as the body streams), and a status/resume endpoint lists
// registered vs received items. Finalize returns immediately after sealing; the
// full prepare→deliver worker (retry, at-most-once, reconciliation) is covered in
// `test/core/bulk-upload/worker.doctest.md`.

import { test } from "tap";
import "agent-doctest/tap";
import { createHash } from "node:crypto";
import { z } from "zod";
import { makeTestServer, type TestServer } from "../../helpers/test-route-server.js";
import { StagingSessionSchema, type StagingSession } from "../../../src/core/capture/staging-schema.js";
import { readStagingSession, writeStagingSession, sealStagingSession, setStagingState } from "../../../src/core/capture/staging-store/core.js";
import { MAX_STAGED_BYTES } from "../../../src/core/capture/staging-limits.js";
import { appendHistory, getDirectoryForSession } from "../../../src/core/chat/session/history.js";

// Bind a session→dir in history. The server fires a one-shot history backfill at
// boot that can clobber a single append; re-append until it sticks (the backfill
// writes `migrated: true` once, after which the binding is durable).
// Response bodies of the bulk routes; every field is optional because success
// and error responses carry different keys.
const BulkBody = z.looseObject({
  sessionId: z.string().optional(),
  error: z.string().optional(),
  success: z.boolean().optional(),
  staged: z.boolean().optional(),
  registered: z.unknown().optional(),
  capabilities: z.looseObject({ acceptedUploadEncodings: z.unknown() }).optional(),
  state: z.unknown().optional(),
  size: z.unknown().optional(),
  sha256: z.unknown().optional(),
  itemId: z.unknown().optional(),
});

// The status/resume response: registered vs received items.
const StatusBody = z.object({
  state: z.unknown(),
  registered: z.array(z.looseObject({ id: z.string() })),
  received: z.array(z.looseObject({ itemId: z.string(), size: z.number() })),
});

async function send(ctx: TestServer, opts: Parameters<TestServer["request"]>[0]) {
  const res = await ctx.request(opts);
  return { statusCode: res.statusCode, body: BulkBody.parse(res.body) };
}

// The id of a created session; fails the test when the response carried none.
function sessionIdOf(res: { body: { sessionId?: string | undefined } }): string {
  if (res.body.sessionId === undefined) throw new Error("response carried no sessionId");
  return res.body.sessionId;
}

async function manifestOf(ctx: TestServer, id: string) {
  return StagingSessionSchema.parse(JSON.parse(await ctx.read(`_tmp/capture-staging/${id}/session.json`)));
}

async function bindSession({ ctx, sessionId, contextDir }: { ctx: TestServer; sessionId: string; contextDir: string }) {
  for (let i = 0; i < 100; i++) {
    await appendHistory(ctx.boxRoot, { sessionId, contextDir });
    if ((await getDirectoryForSession(ctx.boxRoot, sessionId)) === contextDir) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`could not bind ${sessionId} in history`);
}

function sha256(text: string) {
  return createHash("sha256").update(Buffer.from(text)).digest("hex");
}

async function createBatch(ctx: TestServer, body: object) {
  return send(ctx, { method: "POST", url: "/api/bulk/sessions", payload: body });
}

async function uploadItem(ctx: TestServer, opts: {
  sessionId: string; itemId: string; filename: string; data: Buffer; originalName?: string; headers?: Record<string, string>;
}) {
  return send(ctx, {
    method: "POST",
    url: `/api/bulk/sessions/${opts.sessionId}/items/${opts.itemId}/upload`,
    payload: opts.data,
    headers: {
      "content-type": "application/octet-stream",
      "x-upload-filename": opts.filename,
      ...(opts.originalName ? { "x-upload-original-name": opts.originalName } : {}),
      ...opts.headers,
    },
  });
}

// Finalize starts the prepare→deliver worker detached from the request, so it
// outlives the response. Every test that finalizes waits here for the worker to
// stop before cleanup deletes the box: a worker still running `git add` (through
// git-annex) when the box directory vanishes hangs forever, and the file then
// dies at tap's whole-file timeout instead of failing an assertion. Bounded, and
// the error names the state the worker stalled in.
async function waitForWorkerToSettle(ctx: TestServer, sessionId: string) {
  let session: StagingSession | null = null;
  for (let i = 0; i < 600; i++) {
    session = await readStagingSession({ boxRoot: ctx.boxRoot, id: sessionId });
    if (session === null || session.state === "delivered" || session.state.startsWith("failed:")) return session?.state ?? "gone";
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`bulk worker for ${sessionId} did not settle within 30s; last state was ${String(session?.state)}`);
}

// ## Create requires a target chat, then registers the initial item set
//
// A create with no `targetSessionId` is rejected loudly (400) — a bulk batch with
// no chat to deliver into is invalid at creation:
void test("A create with no targetSessionId is rejected loudly (400) — a bulk batch with...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L115
  const ctx = await makeTestServer();
  const noTarget = await createBatch(ctx, { items: [] });
  t.check({ status: noTarget.statusCode, error: noTarget.body.error }, {
    status: 400,
    error: "A bulk upload requires a target chat session id",
  });

  // With a target chat + an initial registry, create returns the new session id and
  // its upload capabilities. The batch's context dir is NOT taken from the request —
  // it's derived server-side from the target chat's recorded binding:

  // doctest:L126
  await bindSession({ ctx, sessionId: "chat-abc", contextDir: "_content/photos" });
  const created = await createBatch(ctx, {
    targetSessionId: "chat-abc",
    items: [
      { id: "a", name: "report.pdf", size: 6, mimetype: "application/pdf" },
      { id: "b", name: "photo.png", size: 5, mimetype: "image/png" },
    ],
  });
  const sessionId = sessionIdOf(created);
  t.check(
    {
      status: created.statusCode,
      hasId: typeof sessionId === "string",
      caps: created.body.capabilities?.acceptedUploadEncodings,
    },
    {
    status: 200,
    hasId: true,
    caps: [
      "raw-body-v1",
    ],
  },
  );

  // The staging manifest is a `kind: "bulk"` session carrying the registry + the
  // server-derived target context dir:

  // doctest:L147
  const manifest = await manifestOf(ctx, sessionId);
  t.check(
    {
      kind: manifest.kind,
      target: manifest.targetSessionId,
      contextDir: manifest.contextDir,
      registered: manifest.expectedItems?.map((i) => i.id),
    },
    {
    kind: "bulk",
    target: "chat-abc",
    contextDir: "_content/photos",
    registered: [
      "a",
      "b",
    ],
  },
  );

  // A client-supplied `contextDir` in the body is ignored (path-traversal defense):
  // a target with no recorded binding lands at the box root regardless of what the
  // body claims:

  // doctest:L162
  const sneaky = await createBatch(ctx, {
    targetSessionId: "chat-unbound",
    contextDir: "../../../etc",
    items: [{ id: "a", name: "x.pdf" }],
  });
  const sneakyManifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${sessionIdOf(sneaky)}/session.json`));
  t.check({ status: sneaky.statusCode, contextDir: sneakyManifest.contextDir }, {
    status: 200,
    contextDir: "",
  });
});

// ## Duplicate item ids are rejected at creation and registration (400)
//
// The registry is keyed by id, so a duplicate id in one request — or a new id
// colliding with one already registered — is refused (an update-in-place would
// silently overwrite the earlier item's claims):
void test("The registry is keyed by id, so a duplicate id in one request — or a new id c...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L183
  const ctx = await makeTestServer();
  const dupeCreate = await createBatch(ctx, {
    targetSessionId: "chat-1",
    items: [{ id: "a", name: "x.pdf" }, { id: "a", name: "y.pdf" }],
  });
  t.check({ status: dupeCreate.statusCode, error: dupeCreate.body.error }, {
    status: 400,
    error: "Duplicate item id in registry: a",
  });

  // doctest:L193
  const created = await createBatch(ctx, { targetSessionId: "chat-1", items: [{ id: "a", name: "x.pdf" }] });
  const collide = await send(ctx, {
    method: "POST", url: `/api/bulk/sessions/${sessionIdOf(created)}/items`,
    payload: { items: [{ id: "a", name: "again.pdf" }, { id: "a", name: "again2.pdf" }] },
  });
  t.check({ status: collide.statusCode, error: collide.body.error }, {
    status: 400,
    error: "Duplicate item id in registry: a",
  });

  // Re-registering an EXISTING id (idempotent append while the picker streams) is
  // still fine:

  // doctest:L206
  const reAdd = await send(ctx, {
    method: "POST", url: `/api/bulk/sessions/${sessionIdOf(created)}/items`,
    payload: { items: [{ id: "a", name: "x.pdf" }] },
  });
  t.check({ status: reAdd.statusCode, registered: reAdd.body.registered }, {
    status: 200,
    registered: 1,
  });
});

// ## Streaming an upload records a server-computed size + sha256
//
// The bytes stream to disk; the manifest entry carries the server-computed size
// and sha256 (never a client-claimed size), and the response echoes them:
void test("The bytes stream to disk; the manifest entry carries the server-computed size...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L224
  const ctx = await makeTestServer();
  const created = await createBatch(ctx, {
    targetSessionId: "chat-1",
    items: [{ id: "a", name: "report.pdf" }],
  });
  const sessionId = sessionIdOf(created);

  // doctest:L231
  const res = await uploadItem(ctx, {
    sessionId, itemId: "a", filename: "staged-a.bin", originalName: "report.pdf",
    data: Buffer.from("PDFPDF"),
  });
  t.check(
    {
      status: res.statusCode,
      size: res.body.size,
      hashMatches: res.body.sha256 === sha256("PDFPDF"),
      itemId: res.body.itemId,
    },
    {
    status: 200,
    size: 6,
    hashMatches: true,
    itemId: "a",
  },
  );

  // The staged file entry on the manifest carries the same server-computed values
  // and links back to the registry item, and `totalBytes` accumulates:

  // doctest:L248
  const manifest = await manifestOf(ctx, sessionId);
  t.check(
    {
      file: manifest.files.map((f) => ({ name: f.originalName, itemId: f.itemId, size: f.size, hashLen: f.sha256?.length })),
      totalBytes: manifest.totalBytes,
    },
    {
    file: [
      {
        name: "report.pdf",
        itemId: "a",
        size: 6,
        hashLen: 64,
      },
    ],
    totalBytes: 6,
  },
  );

  // An exact retry (same filename + bytes) is idempotent; the same filename with
  // different bytes is a 409 conflict:

  // doctest:L260
  const replay = await uploadItem(ctx, {
    sessionId, itemId: "a", filename: "staged-a.bin", data: Buffer.from("PDFPDF"),
  });
  const conflict = await uploadItem(ctx, {
    sessionId, itemId: "a", filename: "staged-a.bin", data: Buffer.from("DIFFERENT"),
  });
  t.check({ replay: replay.statusCode, conflict: conflict.statusCode }, {
    replay: 200,
    conflict: 409,
  });
});

// ## An upload naming an unregistered item is rejected (400)
//
// The item registry is the record of what was supposed to arrive, so an upload
// whose `itemId` was never registered is refused before any bytes are staged:
void test("The item registry is the record of what was supposed to arrive, so an upload...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L280
  const ctx = await makeTestServer();
  const created = await createBatch(ctx, { targetSessionId: "chat-1", items: [{ id: "a", name: "x.pdf" }] });
  const sessionId = sessionIdOf(created);

  // doctest:L284
  const res = await uploadItem(ctx, {
    sessionId, itemId: "ghost", filename: "staged.bin", data: Buffer.from("X"),
  });
  t.check({ status: res.statusCode, error: res.body.error }, {
    status: 400,
    error: "No registered item ghost in this bulk batch",
  });

  // Registering it afterward (append while the picker streams) lets the upload land:

  // doctest:L294
  const reg = await send(ctx, {
    method: "POST", url: `/api/bulk/sessions/${sessionId}/items`,
    payload: { items: [{ id: "ghost", name: "ghost.pdf" }] },
  });
  const ok = await uploadItem(ctx, { sessionId, itemId: "ghost", filename: "staged.bin", data: Buffer.from("X") });
  t.check({ registered: reg.body.registered, upload: ok.statusCode }, {
    registered: 2,
    upload: 200,
  });
});

// ## Reserved control-file names are rejected (400)
//
// The staging filename (`X-Upload-Filename`) can't claim the session's own control
// files: `session.json` (the manifest — overwriting it would silently substitute
// content), a `session.json.`-prefixed sibling, `.gitignore`, or any dot-leading
// hidden name is refused before any bytes land.
void test("The staging filename (X-Upload-Filename) can't claim the session's own contro...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L315
  const ctx = await makeTestServer();
  const created = await createBatch(ctx, { targetSessionId: "chat-1", items: [{ id: "a", name: "x.pdf" }] });
  const sessionId = sessionIdOf(created);

  // doctest:L319
  const names = ["session.json", "session.json.corrupt", ".gitignore", ".hidden"];
  const codes = [];
  for (const name of names) codes.push((await uploadItem(ctx, { sessionId, itemId: "a", filename: name, data: Buffer.from("X") })).statusCode);
  t.check(codes, [
    400,
    400,
    400,
    400,
  ]);

  // The manifest is untouched — the upload never overwrote it:

  // doctest:L329
  const manifest = await manifestOf(ctx, sessionId);
  t.check({ kind: manifest.kind, files: manifest.files.length }, {
    kind: "bulk",
    files: 0,
  });
});

// ## Exceeding the per-session byte cap returns 413
//
// Seeding the accumulated bytes to the cap makes a single-byte upload tip it over,
// mapped to 413 (the same staging cap capture enforces):
void test("Seeding the accumulated bytes to the cap makes a single-byte upload tip it ov...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L344
  const ctx = await makeTestServer();
  const created = await createBatch(ctx, { targetSessionId: "chat-1", items: [{ id: "a", name: "big.bin" }] });
  const sessionId = sessionIdOf(created);
  const session = await manifestOf(ctx, sessionId);
  session.totalBytes = MAX_STAGED_BYTES;
  await writeStagingSession({ boxRoot: ctx.boxRoot, session });

  // doctest:L351
  const res = await uploadItem(ctx, { sessionId, itemId: "a", filename: "big.bin", data: Buffer.from("X") });
  t.check(res.statusCode, 413);

  // doctest:L357
  t.check(res.body.error, "Capture exceeds the staging byte limit");
});

// ## Status/resume lists registered vs received items
//
// After a partial upload, the status endpoint reports what was registered and what
// actually arrived — enough for a client to resume the missing items:
void test("After a partial upload, the status endpoint reports what was registered and w...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L371
  const ctx = await makeTestServer();
  const created = await createBatch(ctx, {
    targetSessionId: "chat-1",
    items: [{ id: "a", name: "a.pdf" }, { id: "b", name: "b.pdf" }],
  });
  const sessionId = sessionIdOf(created);
  await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-a.bin", originalName: "a.pdf", data: Buffer.from("AAAA") });

  // doctest:L379
  const status = { body: StatusBody.parse((await ctx.request({ method: "GET", url: `/api/bulk/sessions/${sessionId}` })).body) };
  t.check(
    {
      state: status.body.state,
      registered: status.body.registered.map((i) => i.id),
      received: status.body.received.map((r) => ({ itemId: r.itemId, size: r.size })),
    },
    {
    state: "open",
    registered: [
      "a",
      "b",
    ],
    received: [
      {
        itemId: "a",
        size: 4,
      },
    ],
  },
  );
});

// ## Uploading to an unknown session returns 404
void test("Uploading to an unknown session returns 404", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L395
  const ctx = await makeTestServer();
  const res = await uploadItem(ctx, { sessionId: "no-such", itemId: "a", filename: "x.bin", data: Buffer.from("X") });
  t.check(res.statusCode, 404);
});

// ## Finalize seals the session and returns staged
//
// Finalize returns immediately with `staged: true` (the prepare→deliver worker
// runs in the background) and CAS-seals the session so it stops accepting uploads:
void test("Finalize returns immediately with staged:", async (t) => {
  t.teardown(async () => {
    try {
      await waitForWorkerToSettle(ctx, sessionId);
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L411
  const ctx = await makeTestServer();
  const created = await createBatch(ctx, { targetSessionId: "chat-1", items: [{ id: "a", name: "a.pdf" }] });
  const sessionId = sessionIdOf(created);
  await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-a.bin", originalName: "a.pdf", data: Buffer.from("AAAA") });

  // doctest:L416
  const done = await send(ctx, {
    method: "POST", url: `/api/bulk/sessions/${sessionId}/finalize`,
    payload: { failedItems: [] },
  });
  t.check({ status: done.statusCode, staged: done.body.staged, sessionId: done.body.sessionId === sessionId }, {
    status: 200,
    staged: true,
    sessionId: true,
  });

  // The seal happens before the response, not later in the worker: read first
  // thing after the response, the batch is already out of `open`. The worker may
  // have moved it on to any later state, so the check is only that it is not open.

  // doctest:L429
  await t.checkText((await readStagingSession({ boxRoot: ctx.boxRoot, id: sessionId }))?.state !== "open", "true");

  // A further upload after finalize is refused — the session is no longer open:

  // doctest:L436
  const late = await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-late.bin", data: Buffer.from("X") });
  t.check(late.statusCode, 409);
});

// ## Finalize records the batch's introduction inside the seal
//
// The composer text the boxholder submitted the batch with rides IN the CAS seal,
// so a resume rebuilds the same batch with the same introduction — there is no
// window in which a sealed batch exists without its note.
void test("The composer text the boxholder submitted the batch with rides IN the CAS sea...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L453
  const ctx = await makeTestServer();
  const created = await createBatch(ctx, { targetSessionId: "chat-note", items: [{ id: "a", name: "a.jpg" }] });
  const sessionId = sessionIdOf(created);
  await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-a.bin", originalName: "a.jpg", data: Buffer.from("AAAA") });

  // doctest:L458
  const done = await send(ctx, {
    method: "POST", url: `/api/bulk/sessions/${sessionId}/finalize`,
    payload: { note: "Receipts from the Tokyo trip" },
  });
  // The worker runs to its end before the read, so the read cannot race it.
  // "chat-note" has no recorded binding, so the worker leaves the batch retryable
  // as `failed:deliver` — and the note is still there for the resume to use.
  const settled = await waitForWorkerToSettle(ctx, sessionId);
  const sealed = await manifestOf(ctx, sessionId);
  t.check({ status: done.statusCode, state: settled, note: sealed.note }, {
    status: 200,
    state: "failed:deliver",
    note: "Receipts from the Tokyo trip",
  });
});

// ## A whitespace-only note is recorded as no note at all
//
// An empty composer must produce a batch indistinguishable from one that never
// carried an introduction — that is what keeps the `<upload>` message byte-identical
// to its pre-note form.
void test("An empty composer must produce a batch indistinguishable from one that never...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L482
  const ctx = await makeTestServer();
  const created = await createBatch(ctx, { targetSessionId: "chat-blank", items: [{ id: "a", name: "a.jpg" }] });
  const sessionId = sessionIdOf(created);
  await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-a.bin", originalName: "a.jpg", data: Buffer.from("AAAA") });

  // doctest:L487
  await send(ctx, {
    method: "POST", url: `/api/bulk/sessions/${sessionId}/finalize`,
    payload: { note: "   \n\t " },
  });
  await waitForWorkerToSettle(ctx, sessionId);
  const sealed = await manifestOf(ctx, sessionId);
  t.check({ note: sealed.note ?? null }, {
    note: null,
  });
});

// ## An oversized note is rejected at the boundary
//
// The note is untrusted client prose, so it is length-capped where it enters
// rather than trusted downstream.
void test("The note is untrusted client prose, so it is length-capped where it enters ra...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L507
  const ctx = await makeTestServer();
  const created = await createBatch(ctx, { targetSessionId: "chat-big", items: [{ id: "a", name: "a.jpg" }] });
  const sessionId = sessionIdOf(created);

  // doctest:L511
  const tooBig = await send(ctx, {
    method: "POST", url: `/api/bulk/sessions/${sessionId}/finalize`,
    payload: { note: "x".repeat(10_001) },
  });
  const stillOpen = await manifestOf(ctx, sessionId);
  t.check({ status: tooBig.statusCode, state: stillOpen.state }, {
    status: 400,
    state: "open",
  });
});

// ## A sealed batch cannot be cancelled out from under its worker
//
// Cancel is the uploader's affordance for a batch it still owns. Once finalize
// seals one, the background worker owns it — deleting the staging directory then
// makes the worker read `null` and quietly return, so no `<upload>` message ever
// arrives while the client, which already saw finalize succeed, reports success.
// That is the "client says done, server shows nothing" failure this feature exists
// to remove, so a post-seal cancel is refused rather than raced.
//
// The batch is sealed and stepped through the worker's states in the store,
// without the finalize route, so no live worker races the DELETE: a real one can
// finish (staging gone, 404) or fail (`failed:*`, cancellable, 200) before the
// request lands. Every state the worker holds the batch in refuses the cancel:
void test("Cancel is the uploader's affordance for a batch it still owns.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L539
  const ctx = await makeTestServer();
  const created = await createBatch(ctx, { targetSessionId: "chat-cancel", items: [{ id: "a", name: "a.jpg" }] });
  const sessionId = sessionIdOf(created);
  await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-a.bin", originalName: "a.jpg", data: Buffer.from("AAAA") });
  await sealStagingSession({ boxRoot: ctx.boxRoot, id: sessionId });

  // doctest:L545
  const codes: Record<string, number> = {};
  for (const state of ["sealed", "preparing", "delivering"] as const) {
    await setStagingState({ boxRoot: ctx.boxRoot, id: sessionId, state });
    codes[state] = (await send(ctx, { method: "DELETE", url: `/api/bulk/sessions/${sessionId}` })).statusCode;
  }
  t.check(codes, {
    sealed: 409,
    preparing: 409,
    delivering: 409,
  });

  // An open batch still cancels normally:

  // doctest:L557
  const open = await createBatch(ctx, { targetSessionId: "chat-cancel", items: [{ id: "b", name: "b.jpg" }] });
  const cancelled = await send(ctx, { method: "DELETE", url: `/api/bulk/sessions/${sessionIdOf(open)}` });
  t.check({ status: cancelled.statusCode, success: cancelled.body.success }, {
    status: 200,
    success: true,
  });
});

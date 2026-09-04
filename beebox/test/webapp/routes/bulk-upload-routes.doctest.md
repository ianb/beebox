# Bulk-upload routes

The bulk routes stage a batch of files into the box: create binds a required
target chat, uploads stream one registered item at a time (hash + byte-count
computed server-side as the body streams), and a status/resume endpoint lists
registered vs received items. Finalize returns immediately after sealing; the
full prepare→deliver worker (retry, at-most-once, reconciliation) is covered in
`test/core/bulk-upload/worker.doctest.md`.

```ts setup
import { createHash } from "node:crypto";
import { makeTestServer } from "../../helpers/doctest-server.js";
import { readStagingSession, writeStagingSession } from "../../../src/core/capture/staging-store.js";
import { MAX_STAGED_BYTES } from "../../../src/core/capture/staging-limits.js";
import { appendHistory, getDirectoryForSession } from "../../../src/core/chat/session/history.js";

// Bind a session→dir in history. The server fires a one-shot history backfill at
// boot that can clobber a single append; re-append until it sticks (the backfill
// writes `migrated: true` once, after which the binding is durable).
async function bindSession(ctx, sessionId, contextDir) {
  for (let i = 0; i < 100; i++) {
    await appendHistory(ctx.boxRoot, { sessionId, contextDir });
    if ((await getDirectoryForSession(ctx.boxRoot, sessionId)) === contextDir) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`could not bind ${sessionId} in history`);
}

function sha256(text) {
  return createHash("sha256").update(Buffer.from(text)).digest("hex");
}

async function createBatch(ctx, body) {
  return ctx.request({ method: "POST", url: "/api/bulk/sessions", payload: body });
}

async function uploadItem(ctx, opts) {
  return ctx.request({
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
```

## Create requires a target chat, then registers the initial item set

A create with no `targetSessionId` is rejected loudly (400) — a bulk batch with
no chat to deliver into is invalid at creation:

```ts
const ctx = await makeTestServer();
const noTarget = await createBatch(ctx, { items: [] });
JSON.stringify({ status: noTarget.statusCode, error: noTarget.body.error })
=> {"status":400,"error":"A bulk upload requires a target chat session id"}
```

With a target chat + an initial registry, create returns the new session id and
its upload capabilities. The batch's context dir is NOT taken from the request —
it's derived server-side from the target chat's recorded binding:

```ts continue
await bindSession(ctx, "chat-abc", "_content/photos");
const created = await createBatch(ctx, {
  targetSessionId: "chat-abc",
  items: [
    { id: "a", name: "report.pdf", size: 6, mimetype: "application/pdf" },
    { id: "b", name: "photo.png", size: 5, mimetype: "image/png" },
  ],
});
const sessionId = created.body.sessionId;
JSON.stringify({
  status: created.statusCode,
  hasId: typeof sessionId === "string",
  caps: created.body.capabilities.acceptedUploadEncodings,
})
=> {"status":200,"hasId":true,"caps":["raw-body-v1"]}
```

The staging manifest is a `kind: "bulk"` session carrying the registry + the
server-derived target context dir:

```ts continue
const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${sessionId}/session.json`));
JSON.stringify({
  kind: manifest.kind,
  target: manifest.targetSessionId,
  contextDir: manifest.contextDir,
  registered: manifest.expectedItems.map((i) => i.id),
})
=> {"kind":"bulk","target":"chat-abc","contextDir":"_content/photos","registered":["a","b"]}
```

A client-supplied `contextDir` in the body is ignored (path-traversal defense):
a target with no recorded binding lands at the box root regardless of what the
body claims:

```ts continue
const sneaky = await createBatch(ctx, {
  targetSessionId: "chat-unbound",
  contextDir: "../../../etc",
  items: [{ id: "a", name: "x.pdf" }],
});
const sneakyManifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${sneaky.body.sessionId}/session.json`));
JSON.stringify({ status: sneaky.statusCode, contextDir: sneakyManifest.contextDir })
=> {"status":200,"contextDir":""}
```

```ts cleanup
await ctx.cleanup();
```

## Duplicate item ids are rejected at creation and registration (400)

The registry is keyed by id, so a duplicate id in one request — or a new id
colliding with one already registered — is refused (an update-in-place would
silently overwrite the earlier item's claims):

```ts
const ctx = await makeTestServer();
const dupeCreate = await createBatch(ctx, {
  targetSessionId: "chat-1",
  items: [{ id: "a", name: "x.pdf" }, { id: "a", name: "y.pdf" }],
});
JSON.stringify({ status: dupeCreate.statusCode, error: dupeCreate.body.error })
=> {"status":400,"error":"Duplicate item id in registry: a"}
```

```ts continue
const created = await createBatch(ctx, { targetSessionId: "chat-1", items: [{ id: "a", name: "x.pdf" }] });
const collide = await ctx.request({
  method: "POST", url: `/api/bulk/sessions/${created.body.sessionId}/items`,
  payload: { items: [{ id: "a", name: "again.pdf" }, { id: "a", name: "again2.pdf" }] },
});
JSON.stringify({ status: collide.statusCode, error: collide.body.error })
=> {"status":400,"error":"Duplicate item id in registry: a"}
```

Re-registering an EXISTING id (idempotent append while the picker streams) is
still fine:

```ts continue
const reAdd = await ctx.request({
  method: "POST", url: `/api/bulk/sessions/${created.body.sessionId}/items`,
  payload: { items: [{ id: "a", name: "x.pdf" }] },
});
JSON.stringify({ status: reAdd.statusCode, registered: reAdd.body.registered })
=> {"status":200,"registered":1}
```

```ts cleanup
await ctx.cleanup();
```

## Streaming an upload records a server-computed size + sha256

The bytes stream to disk; the manifest entry carries the server-computed size
and sha256 (never a client-claimed size), and the response echoes them:

```ts
const ctx = await makeTestServer();
const created = await createBatch(ctx, {
  targetSessionId: "chat-1",
  items: [{ id: "a", name: "report.pdf" }],
});
const sessionId = created.body.sessionId;

const res = await uploadItem(ctx, {
  sessionId, itemId: "a", filename: "staged-a.bin", originalName: "report.pdf",
  data: Buffer.from("PDFPDF"),
});
JSON.stringify({
  status: res.statusCode,
  size: res.body.size,
  hashMatches: res.body.sha256 === sha256("PDFPDF"),
  itemId: res.body.itemId,
})
=> {"status":200,"size":6,"hashMatches":true,"itemId":"a"}
```

The staged file entry on the manifest carries the same server-computed values
and links back to the registry item, and `totalBytes` accumulates:

```ts continue
const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${sessionId}/session.json`));
JSON.stringify({
  file: manifest.files.map((f) => ({ name: f.originalName, itemId: f.itemId, size: f.size, hashLen: f.sha256.length })),
  totalBytes: manifest.totalBytes,
})
=> {"file":[{"name":"report.pdf","itemId":"a","size":6,"hashLen":64}],"totalBytes":6}
```

An exact retry (same filename + bytes) is idempotent; the same filename with
different bytes is a 409 conflict:

```ts continue
const replay = await uploadItem(ctx, {
  sessionId, itemId: "a", filename: "staged-a.bin", data: Buffer.from("PDFPDF"),
});
const conflict = await uploadItem(ctx, {
  sessionId, itemId: "a", filename: "staged-a.bin", data: Buffer.from("DIFFERENT"),
});
JSON.stringify({ replay: replay.statusCode, conflict: conflict.statusCode })
=> {"replay":200,"conflict":409}
```

```ts cleanup
await ctx.cleanup();
```

## An upload naming an unregistered item is rejected (400)

The item registry is the record of what was supposed to arrive, so an upload
whose `itemId` was never registered is refused before any bytes are staged:

```ts
const ctx = await makeTestServer();
const created = await createBatch(ctx, { targetSessionId: "chat-1", items: [{ id: "a", name: "x.pdf" }] });
const sessionId = created.body.sessionId;

const res = await uploadItem(ctx, {
  sessionId, itemId: "ghost", filename: "staged.bin", data: Buffer.from("X"),
});
JSON.stringify({ status: res.statusCode, error: res.body.error })
=> {"status":400,"error":"No registered item ghost in this bulk batch"}
```

Registering it afterward (append while the picker streams) lets the upload land:

```ts continue
const reg = await ctx.request({
  method: "POST", url: `/api/bulk/sessions/${sessionId}/items`,
  payload: { items: [{ id: "ghost", name: "ghost.pdf" }] },
});
const ok = await uploadItem(ctx, { sessionId, itemId: "ghost", filename: "staged.bin", data: Buffer.from("X") });
JSON.stringify({ registered: reg.body.registered, upload: ok.statusCode })
=> {"registered":2,"upload":200}
```

```ts cleanup
await ctx.cleanup();
```

## Reserved control-file names are rejected (400)

The staging filename (`X-Upload-Filename`) can't claim the session's own control
files: `session.json` (the manifest — overwriting it would silently substitute
content), a `session.json.`-prefixed sibling, `.gitignore`, or any dot-leading
hidden name is refused before any bytes land.

```ts
const ctx = await makeTestServer();
const created = await createBatch(ctx, { targetSessionId: "chat-1", items: [{ id: "a", name: "x.pdf" }] });
const sessionId = created.body.sessionId;

const names = ["session.json", "session.json.corrupt", ".gitignore", ".hidden"];
const codes = [];
for (const name of names) codes.push((await uploadItem(ctx, { sessionId, itemId: "a", filename: name, data: Buffer.from("X") })).statusCode);
JSON.stringify(codes)
=> [400,400,400,400]
```

The manifest is untouched — the upload never overwrote it:

```ts continue
const manifest = JSON.parse(await ctx.read(`_tmp/capture-staging/${sessionId}/session.json`));
JSON.stringify({ kind: manifest.kind, files: manifest.files.length })
=> {"kind":"bulk","files":0}
```

```ts cleanup
await ctx.cleanup();
```

## Exceeding the per-session byte cap returns 413

Seeding the accumulated bytes to the cap makes a single-byte upload tip it over,
mapped to 413 (the same staging cap capture enforces):

```ts
const ctx = await makeTestServer();
const created = await createBatch(ctx, { targetSessionId: "chat-1", items: [{ id: "a", name: "big.bin" }] });
const sessionId = created.body.sessionId;
const session = await readStagingSession({ boxRoot: ctx.boxRoot, id: sessionId });
session.totalBytes = MAX_STAGED_BYTES;
await writeStagingSession({ boxRoot: ctx.boxRoot, session });

const res = await uploadItem(ctx, { sessionId, itemId: "a", filename: "big.bin", data: Buffer.from("X") });
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

## Status/resume lists registered vs received items

After a partial upload, the status endpoint reports what was registered and what
actually arrived — enough for a client to resume the missing items:

```ts
const ctx = await makeTestServer();
const created = await createBatch(ctx, {
  targetSessionId: "chat-1",
  items: [{ id: "a", name: "a.pdf" }, { id: "b", name: "b.pdf" }],
});
const sessionId = created.body.sessionId;
await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-a.bin", originalName: "a.pdf", data: Buffer.from("AAAA") });

const status = await ctx.request({ method: "GET", url: `/api/bulk/sessions/${sessionId}` });
JSON.stringify({
  state: status.body.state,
  registered: status.body.registered.map((i) => i.id),
  received: status.body.received.map((r) => ({ itemId: r.itemId, size: r.size })),
})
=> {"state":"open","registered":["a","b"],"received":[{"itemId":"a","size":4}]}
```

```ts cleanup
await ctx.cleanup();
```

## Uploading to an unknown session returns 404

```ts
const ctx = await makeTestServer();
const res = await uploadItem(ctx, { sessionId: "no-such", itemId: "a", filename: "x.bin", data: Buffer.from("X") });
res.statusCode
=> 404
```

```ts cleanup
await ctx.cleanup();
```

## Finalize seals the session and returns staged

Finalize returns immediately with `staged: true` (the prepare→deliver worker
runs in the background) and CAS-seals the session so it stops accepting uploads:

```ts
const ctx = await makeTestServer();
const created = await createBatch(ctx, { targetSessionId: "chat-1", items: [{ id: "a", name: "a.pdf" }] });
const sessionId = created.body.sessionId;
await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-a.bin", originalName: "a.pdf", data: Buffer.from("AAAA") });

const done = await ctx.request({
  method: "POST", url: `/api/bulk/sessions/${sessionId}/finalize`,
  payload: { failedItems: [] },
});
JSON.stringify({ status: done.statusCode, staged: done.body.staged, sessionId: done.body.sessionId === sessionId })
=> {"status":200,"staged":true,"sessionId":true}
```

A further upload after finalize is refused — the session is no longer open:

```ts continue
const late = await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-late.bin", data: Buffer.from("X") });
late.statusCode
=> 409
```

```ts cleanup
await ctx.cleanup();
```

## Finalize records the batch's introduction inside the seal

The composer text the boxholder submitted the batch with rides IN the CAS seal,
so a resume rebuilds the same batch with the same introduction — there is no
window in which a sealed batch exists without its note.

```ts
const ctx = await makeTestServer();
const created = await createBatch(ctx, { targetSessionId: "chat-note", items: [{ id: "a", name: "a.jpg" }] });
const sessionId = created.body.sessionId;
await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-a.bin", originalName: "a.jpg", data: Buffer.from("AAAA") });

const done = await ctx.request({
  method: "POST", url: `/api/bulk/sessions/${sessionId}/finalize`,
  payload: { note: "Receipts from the Tokyo trip" },
});
const sealed = await readStagingSession({ boxRoot: ctx.boxRoot, id: sessionId });
JSON.stringify({ status: done.statusCode, state: sealed.state, note: sealed.note })
=> {"status":200,"state":"sealed","note":"Receipts from the Tokyo trip"}
```

```ts cleanup
await ctx.cleanup();
```

## A whitespace-only note is recorded as no note at all

An empty composer must produce a batch indistinguishable from one that never
carried an introduction — that is what keeps the `<upload>` message byte-identical
to its pre-note form.

```ts
const ctx = await makeTestServer();
const created = await createBatch(ctx, { targetSessionId: "chat-blank", items: [{ id: "a", name: "a.jpg" }] });
const sessionId = created.body.sessionId;
await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-a.bin", originalName: "a.jpg", data: Buffer.from("AAAA") });

await ctx.request({
  method: "POST", url: `/api/bulk/sessions/${sessionId}/finalize`,
  payload: { note: "   \n\t " },
});
const sealed = await readStagingSession({ boxRoot: ctx.boxRoot, id: sessionId });
JSON.stringify({ note: sealed.note ?? null })
=> {"note":null}
```

```ts cleanup
await ctx.cleanup();
```

## An oversized note is rejected at the boundary

The note is untrusted client prose, so it is length-capped where it enters
rather than trusted downstream.

```ts
const ctx = await makeTestServer();
const created = await createBatch(ctx, { targetSessionId: "chat-big", items: [{ id: "a", name: "a.jpg" }] });
const sessionId = created.body.sessionId;

const tooBig = await ctx.request({
  method: "POST", url: `/api/bulk/sessions/${sessionId}/finalize`,
  payload: { note: "x".repeat(10_001) },
});
const stillOpen = await readStagingSession({ boxRoot: ctx.boxRoot, id: sessionId });
JSON.stringify({ status: tooBig.statusCode, state: stillOpen.state })
=> {"status":400,"state":"open"}
```

```ts cleanup
await ctx.cleanup();
```

## A sealed batch cannot be cancelled out from under its worker

Cancel is the uploader's affordance for a batch it still owns. Once finalize
seals one, the background worker owns it — deleting the staging directory then
makes the worker read `null` and quietly return, so no `<upload>` message ever
arrives while the client, which already saw finalize succeed, reports success.
That is the "client says done, server shows nothing" failure this feature exists
to remove, so a post-seal cancel is refused rather than raced.

```ts
const ctx = await makeTestServer();
const created = await createBatch(ctx, { targetSessionId: "chat-cancel", items: [{ id: "a", name: "a.jpg" }] });
const sessionId = created.body.sessionId;
await uploadItem(ctx, { sessionId, itemId: "a", filename: "s-a.bin", originalName: "a.jpg", data: Buffer.from("AAAA") });
await ctx.request({ method: "POST", url: `/api/bulk/sessions/${sessionId}/finalize`, payload: {} });

const late = await ctx.request({ method: "DELETE", url: `/api/bulk/sessions/${sessionId}` });
late.statusCode
=> 409
```

An open batch still cancels normally:

```ts continue
const open = await createBatch(ctx, { targetSessionId: "chat-cancel", items: [{ id: "b", name: "b.jpg" }] });
const cancelled = await ctx.request({ method: "DELETE", url: `/api/bulk/sessions/${open.body.sessionId}` });
JSON.stringify({ status: cancelled.statusCode, success: cancelled.body.success })
=> {"status":200,"success":true}
```

```ts cleanup
await ctx.cleanup();
```

# Scan upload routes

The server half of the scan-uploader wire contract
(`docs/scan-upload-contract.md`). This file is that contract's executable form:
it drives the routes exactly as the laptop uploader will — check a batch of
hashes, PUT the unknown ones, re-check — and pins every documented status.

WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.

`qpdf` is the one thing these tests cannot assume: it ships on the deployed
server but is not a developer-machine given. So the PDF sections assert
availability-appropriate behavior — a real verdict where qpdf exists, and the
fail-closed 503 (never a rejection, never an unvalidated accept) where it does
not. Everything else — sniffing, hashing, dedup, limits, auth — runs the same
on both.

```ts setup
import { createHash } from "node:crypto";
import Sharp from "sharp";
import { makeTestServer } from "../../helpers/doctest-server.js";
import { textlessPdf } from "../../helpers/pdf-fixtures.js";
import { resetScanRateLimits, SCAN_RATE_LIMIT } from "../../../src/webapp/routes/scan-rate-limit.js";
import { qpdfAvailable } from "../../../src/core/scan/validate.js";
import { createScanToken } from "../../../src/core/scan/tokens.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";

const ORIGINAL_HUB_SECRET = process.env.CB_HUB_SECRET;
const ORIGINAL_OWNER_EMAIL = process.env.CB_OWNER_EMAIL;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A real 4x4 PNG, encoded by sharp — so the decode check has something to decode. */
function pngBytes() {
  return Sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();
}

async function put(ctx, opts) {
  return ctx.request({
    method: "PUT",
    url: `/api/scan/files/${opts.hash ?? sha256(opts.bytes)}`,
    payload: opts.bytes,
    headers: {
      "content-type": "application/octet-stream",
      ...(opts.filename === null ? {} : { "x-upload-filename": opts.filename }),
      ...opts.headers,
    },
  });
}

async function check(ctx, hashes) {
  return ctx.request({ method: "POST", url: "/api/scan/check", payload: { hashes } });
}

/**
 * Collapse a PDF response to "ok" when it matches what THIS host should do.
 * With qpdf the route returns a real verdict; without it the route must refuse
 * with a retryable 503 rather than accept unvalidated bytes or blame the file.
 */
function pdfOutcome(opts) {
  const { hasQpdf, res, status, body } = opts;
  if (!hasQpdf) {
    return res.statusCode === 503 && res.body.status === "server-error"
      ? "ok"
      : `unexpected without qpdf: ${res.statusCode} ${JSON.stringify(res.body)}`;
  }
  return res.statusCode === status && res.body.status === body
    ? "ok"
    : `unexpected with qpdf: ${res.statusCode} ${JSON.stringify(res.body)}`;
}
```

## The full walk: unknown → accepted → pending → duplicate

An uploader's first move is `check`, which answers `unknown` for a hash the box
has never seen. `pending` and `imported` are the two states that let a client
dispose of its local copy, so `unknown` has to be the honest default.

```ts
resetScanRateLimits();
const ctx = await makeTestServer();
const png = await pngBytes();
const hash = sha256(png);

const first = await check(ctx, [hash]);
JSON.stringify({ status: first.statusCode, states: first.body.states })
=> {"status":200,"states":{"«*»":{"state":"unknown"}}}
```

The PUT streams the bytes into quarantine, re-hashes them, sniffs the magic
bytes against the claimed extension, and decodes the image — all before the 200:

```ts continue
const accepted = await put(ctx, { bytes: png, filename: "Receipts_001.png" });
JSON.stringify({ status: accepted.statusCode, body: accepted.body })
=> {"status":200,"body":{"status":"accepted"}}
```

The sidecar is the durable record the promote worker will resume from. It keeps
the *sanitized original* filename — not the hash name — because scan-import's
image grouping keys on scanner `<prefix>_NNN` names, and it records which token
uploaded the file as provenance:

```ts continue
const sidecar = JSON.parse(await ctx.read(`tmp/scan-quarantine/${hash}.json`));
const expectedStored = `${hash}.png`;
JSON.stringify({
  state: sidecar.state,
  storedFilename: sidecar.storedFilename === expectedStored,
  originalFilename: sidecar.originalFilename,
  profile: sidecar.profile ?? null,
  reason: sidecar.reason ?? null,
})
=> {"state":"pending","storedFilename":true,"originalFilename":"Receipts_001.png","profile":null,"reason":null}
```

`check` now reports `pending` — confirmed, so the client may archive its copy —
and a re-PUT of the same hash is a `duplicate` no-op rather than a re-store:

```ts continue
const second = await check(ctx, [hash]);
const duplicate = await put(ctx, { bytes: png, filename: "Receipts_001.png" });
JSON.stringify({
  state: second.body.states[hash].state,
  duplicate: [duplicate.statusCode, duplicate.body.status],
})
=> {"state":"pending","duplicate":[200,"duplicate"]}
```

`X-Scan-Profile` rides along as free-text provenance when the scanner sends one:

```ts continue
const withProfile = await put(ctx, {
  bytes: Buffer.concat([png, Buffer.from("\n")]),
  filename: "Receipts_002.png",
  headers: { "x-scan-profile": "ScanSnap Colour Duplex" },
});
const profiled = JSON.parse(await ctx.read(`tmp/scan-quarantine/${sha256(Buffer.concat([png, Buffer.from("\n")]))}.json`));
JSON.stringify({ status: withProfile.statusCode, profile: profiled.profile })
=> {"status":200,"profile":"ScanSnap Colour Duplex"}
```

```ts cleanup
await ctx.cleanup();
```

## A hash that already imported answers `imported`, and a PUT of it is a duplicate

`imported` comes from the box's upload ledger, not from quarantine — that is how
a file promoted and swept out of quarantine still answers as confirmed.

```ts
resetScanRateLimits();
const ctx = await makeTestServer();
const png = await pngBytes();
const hash = sha256(png);
await ctx.seed(".callback-box/uploads.json", JSON.stringify({
  version: 1,
  entries: [{
    hash,
    originalName: "Receipts_001.png",
    originalPath: "/scans/Receipts_001.png",
    uploadedAt: "2026-07-01T10:00:00Z",
    kind: "scan",
  }],
}));

const states = await check(ctx, [hash]);
const reput = await put(ctx, { bytes: png, filename: "Receipts_001.png" });
JSON.stringify({ state: states.body.states[hash].state, reput: [reput.statusCode, reput.body.status] })
=> {"state":"imported","reput":[200,"duplicate"]}
```

```ts cleanup
await ctx.cleanup();
```

## Bytes that don't hash to the path segment are refused and recorded nowhere

Truncation and corruption defense. Nothing is written — there is no hash we
could honestly file the received bytes under — so the client simply retries.

```ts
resetScanRateLimits();
const ctx = await makeTestServer();
const png = await pngBytes();
const wrongHash = sha256(Buffer.from("something else entirely"));

const res = await put(ctx, { bytes: png, hash: wrongHash, filename: "Receipts_001.png" });
JSON.stringify({ status: res.statusCode, body: res.body })
=> {"status":422,"body":{"status":"hash-mismatch"}}
```

Neither the claimed hash nor the real one is now known to the box:

```ts continue
const after = await check(ctx, [wrongHash, sha256(png)]);
JSON.stringify([after.body.states[wrongHash].state, after.body.states[sha256(png)].state])
=> ["unknown","unknown"]
```

```ts cleanup
await ctx.cleanup();
```

## A smuggled extension is rejected with a reason a human can act on

The magic-byte sniff is the type-smuggling gate: PNG bytes named `.pdf` never
reach a PDF parser. The reason is written for a boxholder-facing question card,
so it names both what the bytes are and what the name claimed.

```ts
resetScanRateLimits();
const ctx = await makeTestServer();
const png = await pngBytes();
const hash = sha256(png);

const res = await put(ctx, { bytes: png, filename: "Statement.pdf" });
JSON.stringify({ status: res.statusCode, body: res.body })
=> {"status":422,"body":{"status":"rejected","reason":"magic bytes say image/png but the extension is .pdf"}}
```

Bytes of no recognizable type at all (an HTML error page a scanner's network
share handed back, say) are rejected the same way — the sniff failing open would
defeat the whole gate:

```ts continue
const html = Buffer.from("<!DOCTYPE html>\n<html><body>Not found</body></html>\n");
const htmlRes = await put(ctx, { bytes: html, filename: "Statement.pdf" });
JSON.stringify({ status: htmlRes.statusCode, reason: htmlRes.body.reason })
=> {"status":422,"reason":"the magic bytes match no known file type, but the filename claims .pdf"}
```

An extension outside the accepted set never gets as far as a sniff:

```ts continue
const otherBytes = Buffer.concat([png, Buffer.from("tail")]);
const zip = await put(ctx, { bytes: otherBytes, filename: "Scans.zip" });
JSON.stringify({ status: zip.statusCode, reason: zip.body.reason })
=> {"status":422,"reason":"extension .zip is not accepted (accepted: .pdf, .jpg, .jpeg, .png, .tif, .tiff)"}
```

A rejected hash is *kept* — the file stays in quarantine for the question card,
`check` answers `rejected` with the reason, and the client must never dispose of
it:

```ts continue
const states = await check(ctx, [hash]);
const sidecar = JSON.parse(await ctx.read(`tmp/scan-quarantine/${hash}.json`));
const heldAsPdf = sidecar.storedFilename === `${hash}.pdf`;
JSON.stringify({ check: states.body.states[hash], stored: heldAsPdf })
=> {"check":{"state":"rejected","reason":"magic bytes say image/png but the extension is .pdf"},"stored":true}
```

Re-PUT of a rejected hash re-runs validation rather than replaying the cached
verdict — that is the deliberate retry path after a validator fix, and here the
client corrects the filename instead:

```ts continue
const retry = await put(ctx, { bytes: png, filename: "Statement.png" });
const recheck = await check(ctx, [hash]);
JSON.stringify({ retry: [retry.statusCode, retry.body.status], state: recheck.body.states[hash].state })
=> {"retry":[200,"accepted"],"state":"pending"}
```

```ts cleanup
await ctx.cleanup();
```

## PDFs: a valid one is accepted, a truncated one is rejected — or 503 without qpdf

```ts
resetScanRateLimits();
const ctx = await makeTestServer();
const hasQpdf = await qpdfAvailable();
const pdf = textlessPdf();

const good = await put(ctx, { bytes: pdf, filename: "Invoice.pdf" });
pdfOutcome({ hasQpdf, res: good, status: 200, body: "accepted" })
=> ok
```

A PDF cut off mid-file sniffs correctly (`%PDF-` is still there) and fails only
at the structural check — which is exactly the failure a settle-gate race or a
half-written scan produces:

```ts continue
const truncated = pdf.subarray(0, Math.floor(pdf.length / 2));
const bad = await put(ctx, { bytes: truncated, filename: "Invoice.pdf" });
pdfOutcome({ hasQpdf, res: bad, status: 422, body: "rejected" })
=> ok
```

Where qpdf is missing the 503 records nothing at all: the file stays `unknown`,
so the uploader retries later instead of treating a server misconfiguration as a
verdict on its file.

```ts continue
const states = await check(ctx, [sha256(pdf), sha256(truncated)]);
const expected = hasQpdf ? ["pending", "rejected"] : ["unknown", "unknown"];
JSON.stringify([states.body.states[sha256(pdf)].state, states.body.states[sha256(truncated)].state]) === JSON.stringify(expected)
=> true
```

```ts cleanup
await ctx.cleanup();
```

## Size limits are enforced twice: on the declared length and on the real stream

A `Content-Length` over the 50 MB cap is refused before a byte is transferred:

```ts
resetScanRateLimits();
const ctx = await makeTestServer();
const png = await pngBytes();

const declared = await put(ctx, {
  bytes: png,
  filename: "Huge.png",
  headers: { "content-length": String(50 * 1024 * 1024 + 1) },
});
declared.statusCode
=> 413
```

...and a client that *lies* about its length is caught mid-stream, because
Fastify's `bodyLimit` does not meter a passthrough parser — the route counts the
bytes itself and aborts the moment they cross the cap:

```ts continue
const oversize = Buffer.alloc(50 * 1024 * 1024 + 1024, 0x41);
const lied = await put(ctx, {
  bytes: oversize,
  filename: "Huge.png",
  headers: { "content-length": "12" },
});
lied.statusCode
=> 413
```

No partial file survives either refusal — quarantine holds nothing:

```ts continue
const states = await check(ctx, [sha256(oversize)]);
JSON.stringify(states.body.states[sha256(oversize)])
=> {"state":"unknown"}
```

A body with no `Content-Length` at all is refused too: the contract requires it,
and a length-less stream is exactly the shape a runaway upload arrives in.

```ts continue
const noLength = await ctx.request({
  method: "PUT",
  url: `/api/scan/files/${sha256(png)}`,
  headers: { "content-type": "application/octet-stream", "x-upload-filename": "a.png" },
});
noLength.statusCode
=> 411
```

```ts cleanup
await ctx.cleanup();
```

## Malformed requests are refused before anything is stored

The hash in the path is the idempotency key for everything downstream, so a
malformed one is a 400, not a best-effort guess. Uppercase hex is malformed too
— one canonical spelling keeps the dedup key from forking.

```ts
resetScanRateLimits();
const ctx = await makeTestServer();
const png = await pngBytes();

const malformedHashes = ["not-a-hash", sha256(png).toUpperCase(), sha256(png) + "00"];
const codes = [];
for (const hash of malformedHashes) codes.push((await put(ctx, { bytes: png, hash, filename: "a.png" })).statusCode);
JSON.stringify(codes)
=> [400,400,400]
```

`X-Upload-Filename` is required — the extension is half the validation input and
the sanitized name is what the promote worker materializes the file under. A
path in it collapses to its basename before anything else looks at it, so
`../../etc/passwd` arrives as `passwd` and then fails on having no extension at
all; the traversal never reaches a path join:

```ts continue
const missing = await put(ctx, { bytes: png, filename: null });
const blank = await put(ctx, { bytes: png, filename: "   " });
const traversal = await put(ctx, { bytes: png, filename: "../../etc/passwd" });
JSON.stringify({
  missing: [missing.statusCode, missing.body.error],
  blank: blank.statusCode,
  traversal: [traversal.statusCode, traversal.body.reason],
})
=> {"missing":[400,"X-Upload-Filename header required"],"blank":400,"traversal":[422,"the file has no extension (accepted: .pdf, .jpg, .jpeg, .png, .tif, .tiff)"]}
```

`check` validates its batch the same way — a malformed hash or an over-cap batch
is a 400 rather than a map full of `unknown`:

```ts continue
const malformed = await check(ctx, ["nope"]);
const overCap = await check(ctx, Array.from({ length: 501 }, (_v, i) => sha256(Buffer.from(String(i)))));
const notAnArray = await ctx.request({ method: "POST", url: "/api/scan/check", payload: { hashes: "abc" } });
JSON.stringify([malformed.statusCode, overCap.statusCode, notAnArray.statusCode])
=> [400,400,400]
```

An empty batch is legal — a folder with nothing new in it is a normal run:

```ts continue
const empty = await check(ctx, []);
JSON.stringify({ status: empty.statusCode, states: empty.body.states })
=> {"status":200,"states":{}}
```

```ts cleanup
await ctx.cleanup();
```

## Past 60 requests a minute the credential is throttled with a `Retry-After`

A bound on a runaway or looping uploader, an order of magnitude above real
scanner cadence.

```ts
resetScanRateLimits();
const ctx = await makeTestServer();

let last = null;
for (let i = 0; i < SCAN_RATE_LIMIT + 1; i++) last = await check(ctx, []);
last.statusCode
=> 429
```

The response carries the seconds until the window rolls over, which is what the
contract tells the client to honor:

```ts continue
const throttled = await ctx.rawRequest({ method: "POST", url: "/api/scan/check", payload: { hashes: [] } });
const retryAfter = Number(throttled.headers["retry-after"]);
JSON.stringify({ status: throttled.statusCode, sane: retryAfter >= 1 && retryAfter <= 60 })
=> {"status":429,"sane":true}
```

Clearing the window lets the same credential straight back in:

```ts continue
resetScanRateLimits();
(await check(ctx, [])).statusCode
=> 200
```

```ts cleanup
await ctx.cleanup();
```

## Auth: a scan token and the owner both reach these routes; a phone does not

These routes are registered in a sibling scope outside the box's general auth
hook — that hook 401s a scan bearer, so a scan token would never reach a handler
from inside it. What follows is the whole point of that arrangement, exercised
on a real auth-on server.

```ts
resetScanRateLimits();
delete process.env.CB_HUB_SECRET;
const ctx = await makeTestServer({ openAccess: false });
const png = await pngBytes();
const token = await createScanToken(ctx.boxRoot, { name: "laptop-scansnap", createdBy: "owner@example.com" });

const asToken = await ctx.request({
  method: "PUT",
  url: `/api/scan/files/${sha256(png)}`,
  payload: png,
  headers: {
    "content-type": "application/octet-stream",
    "x-upload-filename": "Receipts_001.png",
    authorization: `Bearer ${token.token}`,
  },
});
JSON.stringify({ status: asToken.statusCode, body: asToken.body })
=> {"status":200,"body":{"status":"accepted"}}
```

The sidecar records which token it was — this becomes `scan-upload/<name>`
provenance on the card the promote worker files:

```ts continue
const tokenSidecar = JSON.parse(await ctx.read(`tmp/scan-quarantine/${sha256(png)}.json`));
tokenSidecar.tokenName
=> laptop-scansnap
```

The boxholder's own identity works too, so these routes can be driven by hand;
a paired phone's device token — a full-access credential everywhere else —
resolves to nothing here, because the scan gate reads the scan store and only
the scan store:

```ts continue
process.env.CB_HUB_SECRET = "scan-upload-doctest-secret";
process.env.CB_OWNER_EMAIL = "owner@example.com";
const asOwner = await check(ctx, [sha256(png)]);
const asOwnerHub = await ctx.request({
  method: "POST",
  url: "/api/scan/check",
  payload: { hashes: [sha256(png)] },
  headers: {
    "x-cb-hub-secret": "scan-upload-doctest-secret",
    "x-cb-authenticated-email": "owner@example.com",
  },
});
const ticket = createMobilePairingTicket(ctx.boxRoot, { createdBy: "owner@example.com" });
const device = await redeemMobilePairingTicket(ctx.boxRoot, { pairingToken: ticket.token, deviceLabel: "phone" });
const asPhone = await ctx.request({
  method: "POST",
  url: "/api/scan/check",
  payload: { hashes: [sha256(png)] },
  headers: { authorization: `Bearer ${device.deviceToken}` },
});
JSON.stringify({
  anonymous: asOwner.statusCode,
  owner: [asOwnerHub.statusCode, asOwnerHub.body.states[sha256(png)].state],
  phone: asPhone.statusCode,
})
=> {"anonymous":401,"owner":[200,"pending"],"phone":401}
```

```ts cleanup
await ctx.cleanup();
if (ORIGINAL_HUB_SECRET === undefined) delete process.env.CB_HUB_SECRET;
else process.env.CB_HUB_SECRET = ORIGINAL_HUB_SECRET;
if (ORIGINAL_OWNER_EMAIL === undefined) delete process.env.CB_OWNER_EMAIL;
else process.env.CB_OWNER_EMAIL = ORIGINAL_OWNER_EMAIL;
```

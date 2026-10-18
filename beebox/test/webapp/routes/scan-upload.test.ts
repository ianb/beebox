// # Scan upload routes
//
// The server half of the scan-uploader wire contract
// (`docs/scan-upload-contract.md`). This file is that contract's executable form:
// it drives the routes exactly as the laptop uploader will — check a batch of
// hashes, PUT the unknown ones, re-check — and pins every documented status.
//
// WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
//
// `qpdf` is the one thing these tests cannot assume: it ships on the deployed
// server but is not a developer-machine given. So the PDF sections assert
// availability-appropriate behavior — a real verdict where qpdf exists, and the
// fail-closed 503 (never a rejection, never an unvalidated accept) where it does
// not. Everything else — sniffing, hashing, dedup, limits, auth — runs the same
// on both.

import { test } from "tap";
import "agent-doctest/tap";
import { createHash } from "node:crypto";
import Sharp from "sharp";
import { makeTestServer, type InjectResult, type TestServer } from "../../helpers/doctest-server.js";
import { bodyField } from "../../helpers/doctest-helpers.js";
import type { TestServerOptions } from "../../helpers/test-server.js";
import { textlessPdf } from "../../helpers/pdf-fixtures.js";
import { resetScanRateLimits, SCAN_RATE_LIMIT } from "../../../src/webapp/routes/scan-upload/rate-limit.js";
import { qpdfAvailable } from "../../../src/core/scan/validate.js";
import { createScanToken } from "../../../src/core/scan/tokens.js";
import { createMobilePairingTicket, redeemMobilePairingTicket } from "../../../src/core/mobile/pairing.js";

const ORIGINAL_HUB_SECRET = process.env.BBX_HUB_SECRET;
const ORIGINAL_OWNER_EMAIL = process.env.BBX_OWNER_EMAIL;

function sha256(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Route tests pin upload validation; promotion orchestration has its own tests. */
async function makeScanTestServer(options?: TestServerOptions) {
  const promotionRoots: string[] = [];
  let resolveStartupPass: () => void = () => {};
  const startupPass = new Promise<void>((resolve) => {
    resolveStartupPass = resolve;
  });
  const ctx = await makeTestServer({
    ...options,
    scanPromoteRun: async (boxRoot) => {
      promotionRoots.push(boxRoot);
      resolveStartupPass();
    },
  });
  return { ...ctx, promotionRoots, startupPass };
}

/** A real 4x4 PNG, encoded by sharp — so the decode check has something to decode. */
function pngBytes() {
  return Sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();
}

/** Real encoded fixtures exercise extension, magic, and complete decoder checks. */
function webpBytes() {
  return Sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .webp().toBuffer();
}

function avifBytes() {
  return Sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .avif().toBuffer();
}

async function put(ctx: TestServer, opts: { bytes: Buffer; hash?: string; filename: string | null; headers?: Record<string, string> }) {
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

async function check(ctx: TestServer, hashes: string[]) {
  return ctx.request({ method: "POST", url: "/api/scan/check", payload: { hashes } });
}

/**
 * Collapse a PDF response to "ok" when it matches what THIS host should do.
 * With qpdf the route returns a real verdict; without it the route must refuse
 * with a retryable 503 rather than accept unvalidated bytes or blame the file.
 */
function pdfOutcome(opts: { hasQpdf: boolean; res: InjectResult; status: number; body: string }) {
  const { hasQpdf, res, status, body } = opts;
  if (!hasQpdf) {
    return res.statusCode === 503 && bodyField(res.body, "status") === "server-error"
      ? "ok"
      : `unexpected without qpdf: ${res.statusCode} ${JSON.stringify(res.body)}`;
  }
  return res.statusCode === status && bodyField(res.body, "status") === body
    ? "ok"
    : `unexpected with qpdf: ${res.statusCode} ${JSON.stringify(res.body)}`;
}

// ## The full walk: unknown → accepted → pending → duplicate
//
// An uploader's first move is `check`, which answers `unknown` for a hash the box
// has never seen. `pending` and `imported` are the two states that let a client
// dispose of its local copy, so `unknown` has to be the honest default.
void test("An uploader's first move is check, which answers unknown for a hash the box h...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L113
  resetScanRateLimits();
  const ctx = await makeScanTestServer();
  await ctx.startupPass;
  const png = await pngBytes();
  const hash = sha256(png);

  // doctest:L119
  const first = await check(ctx, [hash]);
  await t.checkText(JSON.stringify({ status: first.statusCode, states: bodyField(first.body, "states") }), "{\"status\":200,\"states\":{\"«*»\":{\"state\":\"unknown\"}}}");

  // The same response carries the box's contract version, which is how a copied
  // uploader bundle notices it has fallen behind this box. It is a sibling of
  // `states`, so an uploader that predates it reads the response exactly as
  // before — see the contract doc's "Client identity".

  // doctest:L130
  t.check(typeof bodyField(first.body, "contractVersion"), "number");

  // The PUT streams the bytes into quarantine, re-hashes them, sniffs the magic
  // bytes against the claimed extension, and decodes the image — all before the 200:

  // doctest:L138
  const accepted = await put(ctx, { bytes: png, filename: "Receipts_001.png" });
  t.check({ status: accepted.statusCode, body: accepted.body }, {
    status: 200,
    body: {
      status: "accepted",
    },
  });

  // The sidecar is the durable record the promote worker will resume from. It keeps
  // the *sanitized original* filename — not the hash name — because scan-import's
  // image grouping keys on scanner `<prefix>_NNN` names, and it records which token
  // uploaded the file as provenance:

  // doctest:L149
  const sidecar = JSON.parse(await ctx.read(`_tmp/scan-quarantine/${hash}.json`));
  const expectedStored = `${hash}.png`;
  t.check(
    {
      state: sidecar.state,
      storedFilename: sidecar.storedFilename === expectedStored,
      originalFilename: sidecar.originalFilename,
      profile: sidecar.profile ?? null,
      reason: sidecar.reason ?? null,
    },
    {
    state: "pending",
    storedFilename: true,
    originalFilename: "Receipts_001.png",
    profile: null,
    reason: null,
  },
  );

  // `check` now reports `pending` — confirmed, so the client may archive its copy —
  // and a re-PUT of the same hash is a `duplicate` no-op rather than a re-store:

  // doctest:L165
  const second = await check(ctx, [hash]);
  const duplicate = await put(ctx, { bytes: png, filename: "Receipts_001.png" });
  t.check(
    {
      state: bodyField(second.body, "states", hash, "state"),
      duplicate: [duplicate.statusCode, bodyField(duplicate.body, "status")],
    },
    {
    state: "pending",
    duplicate: [
      200,
      "duplicate",
    ],
  },
  );

  // The lifecycle invoked the injected startup pass for this exact annex-shaped
  // box before the route assertions ran:

  // doctest:L178
  await t.checkText(ctx.promotionRoots[0] === ctx.boxRoot, "true");

  // `X-Scan-Profile` rides along as free-text provenance when the scanner sends one:

  // doctest:L185
  const withProfile = await put(ctx, {
    bytes: Buffer.concat([png, Buffer.from("\n")]),
    filename: "Receipts_002.png",
    headers: { "x-scan-profile": "ScanSnap Colour Duplex" },
  });
  const profiled = JSON.parse(await ctx.read(`_tmp/scan-quarantine/${sha256(Buffer.concat([png, Buffer.from("\n")]))}.json`));
  t.check({ status: withProfile.statusCode, profile: profiled.profile }, {
    status: 200,
    profile: "ScanSnap Colour Duplex",
  });
});

// ## WebP and AVIF uploads require matching bytes and a complete pixel decode
//
// The extension allowlist is intentionally relaxed for these formats, but every
// pair still has to match. file-type reports a valid AVIF with the generic HEIF
// major brand as `image/heif`; `.avif` accepts that container label and still
// requires Sharp to fully decode pixels, without requiring AVIF encoding support.
void test("The extension allowlist is intentionally relaxed for these formats, but every...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L207
  resetScanRateLimits();
  const ctx = await makeScanTestServer();
  const webp = await webpBytes();
  const avif = await avifBytes();
  const wrongWebp = await Sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 10, b: 30 } } })
    .webp().toBuffer();
  const validWebp = await put(ctx, { bytes: webp, filename: "Receipts_001.webp" });
  const validAvif = await put(ctx, { bytes: avif, filename: "Receipts_002.avif" });
  const wrongExtension = await put(ctx, { bytes: wrongWebp, filename: "Receipts_003.avif" });
  const truncated = await put(ctx, { bytes: avif.subarray(0, avif.length - 12), filename: "Receipts_004.avif" });
  t.check(
    [
      [validWebp.statusCode, bodyField(validWebp.body, "status")],
      [validAvif.statusCode, bodyField(validAvif.body, "status")],
      [wrongExtension.statusCode, bodyField(wrongExtension.body, "reason")],
      [truncated.statusCode, bodyField(truncated.body, "status"), String(bodyField(truncated.body, "reason")).startsWith("the image could not be decoded")],
    ],
    [
    [
      200,
      "accepted",
    ],
    [
      200,
      "accepted",
    ],
    [
      422,
      "magic bytes say image/webp but the extension is .avif",
    ],
    [
      422,
      "rejected",
      true,
    ],
  ],
  );

  // Changing a valid AVIF's major brand to `mif1` makes file-type report HEIF. The
  // same valid AV1 image remains accepted through full pixel decode.

  // doctest:L230
  const mif1 = Buffer.from(avif);
  mif1.write("mif1", 8);
  const branded = await put(ctx, { bytes: mif1, filename: "Receipts_005.avif" });
  await t.checkText(JSON.stringify([branded.statusCode, bodyField(branded.body, "status"), bodyField(branded.body, "reason")]), "[200,\"accepted\",null]");
});

// ## A hash that already imported answers `imported`, and a PUT of it is a duplicate
//
// `imported` comes from the box's upload ledger, not from quarantine — that is how
// a file promoted and swept out of quarantine still answers as confirmed.
void test("imported comes from the box's upload ledger, not from quarantine — that is ho...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L247
  resetScanRateLimits();
  const ctx = await makeScanTestServer();
  const png = await pngBytes();
  const hash = sha256(png);
  await ctx.seed(".beebox/uploads.json", JSON.stringify({
    version: 1,
    entries: [{
      hash,
      originalName: "Receipts_001.png",
      originalPath: "/scans/Receipts_001.png",
      uploadedAt: "2026-07-01T10:00:00Z",
      kind: "scan",
    }],
  }));

  // doctest:L262
  const states = await check(ctx, [hash]);
  const reput = await put(ctx, { bytes: png, filename: "Receipts_001.png" });
  t.check({ state: bodyField(states.body, "states", hash, "state"), reput: [reput.statusCode, bodyField(reput.body, "status")] }, {
    state: "imported",
    reput: [
      200,
      "duplicate",
    ],
  });
});

// ## Bytes that don't hash to the path segment are refused and recorded nowhere
//
// Truncation and corruption defense. Nothing is written — there is no hash we
// could honestly file the received bytes under — so the client simply retries.
void test("Truncation and corruption defense.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L278
  resetScanRateLimits();
  const ctx = await makeScanTestServer();
  const png = await pngBytes();
  const wrongHash = sha256(Buffer.from("something else entirely"));

  // doctest:L283
  const res = await put(ctx, { bytes: png, hash: wrongHash, filename: "Receipts_001.png" });
  t.check({ status: res.statusCode, body: res.body }, {
    status: 422,
    body: {
      status: "hash-mismatch",
    },
  });

  // Neither the claimed hash nor the real one is now known to the box:

  // doctest:L291
  const after = await check(ctx, [wrongHash, sha256(png)]);
  t.check([bodyField(after.body, "states", wrongHash, "state"), bodyField(after.body, "states", sha256(png), "state")], [
    "unknown",
    "unknown",
  ]);
});

// ## A smuggled extension is rejected with a reason a human can act on
//
// The magic-byte sniff is the type-smuggling gate: PNG bytes named `.pdf` never
// reach a PDF parser. The reason is written for a boxholder-facing question card,
// so it names both what the bytes are and what the name claimed.
void test("The magic-byte sniff is the type-smuggling gate:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L307
  resetScanRateLimits();
  const ctx = await makeScanTestServer();
  const png = await pngBytes();
  const hash = sha256(png);

  // doctest:L312
  const res = await put(ctx, { bytes: png, filename: "Statement.pdf" });
  t.check({ status: res.statusCode, body: res.body }, {
    status: 422,
    body: {
      status: "rejected",
      reason: "magic bytes say image/png but the extension is .pdf",
    },
  });

  // Bytes of no recognizable type at all (an HTML error page a scanner's network
  // share handed back, say) are rejected the same way — the sniff failing open would
  // defeat the whole gate:

  // doctest:L322
  const html = Buffer.from("<!DOCTYPE html>\n<html><body>Not found</body></html>\n");
  const htmlRes = await put(ctx, { bytes: html, filename: "Statement.pdf" });
  t.check({ status: htmlRes.statusCode, reason: bodyField(htmlRes.body, "reason") }, {
    status: 422,
    reason: "the magic bytes match no known file type, but the filename claims .pdf",
  });

  // An extension outside the accepted set never gets as far as a sniff:

  // doctest:L331
  const otherBytes = Buffer.concat([png, Buffer.from("tail")]);
  const zip = await put(ctx, { bytes: otherBytes, filename: "Scans.zip" });
  t.check({ status: zip.statusCode, reason: bodyField(zip.body, "reason") }, {
    status: 422,
    reason: "extension .zip is not accepted (accepted: .pdf, .jpg, .jpeg, .png, .tif, .tiff, .webp, .avif)",
  });

  // A rejected hash is *kept* — the file stays in quarantine for the question card,
  // `check` answers `rejected` with the reason, and the client must never dispose of
  // it:

  // doctest:L342
  const states = await check(ctx, [hash]);
  const sidecar = JSON.parse(await ctx.read(`_tmp/scan-quarantine/${hash}.json`));
  const heldAsPdf = sidecar.storedFilename === `${hash}.pdf`;
  t.check({ check: bodyField(states.body, "states", hash), stored: heldAsPdf }, {
    check: {
      state: "rejected",
      reason: "magic bytes say image/png but the extension is .pdf",
    },
    stored: true,
  });

  // Re-PUT of a rejected hash re-runs validation rather than replaying the cached
  // verdict — that is the deliberate retry path after a validator fix, and here the
  // client corrects the filename instead:

  // doctest:L354
  const retry = await put(ctx, { bytes: png, filename: "Statement.png" });
  const recheck = await check(ctx, [hash]);
  t.check({ retry: [retry.statusCode, bodyField(retry.body, "status")], state: bodyField(recheck.body, "states", hash, "state") }, {
    retry: [
      200,
      "accepted",
    ],
    state: "pending",
  });
});

// ## PDFs: a valid one is accepted, a corrupt one is rejected — or 503 without qpdf
void test("PDFs: a valid one is accepted, a corrupt one is rejected — or 503 without qpdf", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L367
  resetScanRateLimits();
  const ctx = await makeScanTestServer();
  const hasQpdf = await qpdfAvailable();
  const pdf = textlessPdf();

  // doctest:L372
  const good = await put(ctx, { bytes: pdf, filename: "Invoice.pdf" });
  t.check(pdfOutcome({ hasQpdf, res: good, status: 200, body: "accepted" }), "ok");

  // A corrupt PDF sniffs correctly (`%PDF-` is still there) and fails only at the
  // structural check. Note the fixture is unparseable garbage, not a truncation:
  // qpdf *reconstructs* a truncated PDF whose prefix is well-formed and exits with
  // warnings (exit 3), which the validator deliberately accepts — so the defense
  // against half-written scans is the client's settle gate plus the hash-integrity
  // check, while qpdf catches hard corruption (exit 2):

  // doctest:L385
  const corrupt = Buffer.from("%PDF-1.4\n<<garbage");
  const bad = await put(ctx, { bytes: corrupt, filename: "Invoice.pdf" });
  t.check(pdfOutcome({ hasQpdf, res: bad, status: 422, body: "rejected" }), "ok");

  // Where qpdf is missing the 503 records nothing at all: the file stays `unknown`,
  // so the uploader retries later instead of treating a server misconfiguration as a
  // verdict on its file.

  // doctest:L396
  const states = await check(ctx, [sha256(pdf), sha256(corrupt)]);
  const expected = hasQpdf ? ["pending", "rejected"] : ["unknown", "unknown"];
  await t.checkText(JSON.stringify([bodyField(states.body, "states", sha256(pdf), "state"), bodyField(states.body, "states", sha256(corrupt), "state")]) === JSON.stringify(expected), "true");
});

// ## Size limits are enforced twice: on the declared length and on the real stream
//
// A `Content-Length` over the 50 MB cap is refused before a byte is transferred:
void test("A Content-Length over the 50 MB cap is refused before a byte is transferred:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L411
  resetScanRateLimits();
  const ctx = await makeScanTestServer();
  const png = await pngBytes();

  // doctest:L415
  const declared = await put(ctx, {
    bytes: png,
    filename: "Huge.png",
    headers: { "content-length": String(50 * 1024 * 1024 + 1) },
  });
  t.check(declared.statusCode, 413);

  // ...and a client that *lies* about its length is caught mid-stream, because
  // Fastify's `bodyLimit` does not meter a passthrough parser — the route counts the
  // bytes itself and aborts the moment they cross the cap:

  // doctest:L429
  const oversize = Buffer.alloc(50 * 1024 * 1024 + 1024, 0x41);
  const lied = await put(ctx, {
    bytes: oversize,
    filename: "Huge.png",
    headers: { "content-length": "12" },
  });
  t.check(lied.statusCode, 413);

  // No partial file survives either refusal — quarantine holds nothing:

  // doctest:L442
  const states = await check(ctx, [sha256(oversize)]);
  t.check(bodyField(states.body, "states", sha256(oversize)), {
    state: "unknown",
  });

  // A body with no `Content-Length` at all is refused too: the contract requires it,
  // and a length-less stream is exactly the shape a runaway upload arrives in.

  // doctest:L451
  const noLength = await ctx.request({
    method: "PUT",
    url: `/api/scan/files/${sha256(png)}`,
    headers: { "content-type": "application/octet-stream", "x-upload-filename": "a.png" },
  });
  t.check(noLength.statusCode, 411);
});

// ## Malformed requests are refused before anything is stored
//
// The hash in the path is the idempotency key for everything downstream, so a
// malformed one is a 400, not a best-effort guess. Uppercase hex is malformed too
// — one canonical spelling keeps the dedup key from forking.
void test("The hash in the path is the idempotency key for everything downstream, so a m...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L471
  resetScanRateLimits();
  const ctx = await makeScanTestServer();
  const png = await pngBytes();

  // doctest:L475
  const malformedHashes = ["not-a-hash", sha256(png).toUpperCase(), sha256(png) + "00"];
  const codes = [];
  for (const hash of malformedHashes) codes.push((await put(ctx, { bytes: png, hash, filename: "a.png" })).statusCode);
  t.check(codes, [
    400,
    400,
    400,
  ]);

  // `X-Upload-Filename` is required — the extension is half the validation input and
  // the sanitized name is what the promote worker materializes the file under. A
  // path in it collapses to its basename before anything else looks at it, so
  // `../../etc/passwd` arrives as `passwd` and then fails on having no extension at
  // all; the traversal never reaches a path join:

  // doctest:L489
  const missing = await put(ctx, { bytes: png, filename: null });
  const blank = await put(ctx, { bytes: png, filename: "   " });
  const traversal = await put(ctx, { bytes: png, filename: "../../etc/passwd" });
  t.check(
    {
      missing: [missing.statusCode, bodyField(missing.body, "error")],
      blank: blank.statusCode,
      traversal: [traversal.statusCode, bodyField(traversal.body, "reason")],
    },
    {
    missing: [
      400,
      "X-Upload-Filename header required",
    ],
    blank: 400,
    traversal: [
      422,
      "the file has no extension (accepted: .pdf, .jpg, .jpeg, .png, .tif, .tiff, .webp, .avif)",
    ],
  },
  );

  // `check` validates its batch the same way — a malformed hash or an over-cap batch
  // is a 400 rather than a map full of `unknown`:

  // doctest:L504
  const malformed = await check(ctx, ["nope"]);
  const overCap = await check(ctx, Array.from({ length: 501 }, (_v, i) => sha256(Buffer.from(String(i)))));
  const notAnArray = await ctx.request({ method: "POST", url: "/api/scan/check", payload: { hashes: "abc" } });
  t.check([malformed.statusCode, overCap.statusCode, notAnArray.statusCode], [
    400,
    400,
    400,
  ]);

  // An empty batch is legal — a folder with nothing new in it is a normal run:

  // doctest:L514
  const empty = await check(ctx, []);
  t.check({ status: empty.statusCode, states: bodyField(empty.body, "states") }, {
    status: 200,
    states: {},
  });
});

// ## Past 60 requests a minute the credential is throttled with a `Retry-After`
//
// A bound on a runaway or looping uploader, an order of magnitude above real
// scanner cadence.
void test("A bound on a runaway or looping uploader, an order of magnitude above real sc...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L529
  resetScanRateLimits();
  const ctx = await makeScanTestServer();

  // doctest:L532
  let last = await check(ctx, []);
  for (let i = 1; i < SCAN_RATE_LIMIT + 1; i++) last = await check(ctx, []);
  t.check(last.statusCode, 429);

  // The response carries the seconds until the window rolls over, which is what the
  // contract tells the client to honor:

  // doctest:L542
  const throttled = await ctx.rawRequest({ method: "POST", url: "/api/scan/check", payload: { hashes: [] } });
  const retryAfter = Number(throttled.headers["retry-after"]);
  t.check({ status: throttled.statusCode, sane: retryAfter >= 1 && retryAfter <= 60 }, {
    status: 429,
    sane: true,
  });

  // Clearing the window lets the same credential straight back in:

  // doctest:L551
  resetScanRateLimits();
  t.check((await check(ctx, [])).statusCode, 200);
});

// ## Auth: a scan token and the owner both reach these routes; a phone does not
//
// These routes are registered in a sibling scope outside the box's general auth
// hook — that hook 401s a scan bearer, so a scan token would never reach a handler
// from inside it. What follows is the whole point of that arrangement, exercised
// on a real auth-on server.
void test("These routes are registered in a sibling scope outside the box's general auth...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
      if (ORIGINAL_HUB_SECRET === undefined) delete process.env.BBX_HUB_SECRET;
      else process.env.BBX_HUB_SECRET = ORIGINAL_HUB_SECRET;
      if (ORIGINAL_OWNER_EMAIL === undefined) delete process.env.BBX_OWNER_EMAIL;
      else process.env.BBX_OWNER_EMAIL = ORIGINAL_OWNER_EMAIL;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L568
  resetScanRateLimits();
  delete process.env.BBX_HUB_SECRET;
  const ctx = await makeScanTestServer({ openAccess: false });
  const png = await pngBytes();
  const token = await createScanToken(ctx.boxRoot, { name: "laptop-scansnap", createdBy: "owner@example.com" });

  // doctest:L574
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
  t.check({ status: asToken.statusCode, body: asToken.body }, {
    status: 200,
    body: {
      status: "accepted",
    },
  });

  // The sidecar records which token it was — this becomes `scan-upload/<name>`
  // provenance on the card the promote worker files:

  // doctest:L592
  const tokenSidecar = JSON.parse(await ctx.read(`_tmp/scan-quarantine/${sha256(png)}.json`));
  t.check(tokenSidecar.tokenName, "laptop-scansnap");

  // The boxholder's own identity works too, so these routes can be driven by hand;
  // a paired phone's device token — a full-access credential everywhere else —
  // resolves to nothing here, because the scan gate reads the scan store and only
  // the scan store:

  // doctest:L603
  process.env.BBX_HUB_SECRET = "scan-upload-doctest-secret";
  process.env.BBX_OWNER_EMAIL = "owner@example.com";
  const asOwner = await check(ctx, [sha256(png)]);
  const asOwnerHub = await ctx.request({
    method: "POST",
    url: "/api/scan/check",
    payload: { hashes: [sha256(png)] },
    headers: {
      "x-bbx-hub-secret": "scan-upload-doctest-secret",
      "x-bbx-authenticated-email": "owner@example.com",
    },
  });
  const ticket = createMobilePairingTicket(ctx.boxRoot, { createdBy: "owner@example.com" });
  const device = await redeemMobilePairingTicket(ctx.boxRoot, { pairingToken: ticket.token, deviceLabel: "phone" });
  const asPhone = await ctx.request({
    method: "POST",
    url: "/api/scan/check",
    payload: { hashes: [sha256(png)] },
    headers: { authorization: `Bearer ${device?.deviceToken}` },
  });
  t.check(
    {
      anonymous: asOwner.statusCode,
      owner: [asOwnerHub.statusCode, bodyField(asOwnerHub.body, "states", sha256(png), "state")],
      phone: asPhone.statusCode,
    },
    {
    anonymous: 401,
    owner: [
      200,
      "pending",
    ],
    phone: 401,
  },
  );
});

// ## A box that is not annex-converted refuses everything with a 503
//
// Every section above runs on an annex-converted box (`annexBox: true`), because
// that is the only shape this pipeline can import into. Promotion runs `bbx upload
// --as scan`, which stages raw asset bytes; on a box still using the manifest
// scheme those bytes are gitignored and the import fails at commit — *after* the
// client was told `accepted` and archived its only local copy.
//
// So the routes probe the box's shape at registration and, on a box they cannot
// import into, answer every request with the contract's retryable 503. The client
// reports it and tries again later; it never dispositions a file on a 503, and
// nothing is written to quarantine.
//
// The box has to be broken on purpose now. Every box is annex-shaped from its
// first commit, so the only way to reach this state is to hand-edit the
// `.gitignore` back to hiding assets — which is what `assetsHiddenAgain` does,
// before the server boots, because the probe runs at registration.
//
// The routes keep answering 503 rather than asserting the way the CLI writers do
// (`assertAnnexBox`). The difference is the client: a scan client deletes its only
// copy of a file once the box says `accepted`, so it needs an answer it can act
// on and retry, not a stack trace.
void test("Every section above runs on an annex-converted box (annexBox:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L663
  resetScanRateLimits();
  const ctx = await makeTestServer({ assetsHiddenAgain: true });
  const png = await pngBytes();

  // doctest:L667
  const checked = await check(ctx, [sha256(png)]);
  t.check({ status: checked.statusCode, body: checked.body }, {
    status: 503,
    body: {
      status: "server-error",
      reason: "box is not annex-converted; scan upload disabled",
    },
  });

  // The PUT answers identically — the refusal runs before auth and before the bytes
  // are read, because the answer does not depend on who is asking:

  // doctest:L676
  const stored = await put(ctx, { bytes: png, filename: "Receipts_001.png" });
  t.check({ status: stored.statusCode, body: stored.body }, {
    status: 503,
    body: {
      status: "server-error",
      reason: "box is not annex-converted; scan upload disabled",
    },
  });

  // Quarantine stays empty — no sidecar, no bytes, nothing for a promote pass to
  // find:

  // doctest:L685
  t.check(await ctx.read(`_tmp/scan-quarantine/${sha256(png)}.json`).then(() => "recorded", (e) => e.code), "ENOENT");
});

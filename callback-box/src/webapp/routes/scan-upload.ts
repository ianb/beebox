/**
 * Scan upload routes — the server half of the scan-uploader wire contract.
 *
 * `POST /api/scan/check` answers a batch of hashes with per-hash state so the
 * laptop uploader knows what to send and what it may safely dispose of;
 * `PUT /api/scan/files/<sha256>` streams one file into quarantine, re-hashes
 * it, validates it inline, and answers a truthful per-file verdict.
 *
 * Registration: these routes live in their OWN Fastify scope, a SIBLING of the
 * box scope rather than a child of it (see `registerBox` in
 * server-box-scope.ts). The box's general auth preHandler runs before every
 * route in its scope and knows nothing of scan tokens — a scan bearer would be
 * 401'd there before ever reaching a handler. Registering outside that scope,
 * behind `makeScanAuthPreHandler` instead, is what makes the scan credential
 * work here and nowhere else.
 *
 * Raw Fastify, not tRPC: the PUT streams `request.raw` straight to disk (a 50 MB
 * scan must never be buffered whole), which is the same reason capture and
 * bulk-upload stayed raw. Fastify's `bodyLimit` does NOT meter a passthrough
 * parser, so the route meters the stream itself via `hashStreamToFile`.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hashStreamToFile, StreamByteLimitError } from "../../lib/hash-stream-to-file.js";
import { getBoxTimeISO } from "../../lib/time.js";
import { findEntry, loadLedger } from "../../core/commands/upload-helpers.js";
import {
  ensureQuarantineDir,
  quarantineFilePath,
  readQuarantineEntry,
  recordQuarantineEntry,
  type ScanQuarantineEntry,
} from "../../core/scan/quarantine.js";
import { qpdfAvailable, validateScanFile } from "../../core/scan/validate.js";
import { isAnnexBox } from "../../core/annex/is-annex-box.js";
import { makeScanAuthPreHandler, scanAuthOf, type ScanAuth } from "../scan-auth.js";
import { invariant } from "../../lib/invariant.js";
import { consumeScanRateLimit } from "./scan-rate-limit.js";
import { notifyScanUpload, startScanPromoteLifecycle } from "./scan-promote-lifecycle.js";
import {
  CHECK_BODY_ERROR,
  CheckBodySchema,
  header,
  MAX_PROFILE_LENGTH,
  MAX_SCAN_BYTES,
  OVER_LIMIT_ERROR,
  parsePutPrelude,
  quarantineExtension,
} from "./scan-upload-validation.js";

/**
 * The `reason` a box that is not annex-converted answers with. Prose, not a
 * code: the contract's 503 `reason` is free text the client logs and shows,
 * and every documented status stays as it is (see the 503 row in
 * docs/scan-upload-contract.md).
 */
const NOT_ANNEX_REASON = "box is not annex-converted; scan upload disabled";

/** Client-visible state of one hash. `promoting` is an internal step of the
 *  quarantine state machine; to a client it is still `pending` (confirmed,
 *  awaiting import), so the wire vocabulary stays the four documented values. */
type CheckState = "unknown" | "pending" | "imported" | "rejected";

function checkStateOf(entry: ScanQuarantineEntry): CheckState {
  switch (entry.state) {
    case "pending":
    case "promoting":
      return "pending";
    case "imported":
      return "imported";
    case "rejected":
      return "rejected";
  }
}

/** The scan credential this request resolved to. Absent means the route was
 *  registered without the scan preHandler — a broken invariant, not a 401. */
function requireScanAuth(request: FastifyRequest): ScanAuth {
  const resolved = scanAuthOf(request);
  invariant(resolved !== undefined, "The scan preHandler runs before every handler in this scope");
  return resolved;
}

/** The rate-limit bucket: the token name, or the owner's email when the
 *  boxholder is driving these routes by hand from a browser session. */
function rateLimitKey(request: FastifyRequest): string {
  const resolved = requireScanAuth(request);
  if (resolved.tokenName !== null) return `token:${resolved.tokenName}`;
  return `owner:${resolved.email ?? "unknown"}`;
}

/**
 * `POST /api/scan/check` — per-hash state for a batch.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */
async function handleCheck(opts: {
  boxRoot: string;
  request: FastifyRequest;
  reply: FastifyReply;
}): Promise<unknown> {
  const { boxRoot, request, reply } = opts;
  const parsed = CheckBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({ error: CHECK_BODY_ERROR });
  }
  const ledger = await loadLedger(boxRoot);
  const states: Record<string, { state: CheckState; reason?: string }> = {};
  for (const hash of parsed.data.hashes) {
    if (findEntry(ledger, hash) !== undefined) {
      states[hash] = { state: "imported" };
      continue;
    }
    const entry = await readQuarantineEntry(boxRoot, hash);
    if (entry === null) {
      states[hash] = { state: "unknown" };
      continue;
    }
    const state = checkStateOf(entry);
    states[hash] = state === "rejected" && entry.reason !== undefined ? { state, reason: entry.reason } : { state };
  }
  return { states };
}

/** Whether an existing quarantine entry means "already have it, don't re-store". */
function isSettled(entry: ScanQuarantineEntry): boolean {
  return entry.state === "pending" || entry.state === "promoting" || entry.state === "imported";
}

/**
 * `PUT /api/scan/files/:sha256` — stream one file into quarantine and validate it.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 */
async function handlePut(opts: {
  boxRoot: string;
  request: FastifyRequest<{ Params: { sha256: string } }>;
  reply: FastifyReply;
}): Promise<unknown> {
  const { boxRoot, request, reply } = opts;
  const prelude = parsePutPrelude(request);
  if (!prelude.ok) return reply.status(prelude.status).send({ error: prelude.error });
  const { sha256, originalFilename } = prelude;

  // An already-settled hash is a no-op: re-storing it would churn quarantine and
  // could race the promote worker. A `rejected` hash falls through on purpose —
  // re-PUT is the retry path after a validator fix.
  const existing = await readQuarantineEntry(boxRoot, sha256);
  if (existing !== null && isSettled(existing)) return { status: "duplicate" };
  const ledger = await loadLedger(boxRoot);
  if (findEntry(ledger, sha256) !== undefined) return { status: "duplicate" };

  const dir = await ensureQuarantineDir(boxRoot);
  const tempPath = path.join(dir, `.upload-tmp-${process.pid}-${crypto.randomUUID()}`);
  let received: { size: number; sha256: string };
  try {
    received = await hashStreamToFile({ source: request.raw, destPath: tempPath, maxBytes: MAX_SCAN_BYTES });
  } catch (e) {
    // hashStreamToFile already removed the partial file.
    if (e instanceof StreamByteLimitError) return reply.status(413).send({ error: OVER_LIMIT_ERROR });
    throw e;
  }
  if (received.sha256 !== sha256) {
    // Nothing is recorded: the bytes we hold are not the file the client named,
    // so there is no hash we could honestly file them under. The client retries.
    await fs.rm(tempPath, { force: true });
    return reply.status(422).send({ status: "hash-mismatch" });
  }

  const verdict = await validateScanFile({ filePath: tempPath, filename: originalFilename });
  if (verdict.status === "unavailable") {
    // NOT a rejection. Telling the uploader its file is bad because the server
    // is missing a tool would let it dispose of the only copy; keeping the bytes
    // unvalidated would defeat the gate. So: nothing recorded, retryable 503.
    await fs.rm(tempPath, { force: true });
    console.error(`[scan] Cannot validate ${originalFilename} (${sha256}): ${verdict.detail}`);
    return reply.status(503).send({ status: "server-error", reason: verdict.detail });
  }

  const storedFilename = `${sha256}${quarantineExtension(originalFilename)}`;
  // A re-PUT of a rejected hash may correct the filename, and with it the stored
  // extension — drop the previous copy so quarantine holds one file per hash.
  if (existing !== null && existing.storedFilename !== storedFilename) {
    await fs.rm(quarantineFilePath(boxRoot, existing.storedFilename), { force: true });
  }
  // Durability of the accept path: the bytes were fsynced by `hashStreamToFile`
  // before this rename, and `recordQuarantineEntry` fsyncs the sidecar before we
  // answer. ACCEPTED RESIDUAL: neither rename's *directory entry* is fsynced, so
  // a power cut in that window can still lose an `accepted` file — the client's
  // archive/Trash copy covers it, and per-upload directory fsyncs are not worth
  // their cost here.
  await fs.rename(tempPath, quarantineFilePath(boxRoot, storedFilename));
  // Untrusted client prose that ends up on a card: capped where it enters.
  const profile = header(request, "x-scan-profile")?.slice(0, MAX_PROFILE_LENGTH);
  const entry: ScanQuarantineEntry = {
    sha256,
    state: verdict.status === "valid" ? "pending" : "rejected",
    storedFilename,
    originalFilename,
    tokenName: requireScanAuth(request).tokenName,
    receivedAt: getBoxTimeISO(boxRoot),
    ...(profile === undefined ? {} : { profile }),
    ...(verdict.status === "rejected" ? { reason: verdict.reason } : {}),
  };
  await recordQuarantineEntry(boxRoot, entry);
  // Re-arm the batch-settle window after EITHER verdict: the promote pass runs
  // once this scan session goes quiet (so a ten-page session is one import and
  // one wakeup), and a rejection needs that pass too — it is what raises the
  // question card. A lone rejected upload that didn't schedule anything would
  // sit unquestioned until the next accepted file or a restart.
  notifyScanUpload(boxRoot);
  if (verdict.status === "rejected") {
    return reply.status(422).send({ status: "rejected", reason: verdict.reason });
  }
  return { status: "accepted" };
}

/**
 * Register the scan routes on a scope that is OUTSIDE the box's general auth
 * hook — see the file header. The caller supplies that scope.
 */
export async function registerScanUploadRoutes(options: {
  server: FastifyInstance;
  boxRoot: string;
}): Promise<void> {
  const { server, boxRoot } = options;

  // Probe qpdf at registration rather than on the first PDF, so a host missing
  // it says so at boot instead of mid-upload.
  void qpdfAvailable();

  // Is this box shaped to receive scans at all?
  //
  // Promotion runs `cb upload --as scan`, which stages raw asset bytes. On a
  // box still using the manifest scheme those bytes are gitignored, so the
  // upload fails — AFTER the client was told `accepted` and archived its only
  // local copy. Accepting into a box that cannot import is the one failure
  // this pipeline must not have, so the routes refuse up front instead.
  //
  // The refusal is the contract's existing retryable 503, the same answer a
  // missing validator gets: report, never disposition, retry a later run. The
  // shape is read once here, so converting the box takes effect at the next
  // `cb serve` — which is fine precisely because nothing was accepted and no
  // client-side state has to be unwound.
  const annexShaped = await isAnnexBox(boxRoot);
  if (!annexShaped) {
    console.error(
      `[scan] Box ${boxRoot} is not annex-converted; scan upload is disabled (every request answers 503). ` +
        "Convert it with `cb attachments to-annex`.",
    );
  }

  // Startup recovery + the batch-settle timer the PUT handler re-arms. Startup
  // is where a crashed `promoting` entry, a leftover staging dir, and an owed
  // `cb wakeup` are all recovered. Skipped on an unshaped box: the pass would
  // decline anyway (it re-probes), and arming a debounce timer that can never
  // do anything is worse than not arming it.
  if (annexShaped) startScanPromoteLifecycle({ server, boxRoot });

  await server.register(async (instance) => {
    // Pass the raw body through untouched so the PUT can stream it to disk —
    // the same parser shape bulk-upload and the hub use. `done(null)` leaves
    // `request.raw` readable in the handler.
    // eslint-disable-next-line max-params -- Fastify's addContentTypeParser callback signature is (request, payload, done)
    instance.addContentTypeParser("application/octet-stream", (_request, _payload, done) => done(null));

    // Refuse BEFORE auth: the answer does not depend on who is asking, and a
    // box that cannot import a scan should say so without first resolving a
    // credential. Nothing below runs, so nothing reaches quarantine.
    if (!annexShaped) {
      instance.addHook("preHandler", async (_request, reply) =>
        reply.status(503).send({ status: "server-error", reason: NOT_ANNEX_REASON }),
      );
    }

    instance.addHook("preHandler", makeScanAuthPreHandler({ boxRoot }));
    instance.addHook("preHandler", async (request, reply) => {
      const key = rateLimitKey(request);
      const decision = consumeScanRateLimit(key);
      if (decision.allowed) return;
      console.warn(`[scan] Rate limit tripped for ${key} on ${request.method} ${request.url}`);
      await reply
        .status(429)
        .header("retry-after", String(decision.retryAfterSeconds))
        .send({ error: "Too many scan requests; retry after the interval in Retry-After" });
    });

    instance.post<{ Body: unknown }>("/api/scan/check", (request, reply) => handleCheck({ boxRoot, request, reply }));

    instance.put<{ Params: { sha256: string } }>("/api/scan/files/:sha256", (request, reply) =>
      handlePut({ boxRoot, request, reply }),
    );
  });
}

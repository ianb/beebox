/**
 * Agent-initiated screenshot rendezvous: lets the chat agent (`bbx chat
 * screenshot`) see what the user currently sees in the box UI, round-tripped
 * through the browser tab holding a specific chat session.
 *
 * POST /api/chat/screenshot/request     — long-poll from `bbx chat screenshot`
 * POST /api/chat/screenshot/:requestId  — a browser tab's answer: multipart PNG
 *                                         upload, or JSON `{ack}`/`{declined}`/
 *                                         `{failed}`
 *
 * Flow: the request route parks the CLI call in {@link createPendingBrowserRequests}
 * (with a 2s ack window), which mints a server-side `crypto.randomUUID` request
 * id — the id is NEVER caller-supplied (a caller-chosen id would flow into the
 * `_tmp/screenshot-<id>.png` write path and the registry key: a path-traversal
 * and entry-collision hazard). The route broadcasts a *transient*
 * `screenshot-request` bus event carrying that id, the target session, and an
 * `expiresAt` deadline. The tab holding that exact session acks immediately
 * (cancelling the `no-client` window), captures, then answers with the PNG
 * (first-wins). The request route writes the winning image under
 * `<boxRoot>/_tmp/screenshot-<requestId>.png` and returns its absolute path; the
 * CLI prints that path for the agent to Read.
 *
 * Auth: both routes sit behind the shared box-scope auth wall
 * (`server-box-scope.ts`). The REQUEST route adds an explicit loopback guard on
 * top: it requires the per-box agent bearer (`verifyAgentBearer`) and 403s a
 * plain user session — the flow is agent-initiated, so an ordinary
 * authenticated/open-access user must not be able to start a request. The
 * agent subprocess presents that bearer via `loopbackHeaders()`; the box auth
 * wall recognizes the same bearer, so no browser session can forge it. The
 * ANSWER route stays user-session-authed (the browser tab uploads the PNG), so
 * it gets no agent guard.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { getBoxTime, getBoxTimeISO } from "../../lib/time.js";
import { boxTmpDir } from "../../lib/box-tmp.js";
import { assertNever } from "../../lib/invariant.js";
import { verifyAgentBearer } from "../../core/agent/token.js";
import {
  createPendingBrowserRequests,
  type PendingOutcome,
} from "../../core/pending-browser-request.js";
import { MAX_IMAGE_BYTES } from "./chat-helpers.js";
import type { ChatRoutesContext } from "./chat-context.js";

const DEFAULT_TIMEOUT_MS = 45_000;
/**
 * Floor kept above {@link ACK_GRACE_MS} so the ack window always fires before
 * the overall timeout — otherwise a sub-2s request would collapse the honest
 * `no-client` vs `timeout` distinction (a `no-client` could never resolve).
 */
const MIN_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 120_000;
/** How long a request waits for any tab to ack before resolving `no-client`. */
const ACK_GRACE_MS = 2_000;

/** PNG signature (first 8 bytes of every PNG). */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Physical viewport the browser captured, echoed back to the agent. */
export interface ScreenshotViewport {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}

/**
 * A browser tab's answer to a screenshot request. `declined`/`failed` are
 * ordinary fulfillment payloads — the pending primitive has no notion of them;
 * only `image` produces a saved file.
 */
export type ScreenshotFulfillment =
  | {
      kind: "image";
      png: Buffer;
      viewport?: ScreenshotViewport;
      fidelity: "extension" | "displaymedia";
    }
  | { kind: "declined" }
  | { kind: "failed"; reason: string };

/**
 * A pending screenshot id is always a `crypto.randomUUID` (see the module
 * header) — 8-4-4-4-12 lowercase hex. The answer route validates its
 * caller-supplied `:requestId` param against this before any registry lookup
 * or filesystem use, so a hostile param (`../../target`) is rejected up front
 * even though the id is never itself interpolated into a write path.
 */
const REQUEST_ID_RE = /^[\da-f-]{36}$/;

const requestBodySchema = z
  .object({
    session: z.string().min(1),
    timeoutMs: z.number().optional(),
  })
  .strict();

const viewportSchema = z
  .object({
    cssWidth: z.number().positive().finite(),
    cssHeight: z.number().positive().finite(),
    dpr: z.number().positive().finite(),
  })
  .strict();

const fidelitySchema = z.enum(["extension", "displaymedia"]);

const answerJsonSchema = z.union([
  z.object({ ack: z.literal(true) }).strict(),
  z.object({ declined: z.literal(true) }).strict(),
  z.object({ failed: z.string().min(1).max(500) }).strict(),
]);

function multipartField(
  fields: Record<string, unknown>,
  name: string
): string | null {
  const field = fields[name];
  if (
    field !== null &&
    typeof field === "object" &&
    "value" in field &&
    typeof field.value === "string"
  ) {
    return field.value;
  }
  return null;
}

/**
 * Turn a settled long-poll outcome into the CLI's HTTP response. Only the
 * `image` outcome touches the filesystem — it writes the winning PNG under
 * `<boxRoot>/_tmp/screenshot-<requestId>.png` and returns its absolute path.
 */
async function respondToScreenshotOutcome(opts: {
  reply: FastifyReply;
  boxRoot: string;
  requestId: string;
  outcomeResult: PendingOutcome<ScreenshotFulfillment>;
}): Promise<unknown> {
  const { reply, boxRoot, requestId, outcomeResult } = opts;
  switch (outcomeResult.status) {
    case "no-client":
      return reply.status(504).send({ error: "no-client" });
    case "timeout":
      return reply.status(504).send({ error: "timeout" });
    case "none":
      // Screenshots never call reportNone, so `none` cannot occur.
      return reply.status(504).send({ error: "no-client" });
    case "fulfilled":
      return respondToScreenshotFulfillment({ reply, boxRoot, requestId, fulfillment: outcomeResult.fulfillment });
    default:
      assertNever(outcomeResult);
  }
}

async function respondToScreenshotFulfillment(opts: {
  reply: FastifyReply;
  boxRoot: string;
  requestId: string;
  fulfillment: ScreenshotFulfillment;
}): Promise<unknown> {
  const { reply, boxRoot, requestId, fulfillment } = opts;
  switch (fulfillment.kind) {
    case "declined":
      return reply.status(409).send({ error: "declined" });
    case "failed":
      return reply.status(502).send({ error: "failed", reason: fulfillment.reason });
    case "image": {
      // Flat file directly under _tmp/ (not a _tmp/screenshots/ subdir) so the
      // housekeeping sweep — which only stat()s immediate children of _tmp/ and
      // skips directories — actually reaches and expires it (`core/housekeeping.ts`).
      const dir = boxTmpDir(boxRoot);
      const fileName = `screenshot-${requestId}.png`;
      const absPath = path.resolve(dir, fileName);
      // Defense in depth: `requestId` is a server-minted UUID, so this can't
      // escape — but confirm the resolved path stays inside _tmp/ before writing,
      // so no future change to how the id is produced can silently open a traversal.
      if (absPath !== path.join(dir, fileName) || !absPath.startsWith(dir + path.sep)) {
        return reply.status(400).send({ error: "bad-request-id" });
      }
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(absPath, fulfillment.png);
      const responseBody: {
        path: string;
        fidelity: "extension" | "displaymedia";
        capturedAt: string;
        viewport?: ScreenshotViewport;
      } = {
        path: absPath,
        fidelity: fulfillment.fidelity,
        capturedAt: getBoxTimeISO(boxRoot),
      };
      if (fulfillment.viewport !== undefined) responseBody.viewport = fulfillment.viewport;
      return reply.status(200).send(responseBody);
    }
    default:
      assertNever(fulfillment);
  }
}

export function registerChatScreenshotRoutes(ctx: ChatRoutesContext): void {
  const { server, boxRoot, eventBus } = ctx;
  const pendingRequests = createPendingBrowserRequests<ScreenshotFulfillment>();

  server.post<{ Body: unknown }>(
    "/api/chat/screenshot/request",
    async (request, reply) => {
      // Loopback-only: a screenshot request is agent-initiated, so it requires
      // the per-box agent bearer. A plain user session (even authenticated /
      // open-access, which the box auth wall admits) must not be able to start
      // one — the answer route below is where the browser participates.
      if (!verifyAgentBearer(boxRoot, request.headers["authorization"])) {
        return reply.status(403).send({
          error: "forbidden",
          message: "Screenshot requests are agent-initiated (loopback bearer required)",
        });
      }

      const parsed = requestBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "bad-request",
          message: "Expected { session: string, timeoutMs?: number }",
        });
      }
      const { session } = parsed.data;
      const requestedTimeout = parsed.data.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timeoutMs = Math.min(Math.max(requestedTimeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);

      // The id is minted server-side (never caller-supplied) and broadcast to
      // browser tabs on the bus — that is how a tab learns which id to answer.
      const { requestId, outcome } = pendingRequests.create({
        timeoutMs,
        ackGraceMs: ACK_GRACE_MS,
      });
      const expiresAt = new Date(getBoxTime(boxRoot).getTime() + timeoutMs).toISOString();
      eventBus.emitTransient("screenshot-request", { requestId, session, expiresAt });

      // Cancel the pending entry only on a GENUINE client/CLI disconnect (process
      // killed / connection dropped): the awaiter is gone, so a late browser
      // answer must settle nothing (→ 404), not fulfill a dead request. The
      // ServerResponse 'close' event fires both on a real disconnect AND right
      // after a normal response flushes, so we gate on `writableFinished` — a
      // close with an unfinished body is the disconnect; a close after we've
      // written the reply is benign and must NOT hijack the poll. (We also
      // remove the listener before responding on the happy path; the
      // `writableFinished` guard is the belt-and-suspenders half.) `cancel()`
      // leaves `outcome` pending on purpose, so we must not keep awaiting it.
      let onClose: (() => void) | undefined;
      const aborted = new Promise<"aborted">((resolve) => {
        onClose = () => {
          if (!reply.raw.writableFinished) resolve("aborted");
        };
        reply.raw.on("close", onClose);
      });
      const result = await Promise.race([outcome, aborted]);
      if (onClose) reply.raw.off("close", onClose);
      if (result === "aborted") {
        pendingRequests.cancel(requestId);
        reply.hijack(); // connection already closed; nothing to send
        return reply;
      }

      return respondToScreenshotOutcome({ reply, boxRoot, requestId, outcomeResult: result });
    }
  );

  server.post<{ Params: { requestId: string }; Body: unknown }>(
    "/api/chat/screenshot/:requestId",
    async (request, reply) => {
      const { requestId } = request.params;
      // A live pending id is always a server-minted UUID; reject a malformed
      // param (e.g. a path-traversal attempt) before any registry lookup.
      if (!REQUEST_ID_RE.test(requestId)) {
        return reply.status(400).send({ error: "bad-request-id" });
      }

      if (request.isMultipart()) {
        const data = await request.file();
        if (!data) return reply.status(400).send({ error: "no-image", message: "No image uploaded" });
        const png = await data.toBuffer();
        if (png.length < PNG_MAGIC.length || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
          return reply.status(400).send({ error: "not-png", message: "Upload is not a PNG" });
        }
        if (png.length > MAX_IMAGE_BYTES) {
          return reply.status(400).send({ error: "too-large", message: "Image exceeds the size cap" });
        }

        const fidelityRaw = multipartField(data.fields, "fidelity");
        const fidelity = fidelitySchema.safeParse(fidelityRaw);
        if (!fidelity.success) {
          return reply.status(400).send({ error: "bad-fidelity", message: "fidelity must be extension|displaymedia" });
        }

        const fulfillment: ScreenshotFulfillment = { kind: "image", png, fidelity: fidelity.data };
        const viewportRaw = multipartField(data.fields, "viewport");
        if (viewportRaw !== null) {
          let viewportJson: unknown;
          try {
            viewportJson = JSON.parse(viewportRaw);
          } catch (_e) {
            return reply.status(400).send({ error: "bad-viewport", message: "viewport is not valid JSON" });
          }
          const viewport = viewportSchema.safeParse(viewportJson);
          if (!viewport.success) {
            return reply.status(400).send({ error: "bad-viewport", message: "viewport must be { cssWidth, cssHeight, dpr }" });
          }
          fulfillment.viewport = viewport.data;
        }

        if (!pendingRequests.fulfill(requestId, fulfillment)) {
          // Expected in multi-tab use, or after the CLI aborted: another tab's
          // image already won, or the request was cancelled/settled.
          return reply.status(404).send({ error: "unknown-request" });
        }
        return { ok: true };
      }

      const parsed = answerJsonSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "bad-answer",
          message: 'Expected multipart PNG or {"ack":true} / {"declined":true} / {"failed":"<reason>"}',
        });
      }
      const answer = parsed.data;
      const settled =
        "ack" in answer
          ? pendingRequests.ack(requestId)
          : "declined" in answer
            ? pendingRequests.fulfill(requestId, { kind: "declined" })
            : pendingRequests.fulfill(requestId, { kind: "failed", reason: answer.failed });
      if (!settled) {
        return reply.status(404).send({ error: "unknown-request" });
      }
      return { ok: true };
    }
  );
}

/**
 * Agent-initiated screenshot rendezvous: lets the chat agent (`cb chat
 * screenshot`) see what the user currently sees in the box UI, round-tripped
 * through the browser tab holding a specific chat session.
 *
 * POST /api/chat/screenshot/request     — long-poll from `cb chat screenshot`
 * POST /api/chat/screenshot/:requestId  — a browser tab's answer: multipart PNG
 *                                         upload, or JSON `{ack}`/`{declined}`/
 *                                         `{failed}`
 *
 * Flow: the request route parks the CLI call in {@link createPendingBrowserRequests}
 * (with a 2s ack window) and broadcasts a *transient* `screenshot-request` bus
 * event carrying the target session id and an `expiresAt` deadline. The tab
 * holding that exact session acks immediately (cancelling the `no-client`
 * window), captures, then answers with the PNG (first-wins). The request route
 * writes the winning image under `<boxRoot>/tmp/screenshots/<requestId>.png` and
 * returns its absolute path; the CLI prints that path for the agent to Read.
 *
 * Auth: both routes sit behind the shared box-scope auth wall
 * (`server-box-scope.ts`) exactly like the last-audio routes — the request
 * long-poll is reached by the agent subprocess with its per-box loopback bearer
 * (`loopbackHeaders()`); the answer route by the user's authenticated browser
 * session. There is no additional explicit loopback guard here, matching
 * self-note / last-audio (which have none either).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { getBoxTime, getBoxTimeISO } from "../../lib/time.js";
import { assertNever } from "../../lib/invariant.js";
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

const requestBodySchema = z.object({
  session: z.string().min(1),
  timeoutMs: z.number().optional(),
  /** Caller-chosen request id — for tests and debugging correlation. */
  requestId: z.string().min(1).max(80).optional(),
});

const viewportSchema = z.object({
  cssWidth: z.number(),
  cssHeight: z.number(),
  dpr: z.number(),
});

const fidelitySchema = z.enum(["extension", "displaymedia"]);

const answerJsonSchema = z.union([
  z.object({ ack: z.literal(true) }),
  z.object({ declined: z.literal(true) }),
  z.object({ failed: z.string() }),
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

export function registerChatScreenshotRoutes(ctx: ChatRoutesContext): void {
  const { server, boxRoot, eventBus } = ctx;
  const pendingRequests = createPendingBrowserRequests<ScreenshotFulfillment>();

  server.post<{ Body: unknown }>(
    "/api/chat/screenshot/request",
    async (request, reply) => {
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

      const { requestId, outcome } = pendingRequests.create({
        timeoutMs,
        ackGraceMs: ACK_GRACE_MS,
        requestId: parsed.data.requestId,
      });
      const expiresAt = new Date(getBoxTime(boxRoot).getTime() + timeoutMs).toISOString();
      eventBus.emitTransient("screenshot-request", { requestId, session, expiresAt });

      // Cancel the pending entry if the CLI's long-poll is severed (process
      // killed / connection dropped): the awaiter is gone, so a late browser
      // answer must settle nothing (→ 404), not fulfill a dead request. Race
      // the outcome against a close signal — `cancel()` leaves `outcome`
      // pending on purpose, so we must not keep awaiting it.
      let onClose: (() => void) | undefined;
      const aborted = new Promise<"aborted">((resolve) => {
        onClose = () => resolve("aborted");
        request.raw.on("close", onClose);
      });
      const result = await Promise.race([outcome, aborted]);
      if (onClose) request.raw.off("close", onClose);
      if (result === "aborted") {
        pendingRequests.cancel(requestId);
        reply.hijack(); // connection already closed; nothing to send
        return reply;
      }

      return respond(result);

      async function respond(
        outcomeResult: PendingOutcome<ScreenshotFulfillment>
      ): Promise<unknown> {
        switch (outcomeResult.status) {
          case "no-client":
            return reply.status(504).send({ error: "no-client" });
          case "timeout":
            return reply.status(504).send({ error: "timeout" });
          case "none":
            // Screenshots never call reportNone, so `none` cannot occur.
            return reply.status(504).send({ error: "no-client" });
          case "fulfilled":
            return respondFulfilled(outcomeResult.fulfillment);
          default:
            assertNever(outcomeResult);
        }
      }

      async function respondFulfilled(fulfillment: ScreenshotFulfillment): Promise<unknown> {
        switch (fulfillment.kind) {
          case "declined":
            return reply.status(409).send({ error: "declined" });
          case "failed":
            return reply.status(502).send({ error: "failed", reason: fulfillment.reason });
          case "image": {
            const dir = path.join(boxRoot, "tmp", "screenshots");
            await fs.mkdir(dir, { recursive: true });
            const absPath = path.join(dir, `${requestId}.png`);
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
    }
  );

  server.post<{ Params: { requestId: string }; Body: unknown }>(
    "/api/chat/screenshot/:requestId",
    async (request, reply) => {
      const { requestId } = request.params;

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

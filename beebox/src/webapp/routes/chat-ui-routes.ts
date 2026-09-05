/**
 * Agent-initiated UI scan: lets the chat agent (`bbx chat ui`) learn which
 * controls are on the user's screen right now, and which of them it can point
 * at, round-tripped through the browser tab holding a specific chat session.
 *
 * POST /api/chat/ui/request     — long-poll from `bbx chat ui`
 * POST /api/chat/ui/:requestId  — a client's answer: JSON `{ack:true}`, the
 *                                 scan payload, or `{failed:"…"}`
 *
 * A direct sibling of `chat-screenshot-routes.ts`, and deliberately the same
 * shape: the request parks in {@link createPendingBrowserRequests} with a 2 s
 * ack window (so `no-client` and `timeout` stay honestly distinct), the id is
 * minted server-side and broadcast on a *transient* `ui-scan-request` bus
 * event, and the tab holding that exact session acks then answers. Unlike the
 * screenshot flow nothing is written to disk — the answer is JSON the CLI
 * formats — so there is no path-traversal surface here, only the same
 * malformed-id rejection kept for symmetry and cheapness.
 *
 * Auth mirrors the screenshot routes exactly: the REQUEST route requires the
 * per-box agent bearer (`verifyAgentBearer`) on top of the shared box-scope
 * wall and 403s a plain user session, because the flow is agent-initiated; the
 * ANSWER route stays user-session-authed, because the browser tab is what
 * posts it.
 *
 * There is no consent prompt (the screenshot flow's `ScreenshotConsentPopup`
 * has no counterpart here) — see the client handler for the reasoning and the
 * open question it is pending on.
 */

import type { FastifyReply } from "fastify";
import { z } from "zod";
import { getBoxTime } from "../../lib/time.js";
import { assertNever } from "../../lib/invariant.js";
import { verifyAgentBearer } from "../../core/agent/token.js";
import {
  createPendingBrowserRequests,
  type PendingOutcome,
} from "../../core/pending-browser-request.js";
import { uiScanAnswerSchema, type UiScanPayload } from "../../shared/ui-scan.js";
import type { ChatRoutesContext } from "./chat-context.js";

const DEFAULT_TIMEOUT_MS = 20_000;
/**
 * Floor kept above {@link ACK_GRACE_MS} so the ack window always fires before
 * the overall timeout — otherwise a sub-2s request would collapse the honest
 * `no-client` vs `timeout` distinction.
 */
const MIN_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 120_000;
/** How long a request waits for any client to ack before resolving `no-client`. */
const ACK_GRACE_MS = 2_000;

/** A pending id is always a `crypto.randomUUID` — 8-4-4-4-12 lowercase hex. */
const REQUEST_ID_RE = /^[\da-f-]{36}$/;

/**
 * A client's answer. `failed` is an ordinary fulfillment payload — the pending
 * primitive has no notion of it. No `declined` member: without a consent
 * prompt, nothing can produce one.
 */
export type UiScanFulfillment =
  | { kind: "scan"; payload: UiScanPayload }
  | { kind: "failed"; reason: string };

const requestBodySchema = z
  .object({
    session: z.string().min(1),
    timeoutMs: z.number().optional(),
  })
  .strict();

function respondToUiScanFulfillment(opts: {
  reply: FastifyReply;
  fulfillment: UiScanFulfillment;
}): unknown {
  const { reply, fulfillment } = opts;
  switch (fulfillment.kind) {
    case "failed":
      return reply.status(502).send({ error: "failed", reason: fulfillment.reason });
    case "scan":
      return reply.status(200).send(fulfillment.payload);
    default:
      assertNever(fulfillment);
  }
}

function respondToUiScanOutcome(opts: {
  reply: FastifyReply;
  outcomeResult: PendingOutcome<UiScanFulfillment>;
}): unknown {
  const { reply, outcomeResult } = opts;
  switch (outcomeResult.status) {
    case "no-client":
      return reply.status(504).send({ error: "no-client" });
    case "timeout":
      return reply.status(504).send({ error: "timeout" });
    case "none":
      // UI scans never call reportNone, so `none` cannot occur.
      return reply.status(504).send({ error: "no-client" });
    case "fulfilled":
      return respondToUiScanFulfillment({ reply, fulfillment: outcomeResult.fulfillment });
    default:
      assertNever(outcomeResult);
  }
}

export function registerChatUiRoutes(ctx: ChatRoutesContext): void {
  const { server, boxRoot, eventBus } = ctx;
  const pendingRequests = createPendingBrowserRequests<UiScanFulfillment>();

  server.post<{ Body: unknown }>("/api/chat/ui/request", async (request, reply) => {
    // Loopback-only, exactly as the screenshot request route: the flow is
    // agent-initiated, so an ordinary authenticated/open-access user must not
    // be able to start one.
    if (!verifyAgentBearer(boxRoot, request.headers["authorization"])) {
      return reply.status(403).send({
        error: "forbidden",
        message: "UI scan requests are agent-initiated (loopback bearer required)",
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

    const { requestId, outcome } = pendingRequests.create({
      timeoutMs,
      ackGraceMs: ACK_GRACE_MS,
    });
    const expiresAt = new Date(getBoxTime(boxRoot).getTime() + timeoutMs).toISOString();
    eventBus.emitTransient("ui-scan-request", { requestId, session, expiresAt });

    // Cancel the pending entry only on a GENUINE CLI disconnect, gated on
    // `writableFinished` so the benign post-response 'close' never hijacks the
    // poll — the reasoning is spelled out in `chat-screenshot-routes.ts`.
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

    return respondToUiScanOutcome({ reply, outcomeResult: result });
  });

  server.post<{ Params: { requestId: string }; Body: unknown }>(
    "/api/chat/ui/:requestId",
    async (request, reply) => {
      const { requestId } = request.params;
      if (!REQUEST_ID_RE.test(requestId)) {
        return reply.status(400).send({ error: "bad-request-id" });
      }

      const parsed = uiScanAnswerSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: "bad-answer",
          message: 'Expected {"ack":true}, a scan payload, or {"failed":"<reason>"}',
        });
      }
      const answer = parsed.data;
      const settled =
        "ack" in answer
          ? pendingRequests.ack(requestId)
          : "failed" in answer
            ? pendingRequests.fulfill(requestId, { kind: "failed", reason: answer.failed })
            : pendingRequests.fulfill(requestId, { kind: "scan", payload: answer });
      if (!settled) {
        // Expected in multi-tab use, or after the CLI aborted: another tab's
        // scan already won, or the request was cancelled/settled.
        return reply.status(404).send({ error: "unknown-request" });
      }
      return { ok: true };
    }
  );
}

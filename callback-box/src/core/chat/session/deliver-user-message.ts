/**
 * Deliver a first-class user message into a chat session.
 *
 * The generic resolve→emit `chat-user-message`→busy?enqueue:send core shared by
 * capture delivery (`core/capture/deliver.ts`) and bulk-upload delivery
 * (`core/bulk-upload/deliver.ts`). Each caller keeps its own wrapper builder and
 * target resolution (capture may fall back to the most-active session; bulk
 * never does) and maps {@link UserMessageDeliveryError} to its own retryable
 * failure state; this module owns only the session plumbing they share.
 *
 * Modeled on the self-note route's resolve-target → busy? enqueue : send shape
 * (`chat-send-routes.ts`), but it creates a session when none resolves (a null
 * target), emits the events the pending UI consumes, and awaits the non-busy
 * `send()` so a failure is recorded retryably rather than fire-and-forgotten.
 */

import { createReadStream } from "node:fs";
import * as readline from "node:readline";
import type { ChatSession } from "./index.js";
import type { ChatSessionRegistry } from "./registry.js";
import type { EventBus } from "../../event-bus.js";
import { resolveSessionLogPath } from "./history.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { errnoCode } from "../../../lib/error-guards.js";

/** Raised when the non-busy `send()` of a delivered user message fails. Retryable. */
export class UserMessageDeliveryError extends Error {
  constructor() {
    super("User-message delivery send failed");
    this.name = "UserMessageDeliveryError";
  }
}

/**
 * A resolved delivery destination — computed by the caller before cards are
 * written so placement and delivery agree, and persisted so a retry reuses it.
 * `sessionId === null` means "no existing chat resolved; create a fresh session
 * at delivery time" (capture's deep-link case; bulk never passes null).
 */
export interface DeliveryTarget {
  sessionId: string | null;
  /** Box-relative landmark dir of the target chat (drives landing-zone placement). */
  contextDir: string | null;
}

export interface DeliverUserMessageResult {
  sessionId: string | null;
  queued: boolean;
}

/**
 * At-most-once probe: has a message pointing at `docPath` already landed in the
 * target chat's transcript? Used on a mid-delivery resume to avoid re-sending a
 * message whose `send()` resolved before the `delivered` marker was persisted.
 * The `doc` path is unique per batch/capture (it carries the staging id +
 * timestamp), so a bare substring match on the JSONL is a reliable
 * landed-signal — bare, not `doc="…"`, because the transcript stores the message
 * as a JSON string where the wrapper's quotes are backslash-escaped. A `null`
 * session (a fresh session that never got an id persisted) can't be probed → false.
 */
export async function userMessageAlreadyLanded(opts: {
  boxRoot: string;
  sessionId: string | null;
  docPath: string;
  logPrefix?: string;
}): Promise<boolean> {
  const { boxRoot, sessionId, docPath } = opts;
  const logPrefix = opts.logPrefix ?? "chat";
  if (sessionId === null) return false;
  const logPath = await resolveSessionLogPath(boxRoot, sessionId);
  try {
    // Stream line by line with an early return — the target chat is the
    // most-active session by construction, i.e. the biggest transcript on the
    // box, and reading it whole is the allocation class that OOM'd prod
    // (2026-08-01). `docPath` sits inside a single JSONL line, so a per-line
    // match is equivalent to a whole-file match.
    const fileStream = createReadStream(logPath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (line.includes(docPath)) return true;
      }
    } finally {
      rl.close();
      fileStream.destroy();
    }
    return false;
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`[${logPrefix}] Could not read transcript ${logPath} for at-most-once probe:`, e);
    }
    return false;
  }
}

/**
 * Deliver a prepared user message into a chat session against a pre-resolved
 * {@link DeliveryTarget}. Emits `chat-user-message` for the pending UI, then
 * enqueues (agent busy) or awaits `send()`. A failed non-busy send throws
 * {@link UserMessageDeliveryError} so the caller can record its retryable state.
 *
 * For a fresh session (`target.sessionId === null`) the real id is assigned
 * asynchronously by the backend; `onSessionResolved` fires once it lands so the
 * caller can persist it (a retry then reuses the session instead of orphaning a
 * new one each attempt).
 */
export async function deliverUserMessage(opts: {
  boxRoot: string;
  registry: ChatSessionRegistry;
  eventBus: EventBus;
  wireSession?: ((session: ChatSession) => void) | undefined;
  target: DeliveryTarget;
  /** The wrapper message body (`<capture>`, `<upload>`, …). */
  message: string;
  onSessionResolved?: ((sessionId: string) => void | Promise<void>) | undefined;
  /** Console-log prefix for this delivery kind (e.g. "capture", "bulk"). */
  logPrefix?: string;
}): Promise<DeliverUserMessageResult> {
  const { boxRoot, registry, eventBus, wireSession, target, message, onSessionResolved } = opts;
  const logPrefix = opts.logPrefix ?? "chat";

  let session: ChatSession;
  let id: string | null;
  if (target.sessionId !== null) {
    session = registry.getOrCreate(target.sessionId);
    id = target.sessionId;
  } else {
    session = registry.createNew(
      target.contextDir !== null && target.contextDir !== "" ? { contextDir: target.contextDir } : {},
    );
    id = null;
    // The fresh session's id arrives asynchronously via the registry's
    // `session-assigned` event; persist it the moment it matches this exact
    // session object (guarded so duck-typed test-double registries without an
    // event emitter are a no-op).
    if (onSessionResolved && typeof registry.on === "function") {
      const handler = (payload: { sessionId: string }): void => {
        if (session.getSessionId() !== payload.sessionId) return;
        registry.off("session-assigned", handler);
        void Promise.resolve(onSessionResolved(payload.sessionId)).catch((e: unknown) => {
          console.error(`[${logPrefix}] Persisting resolved target ${payload.sessionId} failed:`, e);
        });
      };
      registry.on("session-assigned", handler);
    }
  }
  wireSession?.(session);

  if (id !== null && onSessionResolved) {
    await onSessionResolved(id);
  }

  eventBus.emit("chat-user-message", {
    sessionId: id,
    message,
    user: null,
    timestamp: getBoxTimeISO(boxRoot),
  });

  if (session.isBusy()) {
    session.enqueue({ text: message });
    return { sessionId: id, queued: true };
  }

  if (id !== null) {
    registry.enforceLiveCap(id);
    registry.touch(id, { subprocessUse: true });
    void registry.markMostActive(id).catch((e: unknown) => {
      console.error(`[${logPrefix}] markMostActive(${id}) failed:`, e);
    });
  }

  const sent = await session.send({ text: message });
  if (!sent) throw new UserMessageDeliveryError();
  return { sessionId: session.getSessionId(), queued: false };
}

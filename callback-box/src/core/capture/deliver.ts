/**
 * Capture delivery — inject a prepared capture as a first-class user message
 * into a chat session, and the `<capture>` wrapper that message carries.
 *
 * Modeled on the self-note route's resolve-target → busy? enqueue : send shape
 * (`chat-send-routes.ts`), but with the differences the capture-mode plan calls
 * for: it creates a session when none resolves (self-note 404s there), emits the
 * events the pending UI consumes, and awaits the non-busy `send()` so a failure
 * is recorded retryably (a `CaptureDeliveryError` the worker maps to
 * `failed:deliver`) rather than fire-and-forgotten.
 */

import type { ChatSession } from "../chat/session/index.js";
import type { ChatSessionRegistry } from "../chat/session/registry.js";
import type { EventBus } from "../event-bus.js";
import { loadHistory, getMostActive } from "../chat/session/history.js";
import { getBoxTimeISO } from "../../lib/time.js";

/** Raised when the non-busy `send()` of a capture message fails. Retryable. */
export class CaptureDeliveryError extends Error {
  constructor() {
    super("Capture delivery send failed");
    this.name = "CaptureDeliveryError";
  }
}

/** Format a total seconds count as `M:SS` for the wrapper's `audio` attr. */
function formatAudioDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Build the `<capture …>` chat-message wrapper (a first-class user message
 * pointing at the committed capture document). Pure — the exact string is a
 * chat-vocabulary lock-in, doctested exact.
 */
export function buildCaptureWrapper(opts: {
  /** Box-relative path of the capture-session card. */
  docPath: string;
  imageCount: number;
  audioSeconds: number;
  summary: string;
  partial?: boolean;
  transcriptionFailed?: boolean;
}): string {
  const attrs = [
    `doc="${opts.docPath}"`,
    `images="${String(opts.imageCount)}"`,
    `audio="${formatAudioDuration(opts.audioSeconds)}"`,
  ];
  if (opts.partial === true) attrs.push("partial=\"1\"");
  if (opts.transcriptionFailed === true) attrs.push("transcription-failed=\"1\"");
  return `<capture ${attrs.join(" ")}>\n${opts.summary.trim()}\n</capture>`;
}

/** First sentence of a transcript, or the whole trimmed text if no boundary. */
function firstSentence(text: string | undefined): string | null {
  if (text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const match = /^(.*?[!.?])(?:\s|$)/s.exec(trimmed);
  return match ? match[1]! : trimmed;
}

/**
 * The one-line capture summary: first transcript sentence, else "N photos",
 * else the first uploaded file's name, else a generic label.
 */
export function summarizeCapture(opts: {
  firstTranscript?: string | undefined;
  imageCount: number;
  firstFileName?: string | undefined;
}): string {
  const sentence = firstSentence(opts.firstTranscript);
  if (sentence !== null) return sentence;
  if (opts.imageCount > 0) return `${String(opts.imageCount)} photo${opts.imageCount === 1 ? "" : "s"}`;
  if (opts.firstFileName !== undefined && opts.firstFileName.length > 0) return opts.firstFileName;
  return "capture";
}

/**
 * Resolve the delivery target: the staging session's `targetSessionId` if that
 * chat is still known to this box, else the most-active session, else a fresh
 * session (never 404s). Returns the session and its id (`null` for a fresh
 * pre-assignment session).
 */
async function resolveDeliveryTarget(opts: {
  boxRoot: string;
  registry: ChatSessionRegistry;
  targetSessionId: string | null;
  contextDir: string | null;
}): Promise<{ session: ChatSession; id: string | null }> {
  const { boxRoot, registry, targetSessionId, contextDir } = opts;
  if (targetSessionId !== null) {
    const known = await loadHistory(boxRoot);
    if (known.includes(targetSessionId)) {
      return { session: registry.getOrCreate(targetSessionId), id: targetSessionId };
    }
  }
  const mostActive = await getMostActive(boxRoot);
  if (mostActive !== null) {
    return { session: registry.getOrCreate(mostActive), id: mostActive };
  }
  const session = registry.createNew(
    contextDir !== null && contextDir !== "" ? { contextDir } : {},
  );
  return { session, id: null };
}

export interface DeliverCaptureResult {
  sessionId: string | null;
  queued: boolean;
}

/**
 * Deliver a prepared capture message into a chat session. Emits
 * `chat-user-message` for the pending UI, then enqueues (if the agent is busy)
 * or awaits `send()`. A failed non-busy send throws {@link CaptureDeliveryError}
 * so the caller can record `failed:deliver`.
 */
export async function deliverCaptureMessage(opts: {
  boxRoot: string;
  registry: ChatSessionRegistry;
  eventBus: EventBus;
  wireSession?: ((session: ChatSession) => void) | undefined;
  targetSessionId: string | null;
  contextDir: string | null;
  /** The `<capture>` wrapper message body. */
  message: string;
}): Promise<DeliverCaptureResult> {
  const { boxRoot, registry, eventBus, wireSession, targetSessionId, contextDir, message } = opts;

  const { session, id } = await resolveDeliveryTarget({
    boxRoot,
    registry,
    targetSessionId,
    contextDir,
  });
  wireSession?.(session);

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
      console.error(`[capture] markMostActive(${id}) failed:`, e);
    });
  }

  const sent = await session.send({ text: message });
  if (!sent) throw new CaptureDeliveryError();
  return { sessionId: session.getSessionId(), queued: false };
}

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
import { loadHistory, getMostActive, getDirectoryForSession } from "../chat/session/history.js";
import {
  deliverUserMessage,
  userMessageAlreadyLanded,
  UserMessageDeliveryError,
  type DeliveryTarget,
} from "../chat/session/deliver-user-message.js";
import { invariant } from "../../lib/invariant.js";

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
  // `doc` is a server-generated path (`<contextDir>/tmp-capture/capture-…`);
  // a double quote or newline in it would break the wrapper's attribute
  // parsing. These characters can't occur in the generated basename, and a
  // landmark contextDir carrying one is a broken invariant, not runtime input —
  // fail loudly rather than emit an unparseable message.
  invariant(
    !/[\n\r"]/.test(opts.docPath),
    `Capture doc path contains a quote or newline: ${JSON.stringify(opts.docPath)}`,
  );
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
  return match ? (match[1] ?? trimmed) : trimmed;
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
 * A resolved delivery destination — computed ONCE at the start of preparation
 * (before cards are written) so placement and delivery agree, and persisted so
 * a retry reuses it. Structurally the shared {@link DeliveryTarget}.
 * `sessionId === null` means "no existing chat resolved; create a fresh session
 * at delivery time".
 */
export type CaptureDeliveryTarget = DeliveryTarget;

/**
 * Resolve where a capture should be delivered, purely from on-disk state (no
 * session is created here): the staging session's `targetSessionId` if that
 * chat is still known to this box, else the most-active session, else "create a
 * fresh session" (`sessionId: null`). Never 404s.
 */
export async function resolveCaptureDeliveryTarget(opts: {
  boxRoot: string;
  targetSessionId: string | null;
}): Promise<CaptureDeliveryTarget> {
  const { boxRoot, targetSessionId } = opts;
  if (targetSessionId !== null) {
    const known = await loadHistory(boxRoot);
    if (known.includes(targetSessionId)) {
      return { sessionId: targetSessionId, contextDir: await getDirectoryForSession(boxRoot, targetSessionId) };
    }
    console.warn(
      `[capture] Target chat ${targetSessionId} no longer exists; falling back to the most-active session for box=${boxRoot}`,
    );
  } else {
    // A null target means the capture was started before its chat had a
    // server-assigned id. Delivering to the most-active session can misdirect it
    // to a different chat — log so that misdirection is observable (X1). The
    // client disables the capture affordance until a session exists, so this
    // should only fire for the `/capture` deep link (most-active is expected there).
    console.warn(
      `[capture] Capture has no target session; falling back to the most-active session for box=${boxRoot}`,
    );
  }
  const mostActive = await getMostActive(boxRoot);
  if (mostActive !== null) {
    return { sessionId: mostActive, contextDir: await getDirectoryForSession(boxRoot, mostActive) };
  }
  return { sessionId: null, contextDir: null };
}

/**
 * At-most-once probe: has this capture's `<capture>` message already been
 * recorded in the target chat's transcript? Used on a mid-delivery resume to
 * avoid re-sending a message whose `send()` resolved before we could persist
 * the `delivered` marker. The `doc` path is unique per capture (it carries the
 * staging id + timestamp), so a bare substring match on the JSONL is a reliable
 * landed-signal — bare, not `doc="…"`, because the transcript stores the message
 * as a JSON string where the wrapper's quotes are backslash-escaped. A `null`
 * target (a fresh session that never got an id persisted) can't be probed →
 * false.
 */
export async function captureMessageAlreadyLanded(opts: {
  boxRoot: string;
  sessionId: string | null;
  docPath: string;
}): Promise<boolean> {
  return userMessageAlreadyLanded({ ...opts, logPrefix: "capture" });
}

export interface DeliverCaptureResult {
  sessionId: string | null;
  queued: boolean;
}

/**
 * Deliver a prepared capture message into a chat session, against a
 * pre-resolved {@link CaptureDeliveryTarget}. Emits `chat-user-message` for the
 * pending UI, then enqueues (if the agent is busy) or awaits `send()`. A failed
 * non-busy send throws {@link CaptureDeliveryError} so the caller can record
 * `failed:deliver`.
 *
 * For a fresh session (`target.sessionId === null`) the real id is assigned
 * asynchronously by the backend; `onSessionResolved` fires once it lands so the
 * caller can persist it (a retry then reuses the session instead of orphaning a
 * new one each attempt).
 */
export async function deliverCaptureMessage(opts: {
  boxRoot: string;
  registry: ChatSessionRegistry;
  eventBus: EventBus;
  wireSession?: ((session: ChatSession) => void) | undefined;
  target: CaptureDeliveryTarget;
  /** The `<capture>` wrapper message body. */
  message: string;
  /** Called with the target's session id once known (immediately for an
   *  existing session; on assignment for a freshly-created one). */
  onSessionResolved?: ((sessionId: string) => void | Promise<void>) | undefined;
}): Promise<DeliverCaptureResult> {
  try {
    return await deliverUserMessage({ ...opts, logPrefix: "capture" });
  } catch (e) {
    // Map the shared retryable failure to capture's own error class so the
    // worker's `instanceof CaptureDeliveryError` → `failed:deliver` branch and
    // the existing capture tests stay unchanged.
    if (e instanceof UserMessageDeliveryError) throw new CaptureDeliveryError();
    throw e;
  }
}

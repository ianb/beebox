/**
 * Silent, bounded diagnostics for the chat send -> acceptance -> history path.
 *
 * Routine sends only live in memory. An anomalous receipt or transport event
 * flushes one metadata-only timeline through console.warn, which means the
 * ordinary closed-debug-panel client forwards it to client-debug.log. Never
 * add message text, attachment names/paths, URLs, or raw error strings here.
 */

const MAX_TRACES = 20;
const MAX_EVENTS_PER_TRACE = 24;
const TRACE_RETENTION_MS = 10 * 60_000;
const SLOW_RECEIPT_MS = 5_000;
const MAX_PAYLOAD_CHARS = 3_600;

type DiagnosticValue = string | number | boolean | null;

export type ChatSendReasonKind = "timeout" | "superseded" | "no-turn-id" | "malformed-response" | "network" | "other";
type ReceiptDisposition = "sent" | "queued" | "rejected";
type TurnFrameKind = "msg" | "resync" | "error";

export type ChatSendDiagnosticEvent =
  | { event: "post-issued"; detail: { attempt: number } }
  | { event: "post-http-response"; detail: { attempt: number; status: number } }
  | { event: "post-retry-scheduled"; detail: { reasonKind: "network"; delayMs: number } }
  | { event: "post-error"; detail: { reasonKind: ChatSendReasonKind } }
  | { event: "post-response"; detail: { outcome: "deduplicated" | "queued" | "turn-started" | "empty" } }
  | { event: "receipt-pending"; detail: { elapsedMs: number } }
  | { event: "receipt-settled"; detail: { disposition: ReceiptDisposition; reasonKind?: ChatSendReasonKind } }
  | { event: "turn-stream-frame"; detail: { frame: TurnFrameKind; frameNumber: number } }
  | { event: "turn-stream-error"; detail: { errorLength: number } }
  | { event: "turn-stream-complete"; detail: { terminalFired: boolean } };

interface DiagnosticEvent {
  event: string;
  tMs: number;
  visibility: string;
  online: boolean | null;
  detail?: Record<string, DiagnosticValue>;
}

interface SendTrace {
  emissionId: string;
  startedAt: number;
  expiresAt: number;
  events: DiagnosticEvent[];
  initialFlushed: boolean;
  terminalFlushed: boolean;
  historyFlushed: boolean;
  historyObserved: boolean;
}

const traces = new Map<string, SendTrace>();
let listenersInstalled = false;

function now(): number {
  return Date.now();
}

function visibility(): string {
  return typeof document === "undefined"
    ? "unavailable"
    : document.visibilityState;
}

function online(): boolean | null {
  return typeof navigator === "undefined" ? null : navigator.onLine;
}

function trim(at?: number): void {
  const currentTime = at ?? now();
  for (const [id, trace] of traces) {
    if (trace.expiresAt <= currentTime) traces.delete(id);
  }
  while (traces.size > MAX_TRACES) {
    const oldest = traces.keys().next();
    if (oldest.done) break;
    traces.delete(oldest.value);
  }
}

function append(
  trace: SendTrace,
  input: { event: string; detail?: Record<string, DiagnosticValue> },
): void {
  trace.events.push({
    event: input.event,
    tMs: Math.max(0, now() - trace.startedAt),
    visibility: visibility(),
    online: online(),
    ...(input.detail === undefined ? {} : { detail: input.detail }),
  });
  if (trace.events.length > MAX_EVENTS_PER_TRACE) {
    trace.events.splice(trace.events[0]?.event === "dispatch" ? 1 : 0, 1);
  }
}

function recordEnvironment(event: "visibility-change" | "network-online" | "network-offline" | "page-hide" | "bus-ws-connect" | "bus-ws-error"): void {
  trim();
  for (const trace of traces.values()) {
    append(trace, { event });
  }
}

function installEnvironmentListeners(): void {
  if (
    listenersInstalled ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  )
    return;
  listenersInstalled = true;
  document.addEventListener("visibilitychange", () =>
    recordEnvironment("visibility-change"),
  );
  window.addEventListener("online", () => recordEnvironment("network-online"));
  window.addEventListener("offline", () =>
    recordEnvironment("network-offline"),
  );
  window.addEventListener("pagehide", () => recordEnvironment("page-hide"));
}

function flush(trace: SendTrace, input: { trigger: string; phase: "initial" | "terminal" | "history" }): void {
  const { trigger, phase } = input;
  if (phase === "initial") trace.initialFlushed = true;
  else if (phase === "terminal") trace.terminalFlushed = true;
  else trace.historyFlushed = true;
  const events = [...trace.events];
  let eventsOmitted = 0;
  const serialize = (): string => JSON.stringify({
      version: 1,
      emissionId: trace.emissionId,
      trigger,
      phase: phase === "history" ? "follow-up" : phase,
      elapsedMs: Math.max(0, now() - trace.startedAt),
      ...(eventsOmitted === 0 ? {} : { eventsOmitted }),
      events,
    });
  let payload = serialize();
  while (payload.length > MAX_PAYLOAD_CHARS && events.length > 2) {
    events.splice(1, 1);
    eventsOmitted++;
    payload = serialize();
  }
  console.warn(`[chat-send-diagnostic] ${payload}`);
}

export function beginChatSendDiagnostic(input: {
  emissionId: string;
  origin: "typed" | "voice";
  textLength: number;
  imageCount: number;
  fileCount: number;
  selectionCount: number;
}): void {
  installEnvironmentListeners();
  trim();
  const startedAt = now();
  const trace: SendTrace = {
    emissionId: input.emissionId,
    startedAt,
    expiresAt: startedAt + TRACE_RETENTION_MS,
    events: [],
    initialFlushed: false,
    terminalFlushed: false,
    historyFlushed: false,
    historyObserved: false,
  };
  traces.delete(input.emissionId);
  traces.set(input.emissionId, trace);
  append(trace, {
    event: "dispatch",
    detail: {
      origin: input.origin,
      textLength: input.textLength,
      imageCount: input.imageCount,
      fileCount: input.fileCount,
      selectionCount: input.selectionCount,
    },
  });
  trim(startedAt);
}

export function recordChatSendEvent(
  emissionId: string,
  input: ChatSendDiagnosticEvent,
): void {
  const trace = traces.get(emissionId);
  if (trace === undefined) return;
  if (input.event === "turn-stream-frame") {
    const progress = trace.events.find((event) => event.event === "turn-stream-progress");
    if (progress?.detail !== undefined) {
      progress.detail.frameCount = input.detail.frameNumber;
      progress.detail.lastFrame = input.detail.frame;
      progress.detail.lastFrameAtMs = Math.max(0, now() - trace.startedAt);
    } else {
      append(trace, { event: "turn-stream-progress", detail: {
        frameCount: input.detail.frameNumber, lastFrame: input.detail.frame,
        lastFrameAtMs: Math.max(0, now() - trace.startedAt) } });
    }
    return;
  }
  append(trace, input);
  const initial = input.event === "post-retry-scheduled" || input.event === "receipt-pending";
  const terminal = input.event === "post-error" || input.event === "turn-stream-error" ||
    (input.event === "turn-stream-complete" && !input.detail.terminalFired) ||
    (input.event === "receipt-settled" && input.detail.disposition === "rejected");
  if (initial && !trace.initialFlushed) flush(trace, { trigger: input.event, phase: "initial" });
  if (terminal && !trace.terminalFlushed) flush(trace, { trigger: input.event, phase: "terminal" });
}

export function recordChatSendEnvironmentEvent(
  event: "bus-ws-connect" | "bus-ws-error",
): void {
  recordEnvironment(event);
}

export function observeChatSendReceipt(input: {
  emissionId: string;
  disposition: ReceiptDisposition;
  reasonKind?: ChatSendReasonKind;
}): void {
  const trace = traces.get(input.emissionId);
  if (trace === undefined) return;
  append(trace, {
    event: "receipt-observed",
    detail: {
      disposition: input.disposition,
      ...(input.reasonKind === undefined
        ? {}
        : { reasonKind: input.reasonKind }),
    },
  });
  const elapsed = now() - trace.startedAt;
  if (input.disposition === "rejected" && !trace.terminalFlushed) {
    flush(trace, { trigger: "receipt-rejected", phase: "terminal" });
  } else if (elapsed >= SLOW_RECEIPT_MS && !trace.initialFlushed) {
    flush(trace, { trigger: "receipt-slow", phase: "initial" });
  }
}

export function observeChatSendHistory(emissionIds: readonly string[]): void {
  for (const emissionId of emissionIds) {
    const trace = traces.get(emissionId);
    if (trace === undefined) continue;
    append(trace, { event: "durable-history-observed" });
    trace.historyObserved = true;
    if ((trace.initialFlushed || trace.terminalFlushed) && !trace.historyFlushed) {
      flush(trace, { trigger: "history-after-anomaly", phase: "history" });
    }
  }
}

export function chatSendReasonKind(reason: string): ChatSendReasonKind {
  const lower = reason.toLowerCase();
  if (lower.includes("timeout")) return "timeout";
  if (lower.includes("superseded")) return "superseded";
  if (lower.includes("no turn id")) return "no-turn-id";
  if (lower.includes("malformed")) return "malformed-response";
  if (lower.includes("network") || lower.includes("fetch")) return "network";
  return "other";
}

/** Test seams for the framework-free doctest. */
export function resetChatSendDiagnostics(): void {
  traces.clear();
}

export function inspectChatSendDiagnostic(
  emissionId: string,
): readonly DiagnosticEvent[] {
  return traces.get(emissionId)?.events ?? [];
}

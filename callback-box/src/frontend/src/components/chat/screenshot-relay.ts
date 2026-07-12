/**
 * Page side of the clerk extension's capture relay (Track C). The clerk injects
 * a content script into enabled box pages that can answer a silent
 * `chrome.tabs.captureVisibleTab` — no getDisplayMedia picker. This module is
 * the app half of that `window.postMessage` protocol: a handshake to detect the
 * relay, then a correlated capture request/response.
 *
 * Protocol (must match the shipped clerk content script EXACTLY):
 *   app → relay : { source: "callback-box-app",    type: "relay-ping" }
 *                 { source: "callback-box-app",    type: "capture-request", correlationId }
 *   relay → app : { source: "callback-clerk-relay", type: "relay-ready" }
 *                 { source: "callback-clerk-relay", type: "capture-response", correlationId, result }
 * where `result` is `{ ok: true, dataUrl }` or
 * `{ ok: false, reason, message? }`.
 *
 * Every degraded path (relay absent, `ok: false`, timeout, malformed message)
 * returns `null` from {@link captureViaRelay} so the caller falls through to the
 * consent popup — never silent, because the popup is the visible fallback.
 *
 * Presence is cached module-level (not React state — the chat CLAUDE.md scroll/
 * store invariants forbid new root state): {@link startRelayProbe} pings once at
 * mount so a later capture pays no handshake latency, and a capture re-probes if
 * the relay was never seen (extension installed mid-session).
 */

import { isRecord } from "@shared/is-record";
import { base64ToBlob } from "../../lib/image-paste";
import type { CaptureOutcome } from "./screenshot-capture";

const APP_SOURCE = "callback-box-app";
const RELAY_SOURCE = "callback-clerk-relay";

/** How long to wait for a `relay-ready` before treating the relay as absent. */
const HANDSHAKE_TIMEOUT_MS = 3000;
/** How long to wait for a `capture-response` before giving up (→ popup fallback). */
const CAPTURE_TIMEOUT_MS = 3000;

/** A relay capture answer, once validated at the postMessage boundary. */
type RelayCaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: string; message?: string };

// Module-level relay state. A single `message` listener multiplexes the
// handshake and every in-flight capture; `relaySeen` latches true on the first
// `relay-ready` so presence checks are free thereafter.
let listenerInstalled = false;
let relaySeen = false;
const presenceWaiters = new Set<() => void>();
const pendingCaptures = new Map<string, (result: RelayCaptureResult) => void>();

/** Validate the `result` field of a `capture-response` at the trust boundary. */
function parseCaptureResult(raw: unknown): RelayCaptureResult | null {
  if (!isRecord(raw)) return null;
  if (raw.ok === true) {
    return typeof raw.dataUrl === "string" ? { ok: true, dataUrl: raw.dataUrl } : null;
  }
  if (raw.ok === false && typeof raw.reason === "string") {
    return typeof raw.message === "string"
      ? { ok: false, reason: raw.reason, message: raw.message }
      : { ok: false, reason: raw.reason };
  }
  return null;
}

function handleRelayMessage(event: MessageEvent): void {
  // Only same-window, same-origin messages tagged as the relay's are trusted.
  if (event.source !== window || event.origin !== location.origin) return;
  const data: unknown = event.data;
  if (!isRecord(data) || data.source !== RELAY_SOURCE) return;

  if (data.type === "relay-ready") {
    relaySeen = true;
    for (const waiter of [...presenceWaiters]) waiter();
    presenceWaiters.clear();
    return;
  }

  if (data.type === "capture-response" && typeof data.correlationId === "string") {
    const resolve = pendingCaptures.get(data.correlationId);
    if (!resolve) return;
    const result = parseCaptureResult(data.result);
    if (result === null) return; // malformed → let the caller's timeout fire → popup
    pendingCaptures.delete(data.correlationId);
    resolve(result);
  }
}

function ensureListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  window.addEventListener("message", handleRelayMessage);
}

function postToRelay(message: Record<string, unknown>): void {
  window.postMessage({ source: APP_SOURCE, ...message }, location.origin);
}

/**
 * Begin probing for the relay. Idempotent — installs the listener once and posts
 * a ping. Call at feature mount so `relaySeen` is likely already latched by the
 * time a capture request arrives. Handles both injection orderings: the relay
 * posts `relay-ready` on its own load AND in reply to this ping.
 */
export function startRelayProbe(): void {
  if (typeof window === "undefined") return;
  ensureListener();
  postToRelay({ type: "relay-ping" });
}

/** Resolve true once the relay is known present, or false after a re-probe times out. */
function awaitRelayPresence(): Promise<boolean> {
  if (relaySeen) return Promise.resolve(true);
  ensureListener();
  return new Promise((resolve) => {
    let settled = false;
    const done = (present: boolean): void => {
      if (settled) return;
      settled = true;
      presenceWaiters.delete(waiter);
      resolve(present);
    };
    const waiter = (): void => done(true);
    presenceWaiters.add(waiter);
    postToRelay({ type: "relay-ping" });
    setTimeout(() => done(false), HANDSHAKE_TIMEOUT_MS);
  });
}

/** Post a capture request and await its correlated response, or null on timeout. */
function requestCapture(): Promise<RelayCaptureResult | null> {
  const correlationId = crypto.randomUUID();
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: RelayCaptureResult | null): void => {
      if (settled) return;
      settled = true;
      pendingCaptures.delete(correlationId);
      resolve(result);
    };
    pendingCaptures.set(correlationId, done);
    postToRelay({ type: "capture-request", correlationId });
    setTimeout(() => done(null), CAPTURE_TIMEOUT_MS);
  });
}

/** Decode a `data:image/...;base64,...` PNG URL into a raw Blob, or null if malformed. */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) return null;
  const header = dataUrl.slice(5, comma); // e.g. "image/png;base64"
  if (!header.endsWith(";base64")) return null;
  const mimeType = header.slice(0, -";base64".length) || "image/png";
  try {
    return base64ToBlob(dataUrl.slice(comma + 1), mimeType);
  } catch (e) {
    console.warn(`[screenshot] relay dataUrl decode failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Try the extension relay for a silent capture. Returns a raw-PNG
 * {@link CaptureOutcome} on success (the caller runs it through the same 1920px
 * downscale as every other capture — one pipeline), or null on ANY degraded
 * path (relay absent, `ok: false`, timeout, malformed) so the caller shows the
 * consent popup. Viewport is best-effort from the window, matching Track A.
 */
export async function captureViaRelay(): Promise<CaptureOutcome | null> {
  if (typeof window === "undefined") return null;
  if (!(await awaitRelayPresence())) return null;

  const result = await requestCapture();
  if (result === null || !result.ok) return null; // popup fallback — visible, never silent

  const blob = dataUrlToBlob(result.dataUrl);
  if (blob === null) return null;

  return {
    kind: "image",
    blob,
    viewport: {
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    },
  };
}

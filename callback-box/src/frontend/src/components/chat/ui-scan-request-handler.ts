/**
 * Browser side of an agent-initiated `cb chat ui` (Track 3).
 *
 * The agent runs the CLI; the server broadcasts a transient `ui-scan-request`
 * bus event carrying the target chat session and an `expiresAt` deadline. The
 * tab holding *exactly* that session acks (closing the server's `no-client`
 * window), scans its live document, and posts the inventory.
 *
 * No consent prompt, on purpose — unlike a screenshot, which captures whatever
 * content is on screen, this returns chrome: roles, control labels and
 * author-written descriptions, plus the few user-derived strings (session
 * title, box name, open tab labels) the agent already receives through
 * `open-card` and the session it is running in. The plan
 * (`docs/plans/agent-points-at-ui.md`, Track 3 "No consent prompt") records
 * this as a judgment call the boxholder should confirm; if the answer comes
 * back the other way, the popup belongs here, queued the way
 * `screenshot-request-handler.ts` queues its own.
 *
 * There is no React state and no view, so this is a plain module function
 * called straight from the WS dispatcher (like `fulfillLastAudioRequest`)
 * rather than a hook.
 */

import { getApiBase } from "../../api-core";
import { scanLiveDocument } from "../../lib/ui-scan/live-dom";
import { currentChatChannel } from "../../lib/chat-channel";
import { isNativeShell } from "./native-post";
import { isRequestExpired, matchesRequestSession } from "./screenshot-request-logic";
import type { UiScanCoverage, UiScanEntry, UiScanPayload } from "@shared/ui-scan";

/** A live UI-scan request for this tab — the transient `ui-scan-request` payload. */
export interface UiScanRequest {
  requestId: string;
  session: string;
  expiresAt: string;
}

function answerUrl(requestId: string): string {
  return `${getApiBase()}/chat/ui/${encodeURIComponent(requestId)}`;
}

/**
 * POST a JSON answer. A 404 is the normal multi-tab or settled-request outcome
 * (another tab won, or the CLI aborted) — quiet. Never rejects: logs and
 * returns, so callers can fire-and-forget.
 */
async function postJson(requestId: string, { body, label }: { body: object; label: string }): Promise<void> {
  try {
    const res = await fetch(answerUrl(requestId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`[ui-scan] ${label} rejected: HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`[ui-scan] ${label} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * How much of the surface this client can actually see. The web page is the
 * whole surface in a browser; inside the native shell the composer, mic,
 * capture and box switcher are native chrome this scan cannot reach, so the
 * dump has to say so rather than imply they do not exist. Track 5 replaces the
 * `dom-native-unavailable` branch with a bridge round-trip that merges the
 * native inventory and reports `dom+native`; this is the seam.
 */
function currentCoverage(): UiScanCoverage {
  return isNativeShell() ? "dom-native-unavailable" : "dom";
}

/** Path + query of the page being scanned — never the origin. */
function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Scan the live document and shape it as the wire payload. */
function buildPayload(): UiScanPayload {
  const scan = scanLiveDocument();
  // The scan's own entry type is assigned into the wire type here, so a drift
  // between `ui-scan/types.ts` and `shared/ui-scan.ts` is a compile error at
  // this line rather than a 400 at the route.
  const entries: UiScanEntry[] = scan.entries;
  return {
    entries,
    omittedUnnamed: scan.omittedUnnamed,
    omittedUnknownRole: scan.omittedUnknownRole,
    duplicateIds: scan.duplicateIds,
    truncated: scan.truncated,
    coverage: currentCoverage(),
    channel: currentChatChannel(),
    url: currentUrl(),
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Answer a request that targets this tab's session: ack, scan, post. A thrown
 * scan (a DOM the walk could not read) is reported to the agent as `failed`
 * rather than left to time out — a reason beats silence.
 */
export async function fulfillUiScanRequest(
  request: UiScanRequest,
  viewSession: string | null
): Promise<void> {
  if (!matchesRequestSession(request.session, viewSession)) return;
  if (isRequestExpired(request.expiresAt, Date.now())) return;
  await postJson(request.requestId, { body: { ack: true }, label: "ack" });
  let payload: UiScanPayload;
  try {
    payload = buildPayload();
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(`[ui-scan] scan failed: ${reason}`);
    await postJson(request.requestId, { body: { failed: reason }, label: "failure" });
    return;
  }
  await postJson(request.requestId, { body: payload, label: "scan" });
}

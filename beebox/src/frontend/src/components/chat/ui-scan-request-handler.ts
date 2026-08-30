/**
 * Browser side of an agent-initiated `bbx chat ui` (Track 3).
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
 * `open-card` and the session it is running in. "Chrome" is enforced, not
 * hoped for: the transcript, the open card and every other content region is
 * marked `data-bbx-scan="exclude"` and pruned from the walk
 * (`lib/ui-scan/scan.ts`, `SCAN_BOUNDARY_ATTRIBUTE`), so the links and buttons
 * inside the user's own content never reach this payload. The plan
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
import { windowNativeControlBridge } from "./native-command-bridge";
import {
  NATIVE_SCAN_TIMEOUT_MS,
  nativeScanEntries,
  requestNativeControls,
} from "./native-control-scan";
import type { NativeControlEntry } from "./native-composer-command";
import { isRequestExpired, matchesRequestSession } from "./screenshot-request-logic";
import { MAX_SCAN_ENTRIES } from "@shared/ui-scan";
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
 * What became of one POSTed answer. `rejected` is the case that matters: the
 * request has already been acked, so a silently-dropped rejection leaves the
 * agent waiting out the clock and reading `timeout` for what was really a
 * validation failure.
 */
type PostOutcome = "delivered" | "settled-elsewhere" | "rejected";

/**
 * POST a JSON answer. A 404 is the normal multi-tab or settled-request outcome
 * (another tab won, or the CLI aborted) — quiet. Never rejects: logs and
 * reports the outcome, so callers can fire-and-forget or react.
 */
async function postJson(requestId: string, { body, label }: { body: object; label: string }): Promise<PostOutcome> {
  try {
    const res = await fetch(answerUrl(requestId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return "delivered";
    if (res.status === 404) return "settled-elsewhere";
    console.warn(`[ui-scan] ${label} rejected: HTTP ${res.status}`);
    return "rejected";
  } catch (e) {
    console.warn(`[ui-scan] ${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    return "rejected";
  }
}

/**
 * How much of the surface this client saw. The web page is the whole surface in
 * a browser; inside the native shell the composer, mic, capture and box switcher
 * are native chrome the DOM walk cannot reach, so either the shell answered and
 * its controls are in the list, or the dump says out loud that they are missing.
 * `null` from the bridge covers every failure — no answer, a refusal, or an
 * installed build too old to decode the request.
 */
function coverageFor(native: readonly NativeControlEntry[] | null): UiScanCoverage {
  if (!isNativeShell()) return "dom";
  return native === null ? "dom-native-unavailable" : "dom+native";
}

/** Path + query of the page being scanned — never the origin. */
function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * DOM entries plus the native block, capped at what the route accepts.
 *
 * The native block wins the cap: on a phone it is the half the agent cannot get
 * any other way, and the DOM half is a transcript. Dropping DOM entries sets
 * `truncated`, which the dump prints, so the shortening is stated rather than
 * silent.
 */
function mergeEntries(
  dom: readonly UiScanEntry[],
  native: readonly NativeControlEntry[] | null
): { entries: UiScanEntry[]; truncated: boolean } {
  const nativeEntries = native === null ? [] : nativeScanEntries(native);
  const room = Math.max(0, MAX_SCAN_ENTRIES - nativeEntries.length);
  const kept = dom.slice(0, room);
  return { entries: [...kept, ...nativeEntries], truncated: kept.length < dom.length };
}

/** Scan the live document, fold in the native inventory, shape it as the wire payload. */
function buildPayload(native: NativeControlEntry[] | null): UiScanPayload {
  const scan = scanLiveDocument();
  // The scan's own entry type is assigned into the wire type here, so a drift
  // between `ui-scan/types.ts` and `shared/ui-scan.ts` is a compile error at
  // this line rather than a 400 at the route.
  const domEntries: UiScanEntry[] = scan.entries;
  const merged = mergeEntries(domEntries, native);
  return {
    entries: merged.entries,
    omittedUnnamed: scan.omittedUnnamed,
    omittedUnknownRole: scan.omittedUnknownRole,
    // The walk finds every duplicate; the wire caps the list at the same size
    // as the entry cap, so a pathological page reports the first N rather than
    // producing a payload the route refuses whole.
    duplicateIds: scan.duplicateIds.slice(0, MAX_SCAN_ENTRIES),
    truncated: scan.truncated || merged.truncated,
    coverage: coverageFor(native),
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
  // Ask the shell first and let the DOM walk happen after the answer: the walk
  // is synchronous and would otherwise delay the post by its own duration,
  // eating into the shell's window.
  const native = isNativeShell()
    ? await requestNativeControls(windowNativeControlBridge(), {
        commandId: crypto.randomUUID(),
        timeoutMs: NATIVE_SCAN_TIMEOUT_MS,
      })
    : null;
  let payload: UiScanPayload;
  try {
    payload = buildPayload(native);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(`[ui-scan] scan failed: ${reason}`);
    await postJson(request.requestId, { body: { failed: reason }, label: "failure" });
    return;
  }
  const outcome = await postJson(request.requestId, { body: payload, label: "scan" });
  if (outcome === "rejected") {
    // The ack already closed the server's `no-client` window, so saying nothing
    // here would surface as `timeout` — the wrong diagnosis. Tell the agent the
    // scan was refused instead. (A second rejection has nowhere left to go.)
    await postJson(request.requestId, {
      body: { failed: "the server rejected this client's scan payload" },
      label: "failure",
    });
  }
}

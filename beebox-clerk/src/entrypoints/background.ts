// Service worker: routes popup/context-menu actions into the active box
// via the clerk API. Box association lives in the popup (Track B).
import { getActiveBox, type EnabledBox } from "../domain/config.js";
import {
  isClerkMessage,
  type ActionFailure,
  type ActionResponse,
  type ClerkMessage,
} from "../domain/messages.js";
import {
  buildCommentaryPayload,
  commentaryOpenUrl,
  type CommentaryCapture,
} from "../domain/commentary.js";
import { isCaptureResultMessage } from "../domain/capture-messages.js";
import {
  captureErrorReason,
  isUrlUnderBoxUrl,
} from "../domain/relay-auth.js";
import {
  isRelayCaptureMessage,
  isRelayTabArrangementMessage,
  type CaptureResult,
  type RelayTabArrangementMessage,
  type TabArrangementResult,
} from "../domain/relay-messages.js";
import { ClerkApiError, postCommentary } from "../platform/clerk-api.js";
import { loadConfig } from "../platform/config-storage.js";
import { syncRelayRegistration } from "../platform/relay-registration.js";
import {
  latestTransferForBox,
  openTabOrganizer,
  shareTabs,
} from "../platform/tab-transfer-actions.js";
import { clearTabTransfer } from "../platform/tab-transfer-storage.js";
import { tabArrangementAction } from "../platform/tab-arrangement-executor.js";

class NoActiveBoxError extends Error {
  constructor() {
    super("No box is enabled. Open a Bee Box page and enable it from the popup.");
    this.name = "NoActiveBoxError";
  }
}

async function requireActiveBox(): Promise<EnabledBox> {
  const box = getActiveBox(await loadConfig());
  if (box === null) throw new NoActiveBoxError();
  return box;
}

class CommentUnavailableError extends Error {
  constructor() {
    super("Can't comment on this page — it has no extractable content (e.g. a browser or store page).");
    this.name = "CommentUnavailableError";
  }
}

// The heavy capture code (Defuddle + single-file-core) isn't in any always-on
// content script — inject it into the active tab on demand, then await the
// result it messages back (a file injection can't return a value directly).
// The "comment" click is a user gesture, so activeTab covers the injection.
const CAPTURE_SCRIPT = "content-scripts/commentary-capture.js";
const CAPTURE_TIMEOUT_MS = 60000;

function tryCaptureCommentary(tabId: number): Promise<CommentaryCapture | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: CommentaryCapture | null) => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);
    function listener(message: unknown): void {
      if (!isCaptureResultMessage(message)) return;
      finish("error" in message ? null : message.capture);
    }
    chrome.runtime.onMessage.addListener(listener);

    chrome.scripting
      .executeScript({ target: { tabId }, files: [CAPTURE_SCRIPT] })
      .catch((e: unknown) => {
        // Injection failed (chrome://, Web Store, missing host access, …).
        console.debug("[beebox-clerk] capture injection failed:", e);
        finish(null);
      });
  });
}

async function commentOnPage(tabId: number, destinationDir: string | undefined): Promise<void> {
  // "Comment" runs for several seconds (capture + freeze + upload), during which
  // the popup almost always closes — so its failure response goes nowhere. Make
  // failures visible regardless: log to the service-worker console AND toast the
  // page itself (the same channel context-menu saves use), then rethrow so an
  // open popup still sees it too. This is the difference between a silent no-op
  // and an actionable error.
  try {
    const box = await requireActiveBox();
    // Timed so the cost is visible in the service-worker console: capture is the
    // in-page extract+freeze, post is the upload to the box.
    const tCaptureStart = performance.now();
    const capture = await tryCaptureCommentary(tabId);
    if (capture === null) throw new CommentUnavailableError();
    const tCaptureEnd = performance.now();
    const payload = buildCommentaryPayload({
      page: capture.page,
      frozenHtml: capture.frozenHtml,
      destinationDir: destinationDir ?? null,
      timestamp: new Date().toISOString(),
    });
    const { open } = await postCommentary(box, payload);
    console.info(
      `[clerk] commentOnPage: capture ${Math.round(tCaptureEnd - tCaptureStart)}ms, ` +
        `post ${Math.round(performance.now() - tCaptureEnd)}ms` +
        `${capture.frozenHtml === null ? " (no frozen snapshot)" : ` (frozen ${Math.round(capture.frozenHtml.length / 1024)}kB)`}`,
    );
    await chrome.tabs.create({ url: commentaryOpenUrl(box.boxUrl, open) });
  } catch (e) {
    const failure = failureResponse(e);
    console.error("[beebox-clerk] comment failed:", failure.message);
    toastInTab(tabId, { text: `Comment failed: ${failure.message}`, isError: true });
    throw e;
  }
}

async function dispatch(message: ClerkMessage): Promise<ActionResponse> {
  const box = await requireActiveBox();
  if (message.type === "commentOnPage") {
    await commentOnPage(message.tabId, message.destinationDir);
    return { ok: true };
  }
  if (message.type === "shareTabs") {
    const result = await shareTabs(box, message);
    return { ok: true, result };
  }
  if (message.type === "openTabOrganizer") {
    await openTabOrganizer(box, message.transferId);
    return { ok: true };
  }
  return { ok: true, result: await latestTransferForBox(box) };
}

// Re-reads the live tab record. Returns null if it can't be read (tab closed,
// no host access). NEVER trust `sender.tab.url` for authorization: that field
// is a snapshot from message-send time, and a same-document navigation
// (history.pushState / hash change) can move the tab to a non-enabled sibling
// path on the same origin AFTER the request is sent but BEFORE capture — the
// tab id is unchanged, so a tab-id check would miss it. Authorization must rest
// on the tab's CURRENT url, freshly queried here.
async function liveTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch (e) {
    console.debug("[beebox-clerk] relay capture: tab lookup failed:", e);
    return null;
  }
}

// Handles a relay capture request (Track C). Stateless across messages — MV3
// workers terminate unpredictably, so there is no queue and no in-flight map;
// each request is authorized and answered within this one turn. The sender is
// used ONLY to identify which tab asked; authorization rests on the freshly
// queried tab url matched against the enabled-box list (full origin incl.
// port), never on anything the page asserts or on the send-time url snapshot.
// The before/after active-tab-and-url checks bound capture to the tab that
// asked while it stays on the box. See the plan's trust model and "Known
// residual race".
async function handleRelayCapture(
  sender: chrome.runtime.MessageSender,
): Promise<CaptureResult> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return { ok: false, reason: "error", message: "relay capture: message had no sender tab" };
  }

  const config = await loadConfig();

  // (a) re-query the tab and authorize on its CURRENT url (not the send-time
  // snapshot — see liveTab). It must be under an enabled box's boxUrl AND be
  // its window's active tab (captureVisibleTab has no tabId param — it grabs
  // whatever is active). Remember WHICH box it matched, to re-check the same
  // one after capture.
  const before = await liveTab(tabId);
  const beforeUrl = before?.url;
  if (before === null || beforeUrl === undefined) {
    return { ok: false, reason: "not-capturable" };
  }
  const box = config.boxes.find((b) => isUrlUnderBoxUrl(beforeUrl, b.boxUrl));
  if (box === undefined) return { ok: false, reason: "not-enabled" };
  if (!before.active) return { ok: false, reason: "not-capturable" };

  // (b) capture.
  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(before.windowId, { format: "png" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: captureErrorReason(message), message };
  }

  // (c) re-query and discard the pixels unless the tab is STILL the active tab
  // AND its url is STILL under the SAME box. This catches both a tab switch and
  // a same-document navigation off the box during the capture call. It shrinks
  // but cannot close the switch race (documented residual risk).
  const after = await liveTab(tabId);
  const afterUrl = after?.url;
  if (after === null || afterUrl === undefined || !after.active || !isUrlUnderBoxUrl(afterUrl, box.boxUrl)) {
    return { ok: false, reason: "not-capturable" };
  }

  return { ok: true, dataUrl };
}

async function handleRelayTabArrangement(
  message: RelayTabArrangementMessage,
  sender: chrome.runtime.MessageSender,
): Promise<TabArrangementResult> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return { ok: false, reason: "not-enabled", message: "The request did not come from a browser tab." };
  }
  const current = await liveTab(tabId);
  const currentUrl = current?.url;
  if (currentUrl === undefined) {
    return { ok: false, reason: "not-enabled", message: "The requesting box tab is no longer available." };
  }
  const config = await loadConfig();
  const box = config.boxes.find((candidate) => isUrlUnderBoxUrl(currentUrl, candidate.boxUrl));
  if (box === undefined) {
    return { ok: false, reason: "not-enabled", message: "This page is not an enabled box." };
  }
  return tabArrangementAction({
    action: message.action,
    transferId: message.transferId,
    boxUrl: box.boxUrl,
    proposal: message.proposal,
  });
}

function failureResponse(error: unknown): ActionFailure {
  if (error instanceof ClerkApiError) {
    return { ok: false, status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, status: 0, message };
}

// Runs inside the page via chrome.scripting.executeScript.
function showToast(text: string, background: string): void {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    background,
    color: "white",
    padding: "10px 18px",
    borderRadius: "8px",
    fontSize: "14px",
    fontFamily: "system-ui, sans-serif",
    zIndex: "2147483647",
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    transition: "opacity 0.3s",
  });
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
  }, 2200);
  setTimeout(() => el.remove(), 2600);
}

function toastInTab(tabId: number, params: { text: string; isError: boolean }): void {
  chrome.scripting
    .executeScript({
      target: { tabId },
      func: showToast,
      args: [params.text, params.isError ? "#dc2626" : "#16a34a"],
    })
    .catch((e: unknown) => {
      console.debug("[beebox-clerk] toast skipped:", e);
    });
}

export default defineBackground(() => {
  // eslint-disable-next-line max-params -- Chrome API callback signature
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isRelayCaptureMessage(message)) {
      handleRelayCapture(sender)
        .then(sendResponse)
        .catch((e: unknown) => {
          const errMessage = e instanceof Error ? e.message : String(e);
          sendResponse({ ok: false, reason: "error", message: errMessage });
        });
      return true;
    }
    if (isRelayTabArrangementMessage(message)) {
      handleRelayTabArrangement(message, sender)
        .then(sendResponse)
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          sendResponse({ ok: false, reason: "error", message: detail });
        });
      return true;
    }
    if (!isClerkMessage(message)) return;
    dispatch(message)
      .then(sendResponse)
      .catch((e: unknown) => sendResponse(failureResponse(e)));
    return true;
  });

  // Reconcile the relay content-script registration with the stored config on
  // startup, in case config and registrations drifted (extension update,
  // storage edited while the worker was down, a prior enable that failed to
  // register). syncRelayRegistration is idempotent.
  void loadConfig()
    .then(syncRelayRegistration)
    .catch((e: unknown) => {
      console.error("[beebox-clerk] relay registration sync failed on startup:", e);
    });

  // Numeric Chrome tab IDs do not survive a browser restart. Preserve state
  // across service-worker sleeps, but discard it when the browser itself starts.
  chrome.runtime.onStartup.addListener(() => {
    void clearTabTransfer().catch((error: unknown) => {
      console.error("[beebox-clerk] failed to clear stale tab transfer on browser startup:", error);
    });
  });
});

// Service worker: routes popup/context-menu actions into the active box
// via the clerk API. Box association lives in the popup (Track B).
import { getActiveBox, type EnabledBox } from "../domain/config.js";
import {
  isClerkMessage,
  type ActionFailure,
  type ClerkMessage,
} from "../domain/messages.js";
import {
  buildLinkSavePayload,
  buildSavePagePayload,
  type PageExtract,
  type SaveIntent,
} from "../domain/save-page.js";
import {
  buildCommentaryPayload,
  commentaryOpenUrl,
  type CommentaryCapture,
} from "../domain/commentary.js";
import { isCaptureResultMessage } from "../domain/capture-messages.js";
import {
  ClerkApiError,
  postCommentary,
  postMemo,
  postSavePage,
  postTabs,
} from "../platform/clerk-api.js";
import { loadConfig } from "../platform/config-storage.js";
import { getTabSnapshot } from "../platform/tabs.js";

class NoActiveBoxError extends Error {
  constructor() {
    super("No box is enabled. Open a callback-box page and enable it from the popup.");
    this.name = "NoActiveBoxError";
  }
}

async function requireActiveBox(): Promise<EnabledBox> {
  const box = getActiveBox(await loadConfig());
  if (box === null) throw new NoActiveBoxError();
  return box;
}

function tryExtract(tabId: number): Promise<PageExtract | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "extractPage" }, (response) => {
      if (chrome.runtime.lastError) {
        // No content script on this page (chrome://, Web Store, …)
        console.debug("[callback-clerk] extraction unavailable:", chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      if (typeof response !== "object" || response === null || "error" in response) {
        resolve(null);
        return;
      }
      resolve(response as PageExtract);
    });
  });
}

async function saveTabPage(intent: SaveIntent, tabId: number): Promise<void> {
  const box = await requireActiveBox();
  const timestamp = new Date().toISOString();
  const extract = await tryExtract(tabId);
  if (extract !== null) {
    await postSavePage(box, buildSavePagePayload({ intent, extract, timestamp }));
    return;
  }
  const tab = await chrome.tabs.get(tabId);
  const payload = buildLinkSavePayload({
    intent,
    url: tab.url ?? "",
    title: tab.title ?? "",
    timestamp,
  });
  await postSavePage(box, payload);
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
        console.debug("[callback-clerk] capture injection failed:", e);
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
    console.error("[callback-clerk] comment failed:", failure.message);
    toastInTab(tabId, { text: `Comment failed: ${failure.message}`, isError: true });
    throw e;
  }
}

async function sendMemo(memo: { text: string; url?: string; title?: string }): Promise<void> {
  const box = await requireActiveBox();
  await postMemo(box, memo);
}

async function syncTabs(): Promise<void> {
  const box = await requireActiveBox();
  await postTabs(box, await getTabSnapshot());
}

function dispatch(message: ClerkMessage): Promise<void> {
  if (message.type === "sendMemo") {
    return sendMemo({ text: message.text, url: message.url, title: message.title });
  }
  if (message.type === "savePage") {
    return saveTabPage(message.intent, message.tabId);
  }
  if (message.type === "commentOnPage") {
    return commentOnPage(message.tabId, message.destinationDir);
  }
  return syncTabs();
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
      console.debug("[callback-clerk] toast skipped:", e);
    });
}

async function saveFromContextMenu(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  const timestamp = new Date().toISOString();
  if (typeof info.linkUrl === "string" && info.linkUrl !== "") {
    // Right-click on a link — save the link itself, no extraction.
    const box = await requireActiveBox();
    const title = info.selectionText !== undefined && info.selectionText !== ""
      ? info.selectionText
      : info.linkUrl;
    await postSavePage(
      box,
      buildLinkSavePayload({ intent: "save", url: info.linkUrl, title, timestamp }),
    );
    return;
  }
  if (tab !== undefined && tab.id !== undefined) {
    await saveTabPage("save", tab.id);
  }
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "save-to-box",
      title: "Save to Callback Box",
      contexts: ["page", "link"],
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== "save-to-box") return;
    const tabId = tab === undefined ? undefined : tab.id;
    saveFromContextMenu(info, tab)
      .then(() => {
        if (tabId !== undefined) toastInTab(tabId, { text: "Saved to Callback Box", isError: false });
      })
      .catch((e: unknown) => {
        const failure = failureResponse(e);
        console.error("[callback-clerk] context-menu save failed:", failure.message);
        if (tabId !== undefined) toastInTab(tabId, { text: failure.message, isError: true });
      });
  });

  // eslint-disable-next-line max-params -- Chrome API callback signature
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isClerkMessage(message)) return;
    dispatch(message)
      .then(() => sendResponse({ ok: true }))
      .catch((e: unknown) => sendResponse(failureResponse(e)));
    return true;
  });
});

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
import { ClerkApiError, postMemo, postSavePage, postTabs } from "../platform/clerk-api.js";
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

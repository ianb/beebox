/**
 * Runs the on-demand capture script in a tab and waits for its result.
 *
 * The heavy capture code (Defuddle + single-file-core) isn't in any always-on
 * content script: it is injected into the tab when the person presses Send or
 * Comment (a user gesture, so activeTab covers the injection), and it messages
 * the result back (a file injection can't return a value directly).
 *
 * Correlation (see domain/capture-messages.ts): captures in one tab run one at
 * a time; each sets a fresh request id in the isolated world just before the
 * injection, and only a result with that id from that tab is accepted. A
 * result arriving after the timeout finds no listener and is dropped.
 */

import {
  CAPTURE_REQUEST_GLOBAL,
  captureResultMatches,
} from "../domain/capture-messages.js";
import type { CommentaryCapture } from "../domain/commentary.js";

const CAPTURE_SCRIPT = "content-scripts/commentary-capture.js";
const CAPTURE_TIMEOUT_MS = 60000;

/** The tail of each tab's capture chain; a new capture waits for it. */
const tabQueues = new Map<number, Promise<unknown>>();

// Runs in the extension's isolated world via chrome.scripting.executeScript;
// serialized, so the key arrives as an argument.
function setRequestId(key: string, id: string): void {
  Reflect.set(globalThis, key, id);
}

async function injectCapture(tabId: number, requestId: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: setRequestId,
    args: [CAPTURE_REQUEST_GLOBAL, requestId],
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: [CAPTURE_SCRIPT] });
}

interface RunningCapture {
  result: Promise<CommentaryCapture | null>;
  /** Settles when both injections have run or failed, which can be after `result` timed out. */
  injected: Promise<void>;
}

function runCapture(tabId: number): RunningCapture {
  const requestId = crypto.randomUUID();
  let injected: Promise<void> = Promise.resolve();
  const result = new Promise<CommentaryCapture | null>((resolve) => {
    let settled = false;
    const finish = (value: CommentaryCapture | null) => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);
    function listener(message: unknown, sender: chrome.runtime.MessageSender): void {
      if (!captureResultMatches(message, { requestId, tabId, senderTabId: sender.tab?.id })) return;
      if ("error" in message) console.debug("[beebox-clerk] capture failed in page:", message.error);
      finish("error" in message ? null : message.capture);
    }
    chrome.runtime.onMessage.addListener(listener);

    injected = injectCapture(tabId, requestId).catch((e: unknown) => {
      // Injection failed (chrome://, Web Store, missing host access, …).
      console.debug("[beebox-clerk] capture injection failed:", e);
      finish(null);
    });
  });
  return { result, injected };
}

/** Captures the tab's page, or null when it can't be captured or times out. */
export function capturePage(tabId: number): Promise<CommentaryCapture | null> {
  const previous = tabQueues.get(tabId) ?? Promise.resolve();
  const started = previous.then(() => runCapture(tabId));
  // The next capture in this tab waits for this one's injections too, not only
  // its answer: an injection still waiting on a loading page after a timeout
  // would otherwise read the next capture's request id. Neither promise rejects.
  const tail = started.then(({ result, injected }) => Promise.all([result, injected]));
  tabQueues.set(tabId, tail);
  void tail.then(() => {
    if (tabQueues.get(tabId) === tail) tabQueues.delete(tabId);
  });
  return started.then(({ result }) => result);
}

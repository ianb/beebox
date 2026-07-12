// Box-relay content script (Track C of docs/plans/see-as-the-user.md). It is
// NOT registered in the manifest (registration: "runtime", matches: []) — the
// background registers it dynamically at box-enable time with path-scoped match
// patterns (platform/relay-registration.ts). It is the page's only door to a
// silent captureVisibleTab: a same-origin box script asks via window.postMessage
// and the relay forwards to the background, which is the real authorization gate.
//
// The relay itself holds no authority: it announces its presence for feature
// detection and relays capture requests, carrying a per-request correlation id.
// Strict event.source/event.origin checks fence the window bus in both
// directions; the background re-verifies the sender tab against the enabled-box
// list before any capture.
import { BOX_IDENTITY_META_NAME, parseBoxIdentity } from "../domain/box-identity.js";
import { isUrlUnderBoxUrl } from "../domain/relay-auth.js";
import {
  captureResponse,
  parseRelayPageMessage,
  RELAY_CAPTURE,
  relayReady,
  type CaptureResult,
  type RelayCaptureMessage,
} from "../domain/relay-messages.js";
import { loadConfig } from "../platform/config-storage.js";

function readIdentityMeta(): string | null {
  const el = document.querySelector(`meta[name="${BOX_IDENTITY_META_NAME}"]`);
  return el instanceof HTMLMetaElement ? el.content : null;
}

/**
 * Confirms this page really is an enabled box page before the relay announces
 * itself: the URL must be under an enabled box's boxUrl (the port-blind match
 * pattern can over-inject; this re-checks with the full origin) AND the page
 * must carry a valid same-origin box-identity meta. Either failing → stay
 * silent, so a non-box page on a shared host never sees a relay.
 */
async function isEnabledBoxPage(): Promise<boolean> {
  const config = await loadConfig();
  if (!config.boxes.some((box) => isUrlUnderBoxUrl(location.href, box.boxUrl))) return false;
  const metaContent = readIdentityMeta();
  if (metaContent === null) return false;
  return parseBoxIdentity({ metaContent, tabUrl: location.href }) !== null;
}

function postToPage(message: ReturnType<typeof relayReady>): void {
  window.postMessage(message, location.origin);
}

async function requestCapture(correlationId: string): Promise<CaptureResult> {
  const message: RelayCaptureMessage = { type: RELAY_CAPTURE, correlationId };
  try {
    // The background answers with a CaptureResult; a stateless MV3 worker may be
    // asleep, but sendMessage wakes it and resolves once it responds.
    // eslint-disable-next-line no-restricted-syntax -- runtime.sendMessage is typed `any`; the background handler (background.ts) is the sole responder and returns CaptureResult.
    return (await chrome.runtime.sendMessage(message)) as CaptureResult;
  } catch (e) {
    // Worker gone / extension reloaded mid-request: report honestly so the page
    // falls back to the consent popup rather than hanging.
    const errMessage = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: "error", message: errMessage };
  }
}

function onMessage(event: MessageEvent): void {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = parseRelayPageMessage(event.data);
  if (message === null) return;
  if (message.type === "relay-ping") {
    postToPage(relayReady());
    return;
  }
  // capture-request
  const { correlationId } = message;
  void requestCapture(correlationId).then((result) => {
    postToPage(captureResponse(correlationId, result));
  });
}

export default defineContentScript({
  registration: "runtime",
  matches: [],
  async main() {
    if (!(await isEnabledBoxPage())) return;
    window.addEventListener("message", onMessage);
    // Announce for a page that loads AFTER us; a page that loaded BEFORE us
    // handshakes via relay-ping (handled above). Either ordering works.
    postToPage(relayReady());
  },
});

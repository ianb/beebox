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
/**
 * Reliable, timing-independent gate: is this page under an enabled box's URL?
 * Depends only on the stored config + the location, both present at injection —
 * unlike the identity meta, which the box SPA adds on mount (possibly later).
 */
async function urlMatchesEnabledBox(): Promise<boolean> {
  const config = await loadConfig();
  return config.boxes.some((box) => isUrlUnderBoxUrl(location.href, box.boxUrl));
}

/**
 * Full gate: URL under an enabled box AND a valid same-origin identity meta.
 * Checked PER REQUEST (not once at injection) because the meta is rendered by
 * the box SPA's mount effect, which routinely runs after this content script's
 * `document_idle` — so a check at injection sees `hasMeta:false` and would wrongly
 * disable the relay for the whole page's life.
 */
async function isEnabledBoxPage(): Promise<boolean> {
  if (!(await urlMatchesEnabledBox())) return false;
  const metaContent = readIdentityMeta();
  return metaContent !== null && parseBoxIdentity({ metaContent, tabUrl: location.href }) !== null;
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
  // Verify identity FRESH per request: the box SPA may have rendered its
  // identity meta since this script injected. A ping/request only arrives from
  // the mounted app, so by now the meta is present on a genuine box page.
  void isEnabledBoxPage().then((ok) => {
    if (!ok) return;
    if (message.type === "relay-ping") {
      postToPage(relayReady());
      return;
    }
    const { correlationId } = message;
    void requestCapture(correlationId).then((result) => {
      postToPage(captureResponse(correlationId, result));
    });
  });
}

export default defineContentScript({
  registration: "runtime",
  matches: [],
  async main() {
    // Gate listener attachment on the reliable URL match only. Identity (the
    // SPA-rendered meta) is verified per message in onMessage, so we don't
    // permanently disable the relay just because the meta hasn't rendered yet.
    if (!(await urlMatchesEnabledBox())) return;
    window.addEventListener("message", onMessage);
    // Best-effort announce for a page that loaded BEFORE us. If the identity
    // meta isn't rendered yet, this no-ops and the page's post-mount relay-ping
    // gets the reply instead (onMessage re-checks identity). Either ordering works.
    if (await isEnabledBoxPage()) postToPage(relayReady());
  },
});

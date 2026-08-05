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
  RELAY_TAB_ARRANGEMENT,
  relayReady,
  type CaptureResult,
  type RelayCaptureMessage,
  type RelayContentMessage,
  type RelayTabArrangementMessage,
  type TabArrangementResult,
  tabArrangementResponse,
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

function postToPage(message: RelayContentMessage): void {
  window.postMessage(message, location.origin);
}

async function requestTabArrangement(message: RelayTabArrangementMessage): Promise<TabArrangementResult> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- Chrome's sendMessage return type is `any`; both ends validate this private protocol.
    return (await chrome.runtime.sendMessage(message)) as TabArrangementResult;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "error", message: detail };
  }
}

function confirmTabArrangement(message: RelayTabArrangementMessage): Promise<boolean> {
  if (message.action === "status") return Promise.resolve(true);
  const closeCount = message.proposal?.close.length ?? 0;
  const tabCount = message.proposal?.windows.reduce((sum, window) => sum + window.tabs.length, 0) ?? 0;
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });
  const panel = document.createElement("div");
  panel.innerHTML = `
    <style>
      :host { all: initial; }
      .backdrop { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: rgba(0,0,0,.45); font-family: system-ui,sans-serif; }
      .dialog { width: min(420px, calc(100vw - 32px)); border-radius: 12px; background: white; color: #292524; padding: 20px; box-shadow: 0 18px 50px rgba(0,0,0,.35); }
      h2 { margin: 0 0 8px; font-size: 18px; } p { margin: 0 0 16px; line-height: 1.45; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; }
      button { border: 0; border-radius: 6px; padding: 8px 14px; font: inherit; cursor: pointer; }
      .cancel { background: #e7e5e4; color: #292524; } .apply { background: #0f766e; color: white; font-weight: 600; }
    </style>
    <div class="backdrop" role="dialog" aria-modal="true" aria-labelledby="clerk-confirm-title">
      <div class="dialog">
        <h2 id="clerk-confirm-title">Confirm in Callback Clerk</h2>
        <p></p>
        <div class="actions"><button class="cancel">Cancel</button><button class="apply"></button></div>
      </div>
    </div>`;
  const text = panel.querySelector("p");
  const apply = panel.querySelector<HTMLButtonElement>(".apply");
  const cancel = panel.querySelector<HTMLButtonElement>(".cancel");
  if (text === null || apply === null || cancel === null) return Promise.resolve(false);
  text.textContent = message.action === "undo"
    ? "Restore the previous layout? Closed tabs will be reopened without their back/forward history."
    : `Move ${tabCount} tab${tabCount === 1 ? "" : "s"} and close ${closeCount}? Clerk will validate the live tabs first.`;
  apply.textContent = message.action === "undo" ? "Undo arrangement" : "Apply arrangement";
  shadow.append(panel);
  document.documentElement.append(host);

  return new Promise((resolve) => {
    const finish = (confirmed: boolean): void => {
      host.remove();
      resolve(confirmed);
    };
    apply.addEventListener("click", (event) => {
      if (event.isTrusted) finish(true);
    });
    cancel.addEventListener("click", (event) => {
      if (event.isTrusted) finish(false);
    });
  });
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
    if (message.type !== "capture-request") {
      const action = message.type === "tab-arrangement-status-request"
        ? "status"
        : message.type === "tab-arrangement-apply-request" ? "apply" : "undo";
      const request: RelayTabArrangementMessage = {
        type: RELAY_TAB_ARRANGEMENT,
        action,
        transferId: message.transferId,
      };
      if (message.type === "tab-arrangement-apply-request") request.proposal = message.proposal;
      void confirmTabArrangement(request).then(async (confirmed) => {
        if (!confirmed) {
          postToPage(tabArrangementResponse(message.correlationId, {
            ok: false,
            reason: "invalid",
            message: "Canceled in Callback Clerk; nothing was changed.",
          }));
          return;
        }
        request.confirmed = true;
        const result = await requestTabArrangement(request);
        postToPage(tabArrangementResponse(message.correlationId, result));
      });
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

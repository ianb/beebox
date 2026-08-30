import { BOX_IDENTITY_META_NAME, parseBoxIdentity } from "../domain/box-identity.js";
import type { EnabledBox } from "../domain/config.js";

// Runs inside the page via chrome.scripting.executeScript — must be
// self-contained (no closure over module scope; inputs arrive as args).
function readIdentityMeta(metaName: string): string | null {
  const el = document.querySelector(`meta[name="${metaName}"]`);
  return el instanceof HTMLMetaElement ? el.content : null;
}

/**
 * Reads the box-identity meta from the active tab. Returns null when the
 * tab isn't a box page — including restricted pages (chrome://, Web Store)
 * where script injection is refused; there's nothing to enable there.
 */
export async function detectBoxOnActiveTab(): Promise<EnabledBox | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab === undefined || tab.id === undefined || tab.url === undefined) return null;
  if (!tab.url.startsWith("http://") && !tab.url.startsWith("https://")) return null;

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readIdentityMeta,
      args: [BOX_IDENTITY_META_NAME],
    });
  } catch (e) {
    console.debug("[beebox-clerk] detect skipped:", e);
    return null;
  }
  const content = results[0]?.result;
  if (typeof content !== "string") return null;
  return parseBoxIdentity({ metaContent: content, tabUrl: tab.url });
}

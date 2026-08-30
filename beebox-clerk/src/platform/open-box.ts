/**
 * Navigating the browser to a box. Convenience only — no authority: the URL
 * comes from the enabled box's own boxUrl, which the user already consented to.
 */

import { boxChatUrl } from "../domain/box-url.js";
import { isUrlUnderBoxUrl } from "../domain/relay-auth.js";

/**
 * Opens the box's chat (most-active session). Reuses a tab already sitting on
 * that box rather than piling up duplicates — the popup is a frequent-click
 * surface. Tab urls are readable because `tabs` is a manifest permission.
 */
export async function openBox(boxUrl: string): Promise<void> {
  const url = boxChatUrl(boxUrl);
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((tab) => tab.url !== undefined && isUrlUnderBoxUrl(tab.url, boxUrl));
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { url, active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

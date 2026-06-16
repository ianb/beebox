/**
 * Freeze the current page into one self-contained HTML string via
 * single-file-core (the engine behind the SingleFile extension). Runs in the
 * content script against the live document; all CSS/images/fonts are inlined.
 *
 * Best-effort: a freeze failure OR a hang returns null rather than blocking,
 * so the commentary capture still succeeds with just the readable rendering
 * (the frozen attachment is optional in the clerk payload). It's raced against
 * a hard timeout as a backstop.
 *
 * NOT loadDeferredImages: that option makes single-file-core scroll the whole
 * page and wait for network-idle to trigger lazy-loaded images — it's slow
 * (seconds), visibly scrolls the user's page, and on never-idle pages (ads,
 * analytics, infinite scroll) burns the entire timeout and returns nothing.
 * We freeze what's already loaded instead, which is fast and what the user is
 * actually looking at.
 */

import { getPageData } from "single-file-core/single-file.js";

const FREEZE_TIMEOUT_MS = 12000;

export async function freezePage(): Promise<string | null> {
  const started = performance.now();
  try {
    const pageData = await Promise.race([
      getPageData({
        removeHiddenElements: true,
        removeUnusedStyles: true,
        removeUnusedFonts: true,
        removeImports: true,
        removeScripts: true,
        compressHTML: true,
        loadDeferredImages: false,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FREEZE_TIMEOUT_MS)),
    ]);
    const ms = Math.round(performance.now() - started);
    if (pageData === null) {
      console.warn(`[clerk] page freeze timed out after ${FREEZE_TIMEOUT_MS}ms; skipping snapshot`);
      return null;
    }
    console.debug(`[clerk] page freeze took ${ms}ms (${Math.round(pageData.content.length / 1024)}kB)`);
    return pageData.content !== "" ? pageData.content : null;
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    console.warn(`[clerk] page freeze failed after ${ms}ms: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

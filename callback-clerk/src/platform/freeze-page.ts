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
 * Lazy images: rather than single-file-core's loadDeferredImages — which waits
 * for network-IDLE to settle (unbounded: on never-idle pages with ads,
 * analytics, or infinite scroll it burns the whole timeout and returns nothing)
 * — we do one bounded pass ourselves: jump to the bottom to trip the page's
 * intersection-observer lazy-loaders, wait a CONSTANT settle for those requests
 * to land, restore scroll, then freeze what's now in the DOM. Bounded by design,
 * so a busy page can't hang the capture.
 */

import { getPageData } from "single-file-core/single-file.js";

const FREEZE_TIMEOUT_MS = 12000;
const SCROLL_SETTLE_MS = 1000;

// Trip lazy-load observers by jumping to the bottom, then wait a fixed beat for
// the triggered image requests to resolve. Constant cost (~1s), unlike
// single-file's network-idle wait. Scroll is restored so the user's position
// isn't disturbed; the images stay loaded in the DOM for the freeze to inline.
async function loadLazyImagesByScrolling(): Promise<void> {
  const originalY = window.scrollY;
  window.scrollTo(0, document.documentElement.scrollHeight);
  await new Promise((resolve) => setTimeout(resolve, SCROLL_SETTLE_MS));
  window.scrollTo(0, originalY);
}

export async function freezePage(): Promise<string | null> {
  const started = performance.now();
  try {
    await loadLazyImagesByScrolling();
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

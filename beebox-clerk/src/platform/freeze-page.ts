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
 *
 * removeFrames: REQUIRED here. single-file collects the iframe tree by posting
 * an init message to every child frame and awaiting a reply. We inject the
 * capture script into the top frame only, so cross-origin / ad / embed frames
 * never reply — single-file waits out its per-frame 5s/10s timeouts on nearly
 * every page (almost all have an iframe), which was the consistent ~12s hang.
 * We only want the top document, so skip frame collection entirely.
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

/**
 * Restore blocked images to hot-links. With blockImages + saveOriginalURLs,
 * single-file blanks each `<img>` src but records the original in a
 * `data-sf-original-src` attribute. Rewrite that back to the absolute original
 * URL (resolved against the page) so the snapshot loads images from their
 * source instead of carrying tens of MB of inlined base64. srcset is dropped —
 * we keep only the single hot-linked src. (CSS background images aren't
 * recoverable — single-file empties them — and SVGs are removed by blockImages;
 * both acceptable for a best-effort archival snapshot.)
 */
function hotlinkImages(html: string): string {
  const base = document.baseURI;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const el of parsed.querySelectorAll("img")) {
    const orig = el.getAttribute("data-sf-original-src");
    el.removeAttribute("data-sf-original-src");
    el.removeAttribute("srcset");
    if (orig === null || orig === "") continue;
    try {
      el.setAttribute("src", new URL(orig, base).href);
    } catch (_e) {
      el.removeAttribute("src");
    }
  }
  for (const el of parsed.querySelectorAll("source[srcset]")) {
    el.removeAttribute("srcset");
  }
  const doctype = parsed.doctype !== null ? "<!DOCTYPE html>\n" : "";
  return doctype + parsed.documentElement.outerHTML;
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
        compressHTML: true,
        compressCSS: true,
        loadDeferredImages: false,
        removeFrames: true,
        // Drop all scripts — dead weight in a static snapshot, and ~5MB of a
        // 41MB capture. NOTE: the option is `blockScripts`; the earlier
        // `removeScripts`/`removeImports` were not recognized by
        // single-file-core (silent no-ops), which is why the JS leaked in.
        blockScripts: true,
        // Don't inline images — base64-inlining them was ~35MB of a 41MB
        // capture (one chart-heavy page had 43 PNGs, several >4MB). Block the
        // inlining and hot-link to the originals instead (see hotlinkImages).
        // saveOriginalURLs records each blocked resource's URL in a
        // `data-sf-original-*` attribute so we can restore it as the live src.
        blockImages: true,
        saveOriginalURLs: true,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FREEZE_TIMEOUT_MS)),
    ]);
    if (pageData === null) {
      console.warn(`[clerk] page freeze timed out after ${FREEZE_TIMEOUT_MS}ms; skipping snapshot`);
      return null;
    }
    if (pageData.content === "") return null;
    const content = hotlinkImages(pageData.content);
    const ms = Math.round(performance.now() - started);
    console.info(`[clerk] page freeze took ${ms}ms (${Math.round(content.length / 1024)}kB)`);
    return content;
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    console.warn(`[clerk] page freeze failed after ${ms}ms: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

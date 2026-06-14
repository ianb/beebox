/**
 * Freeze the current page into one self-contained HTML string via
 * single-file-core (the engine behind the SingleFile extension). Runs in the
 * content script against the live document; all CSS/images/fonts are inlined.
 *
 * Best-effort: a freeze failure OR a hang returns null rather than blocking,
 * so the commentary capture still succeeds with just the readable rendering
 * (the frozen attachment is optional in the clerk payload). single-file-core
 * can wait indefinitely on lazy images / never-idle pages, so it's raced
 * against a hard timeout. The chosen options favor a faithful, static snapshot.
 */

import { getPageData } from "single-file-core/single-file.js";

const FREEZE_TIMEOUT_MS = 20000;

export async function freezePage(): Promise<string | null> {
  try {
    const pageData = await Promise.race([
      getPageData({
        removeHiddenElements: true,
        removeUnusedStyles: true,
        removeUnusedFonts: true,
        removeImports: true,
        removeScripts: true,
        compressHTML: true,
        loadDeferredImages: true,
        loadDeferredImagesMaxIdleTime: 1500,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FREEZE_TIMEOUT_MS)),
    ]);
    if (pageData === null) {
      console.warn(`[clerk] page freeze timed out after ${FREEZE_TIMEOUT_MS}ms; skipping snapshot`);
      return null;
    }
    return pageData.content !== "" ? pageData.content : null;
  } catch (e) {
    console.warn(`[clerk] page freeze failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

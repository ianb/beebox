/**
 * Freeze the current page into one self-contained HTML string via
 * single-file-core (the engine behind the SingleFile extension). Runs in the
 * content script against the live document; all CSS/images/fonts are inlined.
 *
 * Best-effort: a freeze failure returns null rather than throwing, so the
 * commentary capture still succeeds with just the readable rendering (the
 * frozen attachment is optional in the clerk payload). The chosen options
 * favor a faithful, static snapshot; tune during in-browser verification.
 */

import { getPageData } from "single-file-core/single-file.js";

export async function freezePage(): Promise<string | null> {
  try {
    const pageData = await getPageData({
      removeHiddenElements: true,
      removeUnusedStyles: true,
      removeUnusedFonts: true,
      removeImports: true,
      removeScripts: true,
      compressHTML: true,
      loadDeferredImages: true,
      loadDeferredImagesMaxIdleTime: 1500,
    });
    return pageData.content !== "" ? pageData.content : null;
  } catch (e) {
    console.warn(`[clerk] page freeze failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

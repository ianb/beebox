/**
 * The KaTeX renderer, with mhchem's `\ce{}` and `\pu{}` and KaTeX's CSS.
 *
 * Load this module only through `loadMathRenderer` (`Math.tsx`): a dynamic
 * import keeps KaTeX, its fonts and its CSS in their own chunk, so a page with
 * no math downloads none of it.
 */

import katex from "katex";
import "katex/contrib/mhchem";
import "katex/dist/katex.min.css";

export type MathResult = { html: string } | { error: string };

/**
 * TeX as KaTeX HTML, or KaTeX's parse error. `trust: false` (the default,
 * stated here) keeps `\href`, `\includegraphics` and HTML extensions off, so
 * the output is safe for agent-written TeX; `maxSize` bounds `\rule` and
 * sizing commands, in ems, so a formula cannot cover the page.
 */
export function renderTex(tex: string, display: boolean): MathResult {
  try {
    return {
      html: katex.renderToString(tex, {
        displayMode: display,
        throwOnError: true,
        trust: false,
        maxSize: 20,
        strict: "ignore",
      }),
    };
  } catch (error) {
    if (error instanceof katex.ParseError) return { error: error.message };
    throw error;
  }
}

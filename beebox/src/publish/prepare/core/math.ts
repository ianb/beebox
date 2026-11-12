/**
 * TeX → MathML for published pages (`markdown-page.ts`).
 *
 * A published page is self-contained: inline CSS, no fonts, no script, no
 * absolute URLs. KaTeX's MathML output fits that, since browsers draw MathML
 * themselves; its HTML output would need KaTeX's stylesheet and fonts. The app
 * renders the same TeX with KaTeX's HTML output (`frontend/.../Markdown/math-render.ts`).
 */

import katex from "katex";
import "katex/contrib/mhchem";
import { escapeHtml } from "../../../lib/escape-html.js";

// The HTML parser puts `<math>` in the MathML namespace without it, and the
// leak scan reports any `http(s)://` text in a bundle.
const MATHML_XMLNS = / xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/g;

/**
 * One formula as MathML, or its source in code style when KaTeX cannot parse
 * it. `trust: false` keeps links and HTML extensions out; `maxSize` (ems)
 * bounds rules and sizes.
 */
export function texToMathml(tex: string, display: boolean): string {
  try {
    return katex
      .renderToString(tex, { displayMode: display, output: "mathml", throwOnError: true, trust: false, maxSize: 20, strict: "ignore" })
      .replace(MATHML_XMLNS, "");
  } catch (error) {
    if (!(error instanceof katex.ParseError)) throw error;
    const delimiter = display ? "$$" : "$";
    return `<code>${escapeHtml(`${delimiter}${tex}${delimiter}`)}</code>`;
  }
}

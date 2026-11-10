// A published Markdown page renders `$…$` and `$$…$$` math as MathML: no
// stylesheet, fonts or script, and nothing the leak scan reports. Prices stay
// text, TeX that does not parse publishes as code, and a formula in the first
// heading stays in the page title (docs/plans/published-math.md).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { renderMarkdownPage, markdownValidationErrors } from "../../src/publish/prepare/core/markdown-page.js";
import { scanBundle } from "../../src/publish/leak-scan.js";

const source = [
  "# Energy $E = mc^2$",
  "",
  "Water: $\\ce{2H2 + O2 -> 2H2O}$, for $5 and $10.",
  "",
  "$$",
  "x^2",
  "$$",
  "",
  "Broken $\\frac{a$.",
].join("\n");

function mainOf(html: string): string | undefined {
  return html.match(/<main>([\S\s]*)<\/main>/)?.[1];
}

void test("math publishes as MathML", async (t) => {
  const html = renderMarkdownPage(source, { fallbackTitle: "T" });
  const main = mainOf(html) ?? "";
  // Each formula, in order: inline, chemistry, display; then the broken one as code.
  t.check([...main.matchAll(/<math( display="block")?>/g)].map((m) => m[1] ?? "inline"), ["inline", "inline", " display=\"block\""]);
  t.check([...main.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)].map((m) => m[1]), [
    "E = mc^2",
    "\\ce{2H2 + O2 -&gt; 2H2O}",
    "x^2",
  ]);
  t.check(main.match(/for \$5 and \$10\./)?.[0], "for $5 and $10.");
  t.check(main.match(/Broken <code>[^<]*<\/code>/)?.[0], "Broken <code>$\\frac{a$</code>");
  t.check(html.match(/<title>(.*)<\/title>/)?.[1], "Energy $E = mc^2$");
  t.check(scanBundle(new Map([["index.html", html]]), { ownerEmail: null, allowedEmails: [] }).findings, []);
});

void test("a page with math validates", async (t) => {
  t.check(markdownValidationErrors(source), []);
});

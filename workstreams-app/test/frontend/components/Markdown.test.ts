// # Issue Markdown rendering
//
// Issue bodies render as document markup rather than a preformatted source dump.
// Unsafe link protocols do not become clickable links.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Markdown } from "../../../src/frontend/components/Markdown.js";

const render = (source: string): string => renderToStaticMarkup(createElement(Markdown, { source }));

void test("headings, lists, strong and inline code render as document markup", async (t) => {
  t.checkText(
    render("## Verify this\n\n- first\n- **second**\n\n`pnpm test`"),
    '<div class="prose prose-sm max-w-none"><article><h2>Verify this</h2><ul><li>first</li><li><strong>second</strong></li></ul><p><code>pnpm test</code></p></article></div>',
  );
});

void test("safe and relative links render; unsafe protocols do not", async (t) => {
  t.checkText(
    render("[safe](HTTPS://example.com) [relative](../plan.md) [unsafe](custom:payload)"),
    '<div class="prose prose-sm max-w-none"><article><p><a href="HTTPS://example.com">safe</a> <a href="../plan.md">relative</a> <span class="cursor-help underline decoration-dotted" title="Unsupported link: custom:payload">unsafe</span></p></article></div>',
  );
});

// Unknown Markdoc tags follow Markdoc's normal behavior: their inner content is
// preserved even though the tag wrapper itself has no issue-app meaning.
void test("Unknown Markdoc tags follow Markdoc's normal behavior:", async (t) => {
  t.checkText(
    render("before {% mystery %}inside{% /mystery %} after"),
    '<div class="prose prose-sm max-w-none"><article><p>before inside after</p></article></div>',
  );
});

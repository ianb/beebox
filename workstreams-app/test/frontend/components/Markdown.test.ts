// # Issue Markdown rendering
//
// Issue bodies render as document markup rather than a preformatted source dump.
// Unsafe link protocols do not become clickable links.

import { test } from "tap";
import "agent-doctest/tap";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Markdown } from "../../../src/frontend/components/Markdown.js";

const render = (source: string): string => renderToStaticMarkup(createElement(Markdown, { source }));

void test("line 14", async (t) => {
  // doctest:L15
  t.check(render("## Verify this\n\n- first\n- **second**\n\n`pnpm test`").includes("<h2>Verify this</h2>"), true);
});

void test("line 19", async (t) => {
  // doctest:L20
  t.check(render("## Verify this\n\n- first\n- **second**\n\n`pnpm test`").includes("<strong>second</strong>"), true);
});

void test("line 24", async (t) => {
  // doctest:L25
  t.check(
    render("[safe](HTTPS://example.com) [relative](../plan.md) [unsafe](custom:payload)").includes('href="HTTPS://example.com"')
    ,
    true,
  );
});

void test("line 29", async (t) => {
  // doctest:L30
  t.check(
    render("[safe](HTTPS://example.com) [relative](../plan.md) [unsafe](custom:payload)").includes('href="../plan.md"')
    ,
    true,
  );
});

void test("line 34", async (t) => {
  // doctest:L35
  t.check(
    render("[safe](HTTPS://example.com) [relative](../plan.md) [unsafe](custom:payload)").includes('href="custom:')
    ,
    false,
  );
});

void test("line 39", async (t) => {
  // doctest:L40
  t.check(
    render("[safe](HTTPS://example.com) [relative](../plan.md) [unsafe](custom:payload)").includes("Unsupported link: custom:payload")
    ,
    true,
  );
});

// Unknown Markdoc tags follow Markdoc's normal behavior: their inner content is
// preserved even though the tag wrapper itself has no issue-app meaning.
void test("Unknown Markdoc tags follow Markdoc's normal behavior:", async (t) => {
  // doctest:L48
  t.check(render("before {% mystery %}inside{% /mystery %} after").includes("before inside after"), true);
});

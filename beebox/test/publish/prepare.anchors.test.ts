// A published page carries the ids a card body annotates: the same Markdoc
// config as in-app, so a citation `card#id` works on the published copy
// (docs/plans/knowledge-base-tools.md, Track C).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { renderMarkdownPage } from "../../src/publish/prepare/core/markdown-page.js";

void test("Annotated headings and paragraphs publish with their ids", (t) => {
  const html = renderMarkdownPage("## Findings {% #f %}\n\nA claim. {% #c1 %}\n\nNo id.\n", { fallbackTitle: "T" });
  t.check([...html.matchAll(/<(h2|p) id="([^"]+)"/g)].map((m) => [m[1], m[2]]), [["h2", "f"], ["p", "c1"]]);
  t.end();
});

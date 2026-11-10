// An intention line renders as inline Markdown only (docs/plans/place-intention.md,
// Track B): emphasis, code, and links render; a heading, a list, an image, or a
// tag shows as the text that was written.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownInline, inlineOnlyPieces } from "../../../../src/components/intention/IntentionLine/MarkdownInline.js";
import { BoxSlugProvider } from "../../../../src/lib/box-slug.js";

globalThis.React = React;

function render(source: string): string {
  const line = React.createElement(MarkdownInline, { onNavigate: () => {}, basePath: "_content/writing/Writing.landmark.card", children: source });
  return renderToStaticMarkup(React.createElement(BoxSlugProvider, { boxSlug: "test1", children: line }));
}

/** The markup inside the wrapping span. */
function inner(html: string): string {
  return html.replace(/^<span[^>]*>/, "").replace(/<\/span>$/, "");
}

void test("emphasis, code, and a relative card link render inline", async (t) => {
  t.check(
    inner(render("Finish the *garden post*: see [the draft](Garden_Post.doc.card) and `notes` 🌱")),
    'Finish the <em>garden post</em>: see <a class="bbx-theme-link" href="/test1/views/_content/writing/Garden_Post.doc.card">the draft</a> and <code>notes</code> 🌱',
  );
});

void test("a heading, a list, a quote, or a tag shows as its written text", async (t) => {
  t.check(
    ["## Finish the post", "- Finish the post", "> Finish the post", "Ask {% quote %}Tomas{% /quote %} first"].map((source) => inner(render(source))),
    ["## Finish the post", "- Finish the post", "&gt; Finish the post", "Ask {% quote %}Tomas{% /quote %} first"],
  );
});

void test("an image shows as its source text, and the rest of the line still renders", async (t) => {
  t.check(inlineOnlyPieces("**See** ![trellis](trellis.png)"), [
    { kind: "strong", children: [{ kind: "text", text: "See" }] },
    { kind: "text", text: " " },
    { kind: "text", text: "![trellis](trellis.png)" },
  ]);
  t.check(inner(render("![trellis](trellis.png)")), "![trellis](trellis.png)");
});

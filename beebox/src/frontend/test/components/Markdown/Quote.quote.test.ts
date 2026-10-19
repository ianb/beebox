// # Quote presentation hooks
//
// `QuoteInline` and `QuoteBlock` keep their provenance-bearing semantics while
// exposing stable theme roles. An explicit treatment is data, not a CSS class;
// the active theme decides how that named request looks.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeQuoteComponents } from "../../../src/components/Markdown/Quote.js";

globalThis.React = React;

const { QuoteInline, QuoteBlock } = makeQuoteComponents({ onNavigate: () => {} });

// ## Inline quotes preserve punctuation, attribution, and inline markup
void test("Inline quotes preserve punctuation, attribution, and inline markup", async (t) => {
  const inline = renderToStaticMarkup(React.createElement(
    QuoteInline,
    { from: "A participant" },
    React.createElement("em", null, "exact words"),
  ));
  t.check(inline, "<span class=\"bbx-quote bbx-quote-inline\" data-from=\"A participant\"><span class=\"bbx-quote-mark\">“</span><em>exact words</em><span class=\"bbx-quote-mark\">”</span><span class=\"bbx-quote-attribution\"> — <span>A participant</span></span></span>");
});

// ## Block treatment and provenance stay on the quote figure
void test("Block treatment and provenance stay on the quote figure", async (t) => {
  const block = renderToStaticMarkup(React.createElement(
    QuoteBlock,
    { from: "A participant", treatment: "layered" },
    React.createElement("p", null, "Keep the example close."),
  ));
  t.check(block, "<figure class=\"bbx-quote bbx-quote-block\" data-from=\"A participant\" data-treatment=\"layered\"><blockquote class=\"bbx-quote-body\"><p>Keep the example close.</p></blockquote><figcaption class=\"bbx-quote-attribution\">— <span>A participant</span></figcaption></figure>");
});

// ## Person refs preserve navigation and take the themed link role
void test("Person refs preserve navigation and take the themed link role", async (t) => {
  const linked = renderToStaticMarkup(React.createElement(
    QuoteBlock,
    { from: "people/rina" },
    "Exact words.",
  ));
  t.check(linked, "<figure class=\"bbx-quote bbx-quote-block\" data-from=\"people/rina\"><blockquote class=\"bbx-quote-body\">Exact words.</blockquote><figcaption class=\"bbx-quote-attribution\">— <button type=\"button\" class=\"bbx-theme-link\">rina</button></figcaption></figure>");
});

// ## Omitted treatment leaves the theme default in control
void test("Omitted treatment leaves the theme default in control", async (t) => {
  const defaulted = renderToStaticMarkup(React.createElement(QuoteBlock, null, "Theme default."));
  t.check(defaulted, "<figure class=\"bbx-quote bbx-quote-block\"><blockquote class=\"bbx-quote-body\">Theme default.</blockquote></figure>");
});

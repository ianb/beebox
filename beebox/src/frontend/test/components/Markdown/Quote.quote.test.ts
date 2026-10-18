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
  // doctest:L20
  const inline = renderToStaticMarkup(React.createElement(
    QuoteInline,
    { from: "A participant" },
    React.createElement("em", null, "exact words"),
  ));
  await t.checkText(inline.includes('class="bbx-quote bbx-quote-inline"'), "true");

  // doctest:L28
  await t.checkText(inline.includes("<em>exact words</em>"), "true");

  // doctest:L31
  await t.checkText(inline.includes('<span class="bbx-quote-mark">“</span>') && inline.includes('<span class="bbx-quote-mark">”</span>'), "true");

  // doctest:L34
  await t.checkText(inline.includes('<span class="bbx-quote-attribution"> — <span>A participant</span></span>'), "true");
});

// ## Block treatment and provenance stay on the quote figure
void test("Block treatment and provenance stay on the quote figure", async (t) => {
  // doctest:L41
  const block = renderToStaticMarkup(React.createElement(
    QuoteBlock,
    { from: "A participant", treatment: "layered" },
    React.createElement("p", null, "Keep the example close."),
  ));
  await t.checkText(block.includes('<figure class="bbx-quote bbx-quote-block" data-from="A participant" data-treatment="layered">'), "true");

  // doctest:L49
  await t.checkText(block.includes('<blockquote class="bbx-quote-body"><p>Keep the example close.</p></blockquote>'), "true");

  // doctest:L52
  await t.checkText(block.includes('<figcaption class="bbx-quote-attribution">— <span>A participant</span></figcaption>'), "true");
});

// ## Person refs preserve navigation and take the themed link role
void test("Person refs preserve navigation and take the themed link role", async (t) => {
  // doctest:L59
  const linked = renderToStaticMarkup(React.createElement(
    QuoteBlock,
    { from: "people/rina" },
    "Exact words.",
  ));
  await t.checkText(linked.includes('<button type="button" class="bbx-theme-link">rina</button>'), "true");
});

// ## Omitted treatment leaves the theme default in control
void test("Omitted treatment leaves the theme default in control", async (t) => {
  // doctest:L71
  const defaulted = renderToStaticMarkup(React.createElement(QuoteBlock, null, "Theme default."));
  await t.checkText(defaulted.includes("data-treatment"), "false");
});

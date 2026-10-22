// # Stack and the text roles — layout and element come from the component
//
// `Stack` used to space its children with `space-y-*`, a top margin. Margin does
// nothing to an inline element, so a `Stack` of `Text` spans rendered as one
// run-together line. `Stack` is now a flex column with `gap-*`, which separates
// children whatever their display type.
//
// The role components render the element the role needs, so the caller never
// chooses between a `<span>` and a `<p>`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Stack } from "../../../src/components/ui/Stack.js";
import { Text } from "../../../src/components/ui/Text.js";
import { Heading } from "../../../src/components/ui/Heading.js";
import { StatusMessage } from "../../../src/components/ui/StatusMessage.js";

globalThis.React = React;

const h = React.createElement;
const html = (el: React.ReactElement): string => renderToStaticMarkup(el);

// ## Stack separates inline children
//
// Two `Text` spans in a `Stack` are flex items, so each takes its own line and
// the gap applies between them.
void test("Two Text spans in a Stack are flex items, so each takes its own line and the...", async (t) => {
  t.check(html(h(Stack, { gap: "xs", children: h(React.Fragment, null, h(Text, null, "Label"), h(Text, null, "Description")) })), "<div class=\"flex flex-col gap-1\"><span class=\"text-warm-900 text-base\">Label</span><span class=\"text-warm-900 text-base\">Description</span></div>");
});

// The default gap is `md`, and `as` still selects the element:
void test("The default gap is md, and as still selects the element:", async (t) => {
  t.check(html(h(Stack, { as: "ul", children: h("li", null, "a") })), "<ul class=\"flex flex-col gap-3\"><li>a</li></ul>");
});

// `Stack` also serves as a page-level scroll container (it absorbed `Column`).
// A focusable scrolling stack takes `tabIndex` so the keyboard can scroll it,
// and a clipping stack is `relative` so an `sr-only` descendant cannot stretch
// the document:
void test("Stack also serves as a page-level scroll container (it absorbed Column).", async (t) => {
  t.check(html(h(Stack, { gap: "none", overflow: "auto", focusable: true, children: "x" })), "<div class=\"flex flex-col overflow-auto relative focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent\" tabindex=\"0\">x</div>");

  t.check(html(h(Stack, { gap: "none", hideOnMobile: true, align: "center", children: "x" })), "<div class=\"flex-col items-center hidden sm:flex\">x</div>");
});

// ## Heading renders a real heading; the level decides the look
void test("Heading renders a real heading; the level decides the look", async (t) => {
  t.check(html(h(Heading, { level: 2, children: "This box" })), "<h2 class=\"text-lg font-semibold text-warm-900\">This box</h2>");

  t.check(html(h(Heading, { level: 3, className: "mb-2", children: "Engines" })), "<h3 class=\"text-sm font-semibold text-warm-900 mb-2\">Engines</h3>");
});

// ## StatusMessage announces a pane's placeholder
//
// The caller's padding replaces the default `p-8` (`cn` merges with
// `tailwind-merge`, and the caller wins).
void test("The caller's padding replaces the default p-8 (cn merges with tailwind-merge,...", async (t) => {
  t.check(html(h(StatusMessage, { children: "Loading…" })), "<div role=\"status\" class=\"p-8 text-warm-700\">Loading…</div>");

  t.check(html(h(StatusMessage, { className: "p-4", children: "Loading…" })), "<div role=\"status\" class=\"text-warm-700 p-4\">Loading…</div>");
});

// # Markdoc task-list items
//
// A GFM task item (`- [ ]` / `- [x]`) becomes a `Task` checkbox. The checkbox and
// the item's inline text share a `label`, so the checkbox's accessible name is
// the task text. A nested list stays outside the label.
//
// Tested headlessly through Markdoc's own `renderers.html` — no React, no DOM.

import { test } from "tap";
import "agent-doctest/tap";
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config/tags/core.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, transform, renderers } = Markdoc;

function render(src: string): string {
  return renderers.html(transform(parse(src), markdocConfig));
}

// ## The label holds the checkbox and the inline text
void test("The label holds the checkbox and the inline text", async (t) => {
  // doctest:L23
  t.check(render("- [x] Pack **tent**\n- [ ] Stove"), "<article><ul><li><label><Task done=\"true\"></Task>Pack <strong>tent</strong></label></li><li><label><Task done=\"false\"></Task>Stove</label></li></ul></article>");
});

// ## A nested list stays outside the label
void test("A nested list stays outside the label", async (t) => {
  // doctest:L31
  t.check(render("- [ ] Gear\n  - [x] Tent"), "<article><ul><li><label><Task done=\"false\"></Task>Gear</label><ul><li><label><Task done=\"true\"></Task>Tent</label></li></ul></li></ul></article>");
});

// ## A plain list item is unchanged
void test("A plain list item is unchanged", async (t) => {
  // doctest:L39
  t.check(render("- Tent"), "<article><ul><li>Tent</li></ul></article>");
});

// # Markdoc `redacted` tag
//
// The `redacted` Markdoc tag wraps agent-authored spoiler content. The transform
// emits `RedactedInline` or `RedactedBlock` based on `node.inline`, mirroring
// the `quote` / `source` split — the React renderer then renders each shape
// appropriately (inline blur span vs. block container).
//
// Tested headlessly through Markdoc's own `renderers.html` — no React, no DOM.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config/tags/core.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, transform, renderers } = Markdoc;

function render(src: string): string {
  return renderers.html(transform(parse(src), markdocConfig));
}

// ## Inline redacted within a paragraph
//
// A tag whose body has no newlines is inline — emits `RedactedInline`.
void test("A tag whose body has no newlines is inline — emits RedactedInline.", async (t) => {
  t.check(render("The answer is {% redacted %}42{% /redacted %}."), "<article><p>The answer is <RedactedInline>42</RedactedInline>.</p></article>");
});

// ## Block redacted
//
// A tag with block-level body emits `RedactedBlock`.
void test("A tag with block-level body emits RedactedBlock.", async (t) => {
  t.check(render("{% redacted %}\n\nA spoiler paragraph.\n\n{% /redacted %}"), "<article><RedactedBlock><p>A spoiler paragraph.</p></RedactedBlock></article>");
});

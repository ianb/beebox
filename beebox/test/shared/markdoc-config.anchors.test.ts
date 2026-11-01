// # anchorsIn
//
// The ids a ref's `#fragment` can name in a body: heading ids (explicit, else
// slug, numbered when repeated) and annotated paragraph ids. Heading ids come
// from `HeadingIds`, the function `makeHeadingNode` also uses, so lint and the
// renderer agree (docs/plans/knowledge-base-tools.md, Track D).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import Markdoc from "@markdoc/markdoc";
import { anchorsIn } from "../../src/shared/markdoc-config/anchors.js";
import { makeHeadingNode } from "../../src/shared/markdoc-config/tags/core.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse, transform, renderers } = Markdoc;

void test("Duplicate headings are numbered in document order", async (t) => {
  t.check(anchorsIn("## Notes\n\ntext\n\n## Notes\n"), [
    { id: "notes", kind: "heading" },
    { id: "notes-1", kind: "heading" },
  ]);
});

// An explicit id that comes after a duplicate pair takes `notes-1`; the renderer
// numbers the same way, so the two lists match.
void test("An explicit id is taken in either order", async (t) => {
  const first = "## Notes {% #notes %}\n\n## Notes\n";
  const second = "## Notes\n\n## Notes\n\n## Other {% #notes-1 %}\n";
  t.check(anchorsIn(first), [
    { id: "notes", kind: "heading" },
    { id: "notes-1", kind: "heading" },
  ]);
  t.check(anchorsIn(second), [
    { id: "notes", kind: "heading" },
    { id: "notes-1", kind: "heading" },
    { id: "notes-1", kind: "heading" },
  ]);
  const html = renderers.html(transform(parse(second), { nodes: { heading: makeHeadingNode() } }));
  t.check(html, "<article><h2 id=\"notes\" data-line=\"1\">Notes</h2><h2 id=\"notes-1\" data-line=\"3\">Notes</h2><h2 id=\"notes-1\" data-line=\"5\">Other </h2></article>");
});

void test("An annotated paragraph is an anchor; a list item is not", async (t) => {
  t.check(anchorsIn("A claim. {% #c1 %}\n\nPlain.\n\n- item {% #i1 %}\n"), [{ id: "c1", kind: "paragraph" }]);
});

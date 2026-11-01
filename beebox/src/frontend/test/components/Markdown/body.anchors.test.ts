// A paragraph annotated `{% #id %}` renders with that id, and a heading with an
// explicit id keeps it, so a ref's `#fragment` has an element to land on
// (docs/plans/knowledge-base-tools.md, Track C).
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Markdown } from "../../../src/components/Markdown/body.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";

const source = "## Findings {% #f %}\n\nA claim. {% #c1 %}\n\nNo id here.\n";

void test("Annotated headings and paragraphs render their ids", async (t) => {
  const view = await mount(h(BoxSlugProvider, { boxSlug: "test", children: h(Markdown, { onNavigate: () => {}, children: source }) }));
  t.check(
    [...view.container.querySelectorAll("[id]")].map((el) => ({ tag: el.tagName, id: el.id, text: el.textContent.trim() })),
    [
      { tag: "H2", id: "f", text: "Findings" },
      { tag: "DIV", id: "c1", text: "A claim." },
    ],
  );
  await view.unmount();
});

// An instruction file's include lines render as include rows, not as one
// joined paragraph; the same lines in any other Markdown file stay text.
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../../../src/components/Markdown/body.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";

globalThis.React = React;

function render(basePath: string, source: string): string {
  return renderToStaticMarkup(h(BoxSlugProvider, {
    boxSlug: "test",
    children: h(Markdown, { onNavigate: () => {}, basePath, children: source }),
  }));
}

void test("an include outside the viewable areas reads 'not viewable here'", async (t) => {
  // The root AGENTS.md's guide include: `.beebox/` is outside the box namespace.
  t.check(
    render("/AGENTS.md", "@.beebox/agent-guide.md\n"),
    '<div class="bbx-include-file my-1 text-sm text-warm-700" title="This file is outside the parts of the box this app shows">includes <code>.beebox/agent-guide.md</code> <span class="text-warm-400">(not viewable here)</span></div>',
  );
});

void test("outside an instruction file the line is ordinary text", async (t) => {
  t.check(render("/_content/notes.md", "@.beebox/agent-guide.md\n"), '<div class="bbx-paragraph">@.beebox/agent-guide.md</div>');
});

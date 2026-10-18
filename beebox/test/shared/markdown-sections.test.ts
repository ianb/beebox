// The section splitter is shared by the search indexer and the web view: a
// search result names its section by path, and the view looks that path up in
// the body it renders. These check that the paths the view computes are the
// ones search indexed, and that each path knows its heading line.
import { test } from "tap";
import { loadCardFromText, type LoadCardContext } from "../../src/core/card-io.js";
import { extractCardDocs } from "../../src/core/search/extract/core.js";
import { sectionLines, splitMarkdownSections } from "../../src/shared/markdown-sections.js";
import { createCardSchemaMap } from "../../src/schemas.js";

const filler = "Lorem ipsum dolor sit amet. ".repeat(30);
const body = [
  "# Weekly plan", "", filler, "",
  "## Notes", "", "first notes " + filler, "",
  "```bash", "# install deps", "npm i", "```", "",
  "## Notes", "", "second notes " + filler, "",
  "## Where **things** stand [now](x.card)", "", "status " + filler, "",
  "## Notes", "", "third notes " + filler, "",
].join("\n");

test("section paths match what search indexes, repeats numbered", async (t) => {
  const ctx: LoadCardContext = { cardSchemas: await createCardSchemaMap() };
  const path = "_content/Weekly.doc.card";
  const card = await loadCardFromText({ content: `---\ntitle: Weekly plan\n---\n${body}`, source: path, ctx });
  const indexed = extractCardDocs({ path, card, contentHash: "h" }).map((d) => d.fragment).filter((f) => f !== "");
  const split = splitMarkdownSections(body).sections.map((s) => s.fragment);
  t.same(split, indexed, "the view's paths are the indexer's paths");
  t.same(split, [
    "/Weekly plan",
    "/Weekly plan/Notes",
    "/install deps",
    "/install deps/Notes",
    "/install deps/Where **things** stand [now](x.card)",
    "/install deps/Notes~2",
  ], "a fenced # line counts as a level-1 heading, as it always has for search");
});

test("a repeated path gets ~N in emitted order", (t) => {
  const sections = splitMarkdownSections("## A\nx\n## A\ny\n## A\n\n## A\nz\n").sections;
  t.same(sections.map((s) => s.fragment), ["/A", "/A~2", "/A~3"], "an empty section is not emitted and not counted");
  t.end();
});

test("sectionLines maps each path to its 0-based heading line", (t) => {
  const lines = sectionLines(body);
  t.equal(lines.get("/Weekly plan"), 0);
  t.equal(lines.get("/Weekly plan/Notes"), 4);
  t.equal(lines.get("/install deps"), 9, "the fenced line itself");
  t.equal(lines.get("/install deps/Notes"), 13);
  t.equal(lines.get("/install deps/Where **things** stand [now](x.card)"), 17);
  t.equal(lines.get("/install deps/Notes~2"), 21);
  t.end();
});

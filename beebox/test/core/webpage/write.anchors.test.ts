// # Trusted anchors on a saved webpage card
//
// docs/plans/knowledge-base-tools.md, Track C. A box function returns
// `anchors: [{ id, line }]`; the engine escapes the page text first, then
// appends ` {% #id %}` to those lines. Page text that imitates the annotation
// stays escaped, and a bad anchor throws before anything is written.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { processTempDir } from "../../helpers/process-temp-dir.js";
import { neutralizeIngestedMarkdown } from "../../../src/shared/markdoc-config/ingest.js";
import { anchorsIn } from "../../../src/shared/markdoc-config/anchors.js";
import { splitCardContent } from "../../../src/cards/frontmatter.js";
import { applyAnchors, writeWebpageCard } from "../../../src/core/webpage/write.js";

const escaped = (markdown: string): string => neutralizeIngestedMarkdown(markdown);

void test("An anchor lands on a heading and on a paragraph", (t) => {
  const body = applyAnchors(escaped("# Title\n\nFirst claim.\n\nSecond claim."), [
    { id: "t", line: 0 },
    { id: "c2", line: 4 },
  ]);
  t.check(body, "# Title {% #t %}\n\nFirst claim.\n\nSecond claim. {% #c2 %}");
  t.check(anchorsIn(body), [
    { id: "t", kind: "heading" },
    { id: "c2", kind: "paragraph" },
  ]);
  t.end();
});

// The page is third-party text. Its `{% #x %}` is escaped by the neutralizer
// and is not an anchor; only the box function's own anchor is.
void test("Page text imitating an annotation stays escaped", (t) => {
  const body = applyAnchors(escaped("A claim {% #x %} here.\n\nOther."), [{ id: "y", line: 0 }]);
  t.check(body, "A claim \\{% #x %} here. {% #y %}\n\nOther.");
  t.check(anchorsIn(body), [{ id: "y", kind: "paragraph" }]);
  t.end();
});

void test("A bad anchor throws and names the id", (t) => {
  const md = escaped("# Notes\n\nA claim.\n\n- an item\n");
  const message = (anchors: { id: string; line: number }[]): string => {
    try {
      applyAnchors(md, anchors);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return "no error";
  };
  t.check(message([{ id: "Bad_Id", line: 2 }]), "anchor \"Bad_Id\": an id uses a-z, 0-9 and -, and starts with a letter or digit");
  t.check(message([{ id: "a", line: 2 }, { id: "a", line: 0 }]), "anchor \"a\": given twice");
  t.check(message([{ id: "b", line: 3 }]), "anchor \"b\": line 3 is blank in the markdown (lines count from 0)");
  t.check(message([{ id: "c", line: 40 }]), "anchor \"c\": line 40 is past the end of the markdown (lines count from 0)");
  // Slug of `# Notes`: a citation of #notes would reach the heading, not the paragraph.
  t.check(message([{ id: "notes", line: 2 }]), "anchor \"notes\": a heading in the page already has that id; choose another");
  t.check(message([{ id: "d", line: 4 }]), "anchor \"d\": line 4 is not a heading or the end of a paragraph (a list item or table cell cannot carry an id)");
  t.end();
});

void test("A failed anchor writes no card", async (t) => {
  const boxRoot = processTempDir("bbx-anchors-");
  const cardRel = "inbox/p.webpage.card";
  const base = { boxRoot, cardRel, title: "P", url: "https://a.example/p", capturedAt: "2026-11-01T00:00:00Z", markdown: "Text.", frozenHtml: "<p>x</p>", exclusive: true };
  await t.checkThrows(() => writeWebpageCard({ ...base, anchors: [{ id: "a", line: 9 }] }), "AnchorError: anchor \"a\": line 9 is past the end of the markdown (lines count from 0)");
  t.check(await fs.readdir(boxRoot), []);
  const written = await writeWebpageCard({ ...base, anchors: [{ id: "a", line: 0 }] });
  t.check(written, [cardRel, "inbox/p.attach/page.frozen"]);
  t.check(splitCardContent(await fs.readFile(path.join(boxRoot, cardRel), "utf-8")).body.trim(), "Text. {% #a %}");
});

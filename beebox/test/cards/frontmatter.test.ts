// # The frontmatter fence rule
//
// One rule decides where a card's (or a repo doc's) frontmatter block is:
// `---` at column 0, an optional byte-order mark first, trailing spaces or
// tabs and CRLF allowed on fence lines, an empty block allowed, and the
// closing fence may end the file. `---x` is not a fence. See
// `src/cards/frontmatter.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { editableFrontmatterDocument, frontmatterFence, renderFrontmatterDocument, splitCardContent } from "../../src/cards/frontmatter.js";

const split = (text: string) => {
  const { frontmatterText, body, lineOffset, hasFrontmatter } = splitCardContent(text);
  return { frontmatterText, body, lineOffset, hasFrontmatter };
};

void test("Each accepted fence form splits text from body", async (t) => {
  t.check(split("---\na: 1\n---\nbody\n"), { frontmatterText: "a: 1", body: "body\n", lineOffset: 3, hasFrontmatter: true });
  t.check(split("---\r\na: 1\r\nb: 2\r\n---\r\nbody"), { frontmatterText: "a: 1\r\nb: 2", body: "body", lineOffset: 4, hasFrontmatter: true });
  t.check(split("﻿---\na: 1\n---\nbody"), { frontmatterText: "a: 1", body: "body", lineOffset: 3, hasFrontmatter: true });
  t.check(split("--- \na: 1\n---\t\nbody"), { frontmatterText: "a: 1", body: "body", lineOffset: 3, hasFrontmatter: true });
  t.check(split("---\n---\nbody"), { frontmatterText: "", body: "body", lineOffset: 2, hasFrontmatter: true });
  t.check(split("---\na: 1\n---"), { frontmatterText: "a: 1", body: "", lineOffset: 2, hasFrontmatter: true });
});

// A line that only starts like a fence stays inside the block, and an
// indented or missing opening fence means there is no block at all.
void test("Near-fences are not fences", async (t) => {
  t.check(split("---\na: 1\n---x\nb: 2\n---\nbody").frontmatterText, "a: 1\n---x\nb: 2");
  t.check(split("---\na: 1\n----\n---\nbody").frontmatterText, "a: 1\n----");
  t.check(split(" ---\na: 1\n---\nbody").hasFrontmatter, false);
  t.check(split("a: 1\n---\nbody").hasFrontmatter, false);
  t.check(split("---\na: 1\nno closing fence\n").hasFrontmatter, false);
});

// Line-based editors use the offsets to edit inside the block in place.
void test("frontmatterFence gives the block's text and body offsets", async (t) => {
  const text = "﻿--- \r\ntitle: x\r\n---\r\nbody";
  const fence = frontmatterFence(text);
  t.check(fence, { textStart: 7, textEnd: 15, bodyStart: 22, closingLine: 2 });
  t.check(frontmatterFence("---\n---\nbody")?.closingLine, 1);
  t.check(frontmatterFence("---\na: 1\nb: 2\n---")?.closingLine, 3);
  t.check(fence === null ? null : [text.slice(fence.textStart, fence.textEnd), text.slice(fence.bodyStart)], ["title: x", "body"]);
  t.check(frontmatterFence("no block"), null);
});

// ## Editing one key in place
//
// The web editors (card theme, landmark theme, browser task close) refuse a
// block that does not parse or is not a mapping, treat an empty block as an
// empty mapping, and write long values on one line.
void test("editableFrontmatterDocument refuses non-mappings; renderFrontmatterDocument keeps the body", async (t) => {
  t.check([editableFrontmatterDocument("- a\n- b"), editableFrontmatterDocument("a: [unclosed")], [null, null]);
  const empty = editableFrontmatterDocument("");
  empty?.set("closed", true);
  t.check(empty === null ? null : renderFrontmatterDocument(empty, "body\n"), "---\nclosed: true\n---\nbody\n");
  const long = "word ".repeat(30).trim();
  const doc = editableFrontmatterDocument("# keep me\ntitle: x\n");
  doc?.set("summary", long);
  t.check(doc === null ? null : renderFrontmatterDocument(doc, ""), `---\n# keep me\ntitle: x\nsummary: ${long}\n---\n`);
});


// Unit tests for commit-blocklist-check.ts's pure functions. No git — feeds
// synthetic blocklist text and `git diff --cached -U0` output. Run with:
//   node --import tsx --test bin/commit-blocklist-check.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import { BlocklistError, findBlocked, parseAddedLines, parseBlocklist } from "./commit-blocklist-check.js";

test("parseBlocklist skips blanks and comments, keeps file line numbers", () => {
  const entries = parseBlocklist("# header\n\nfoo.example\n\n  # indented comment\nbar.example\n");
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.line, 3); // foo.example is on line 3 of the file
  assert.equal(entries[1]!.line, 6);
});

test("literal entries match case-insensitively as substrings; dots are literal", () => {
  const [e] = parseBlocklist("box.internal");
  assert.equal(e!.test("see https://BOX.INTERNAL/x here"), true);
  assert.equal(e!.test("boxYinternal"), false); // the dot is literal, not regex `.`
});

test("re: entries are case-insensitive regex (e.g. word-bounded names)", () => {
  const [e] = parseBlocklist("re:\\bJane Doe\\b");
  assert.equal(e!.test("contact jane doe today"), true);
  assert.equal(e!.test("Jane Doelan"), false); // word boundary blocks the substring
});

test("an invalid regex fails closed via BlocklistError", () => {
  assert.throws(() => parseBlocklist("re:(unclosed"), BlocklistError);
});

test("an empty re: pattern is ignored, not a match-everything footgun", () => {
  assert.deepEqual(parseBlocklist("re:"), []);
});

test("parseAddedLines returns only + lines with correct new-file line numbers", () => {
  const diff = [
    "diff --git a/docs/a.md b/docs/a.md",
    "index 111..222 100644",
    "--- a/docs/a.md",
    "+++ b/docs/a.md",
    "@@ -4,0 +5,2 @@ some context",
    "+first added line",
    "+second added line",
    "@@ -10 +12 @@",
    "-a removed line",
    "+a replacement line",
  ].join("\n");
  assert.deepEqual(parseAddedLines(diff), [
    { file: "docs/a.md", lineno: 5, text: "first added line" },
    { file: "docs/a.md", lineno: 6, text: "second added line" },
    { file: "docs/a.md", lineno: 12, text: "a replacement line" },
  ]);
});

test("parseAddedLines ignores deletions and /dev/null (deleted files)", () => {
  const diff = ["--- a/gone.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "-was here"].join("\n");
  assert.deepEqual(parseAddedLines(diff), []);
});

test("findBlocked reports file:line + entry line, never the matched value", () => {
  const entries = parseBlocklist("secret-term\n");
  const added = [{ file: "x.md", lineno: 7, text: "this adds SECRET-TERM inline" }];
  const hits = findBlocked(added, entries);
  assert.deepEqual(hits, [{ file: "x.md", lineno: 7, entry: 1 }]);
  // The Hit shape carries no value field — nothing to re-leak.
  assert.equal("value" in hits[0]!, false);
});

test("findBlocked emits one hit per offending line (first matching entry wins)", () => {
  const entries = parseBlocklist("alpha\nbeta\n");
  const added = [{ file: "x", lineno: 1, text: "alpha and beta together" }];
  assert.equal(findBlocked(added, entries).length, 1);
});

test("clean staged additions produce no hits", () => {
  const entries = parseBlocklist("secret-term\n");
  const added = [{ file: "x", lineno: 1, text: "nothing sensitive here" }];
  assert.deepEqual(findBlocked(added, entries), []);
});

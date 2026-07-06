// Unit tests for commit-blocklist-check.ts's pure functions. No git — feeds
// synthetic blocklist text and `git diff --cached -U0` output. Run with:
//   node --import tsx --test bin/commit-blocklist-check.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import { BlocklistError, findBlocked, parseAddedLines, parseBlocklist } from "./commit-blocklist-check.js";

test("parseBlocklist classifies block / allow / ignore, skips blanks + comments, keeps line numbers", () => {
  const entries = parseBlocklist("# header\n\nfoo\n!bar\nfile:*.md\n");
  assert.deepEqual(
    entries.map((e) => [e.line, e.kind]),
    [
      [3, "block"],
      [4, "allow"],
      [5, "ignore"],
    ],
  );
});

test("literal block matches case-insensitively as a substring; dots are literal", () => {
  const entries = parseBlocklist("box.internal");
  assert.equal(findBlocked([{ file: "x", lineno: 1, text: "see BOX.INTERNAL/x" }], entries).length, 1);
  assert.equal(findBlocked([{ file: "x", lineno: 1, text: "boxYinternal" }], entries).length, 0);
});

test("re: block is a case-insensitive regex (word-bounded, no over-match)", () => {
  const entries = parseBlocklist("re:\\bFoo\\b");
  assert.equal(findBlocked([{ file: "x", lineno: 1, text: "the foo bar" }], entries).length, 1);
  assert.equal(findBlocked([{ file: "x", lineno: 1, text: "a Football match" }], entries).length, 0);
});

test("an invalid regex fails closed via BlocklistError", () => {
  assert.throws(() => parseBlocklist("re:(unclosed"), BlocklistError);
});

test("empty re: and bare ! are ignored, not match-everything footguns", () => {
  assert.deepEqual(parseBlocklist("re:\n!\n"), []);
});

test("an allow rule un-blocks a match whose span it covers", () => {
  const entries = parseBlocklist("Marlowe\n!@marlowe\n");
  const added = [{ file: "x", lineno: 1, text: "@marlowe/some-pkg" }];
  assert.deepEqual(findBlocked(added, entries), []); // 'marlowe' sits inside '@marlowe' → suppressed
});

test("an allow rule does NOT un-block a match outside its span (no smuggling)", () => {
  const entries = parseBlocklist("Marlowe\n!@marlowe\n");
  const added = [{ file: "x", lineno: 1, text: "Priya Marlowe and @marlowe" }];
  assert.equal(findBlocked(added, entries).length, 1); // standalone 'Marlowe' isn't covered
});

test("file: ignore skips a matching file entirely; others still checked", () => {
  const entries = parseBlocklist("secret\nfile:package.json\n");
  const added = [
    { file: "callback-box/package.json", lineno: 1, text: "has a secret here" },
    { file: "src/x.ts", lineno: 2, text: "has a secret here" },
  ];
  // no-slash glob matches package.json by basename at any depth; src/x.ts still blocks
  assert.deepEqual(findBlocked(added, entries), [{ file: "src/x.ts", lineno: 2, entry: 1 }]);
});

test("file: glob with a slash matches the full path, ** crosses directories", () => {
  const entries = parseBlocklist("secret\nfile:docs/**\n");
  const added = [
    { file: "docs/a/b.md", lineno: 1, text: "secret" },
    { file: "src/docs.ts", lineno: 2, text: "secret" },
  ];
  assert.deepEqual(findBlocked(added, entries), [{ file: "src/docs.ts", lineno: 2, entry: 1 }]);
});

test("findBlocked reports file:line + entry line, never a value, one hit per line", () => {
  const entries = parseBlocklist("alpha\nbeta\n");
  const hits = findBlocked([{ file: "x.md", lineno: 7, text: "alpha and beta" }], entries);
  assert.deepEqual(hits, [{ file: "x.md", lineno: 7, entry: 1 }]);
  assert.equal("value" in hits[0]!, false);
});

test("parseAddedLines returns only + lines with correct new-file line numbers", () => {
  const diff = [
    "diff --git a/docs/a.md b/docs/a.md",
    "index 111..222 100644",
    "--- a/docs/a.md",
    "+++ b/docs/a.md",
    "@@ -4,0 +5,2 @@ ctx",
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

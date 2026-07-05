// Unit test for path-leak-check.ts's pure findLeaks() matcher. No git — feeds
// it synthetic `git grep -nI` output. Run with:
//   node --import tsx --test bin/path-leak-check.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { test } from "node:test";
import { findLeaks } from "./path-leak-check.js";

// Build the flagged literals by concatenation so this test file itself never
// contains a matchable `/Users/<realname>/` — the guard scans it too.
const U = "/Users/";
const H = "/home/";

test("flags a real personal macOS home", () => {
  const out = findLeaks(`docs/report.md:42:  Evidence: ${U}janedoe/src/foo.ts`);
  assert.deepEqual(out, [`home path leak: docs/report.md:42 -> ${U}janedoe/`]);
});

test("flags a real personal Linux home", () => {
  const out = findLeaks(`notes.md:7:see ${H}janedoe/project`);
  assert.deepEqual(out, [`home path leak: notes.md:7 -> ${H}janedoe/`]);
});

test("allows deploy service accounts and placeholders", () => {
  const lines = [
    `deploy/README.md:5:cd ${H}callback/app`,
    `docs/box.md:9:${H}cb-test1/content`,
    `schemas/extfile.tsx:74:file:${U}me/src/x.ts`,
    `test/x.doctest.md:3:${U}x/tmp`,
    `test/y.doctest.md:4:${H}user/box`,
  ].join("\n");
  assert.deepEqual(findLeaks(lines), []);
});

test("a bare web route without a trailing name-slash never matches", () => {
  assert.deepEqual(findLeaks(`src/routes.ts:12:app.get("${H}dashboard")`), []);
});

test("reports every offending segment on a line", () => {
  const out = findLeaks(`m.md:1:${U}ann/a and ${U}bob/b`);
  assert.deepEqual(out, [
    `home path leak: m.md:1 -> ${U}ann/`,
    `home path leak: m.md:1 -> ${U}bob/`,
  ]);
});

test("ignores lines that don't parse as path:lineno:content", () => {
  assert.deepEqual(findLeaks(""), []);
  assert.deepEqual(findLeaks("no-colons-here"), []);
});

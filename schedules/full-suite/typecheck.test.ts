/** The typecheck alert body (typecheck.ts). Run with `pnpm test` at the repo root. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { renderTypecheckAlert } from "./typecheck.js";

test("a long checker output is cut, saying how much was left out", () => {
  const output = Array.from({ length: 75 }, (_, i) => `test/x.test.ts:${String(i + 1)}:1 - error TS2345: …`).join("\n");
  const body = renderTypecheckAlert({ testedCommit: "0123456789ab", output, landings: [] });
  assert.match(body, /test\/x\.test\.ts:60:1/);
  assert.doesNotMatch(body, /test\/x\.test\.ts:61:1/);
  assert.match(body, /… 15 more lines/);
});

test("the batch's landings are listed as the candidates", () => {
  const body = renderTypecheckAlert({
    testedCommit: "0123456789ab",
    output: "x.test.ts:3:1 - error TS2554: Expected 1 arguments, but got 2.",
    landings: [{ commit: "aaaaaaaa1111", subject: "Rename the capture API" }],
  });
  assert.match(body, /^`01234567` does not typecheck/);
  assert.match(body, /- `a{8}` Rename the capture API/);
});

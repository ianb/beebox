// # isRecord
//
// Narrows an `unknown` to a plain string-keyed object — the blessed replacement
// for the `value as Record<string, unknown>` cast that follows a `typeof` check.
// See `src/shared/is-record.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isRecord } from "../../src/shared/is-record.js";

// A plain object narrows to a record, so string-key access needs no cast:
void test("A plain object narrows to a record, so string-key access needs no cast:", async (t) => {
  // doctest:L14
  const value: unknown = { pid: 42, host: "a" };
  t.check(isRecord(value) && typeof value["pid"] === "number" ? value : null, { pid: 42, host: "a" });
});

// `null`, arrays, and non-objects are rejected — the cases a bare
// `as Record<string, unknown>` would wrongly wave through:
void test("null, arrays, and non-objects are rejected — the cases a bare as Record<strin...", async (t) => {
  // doctest:L23
  t.check(isRecord(null), false);

  // doctest:L26
  t.check(isRecord([1, 2, 3]), false);

  // doctest:L29
  t.check(isRecord("string"), false);
});

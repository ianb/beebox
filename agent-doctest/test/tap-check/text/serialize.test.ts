// # serialize
//
// `serialize()` converts any value to a string for comparison in `check()`. It tries registered serializers first, then falls back to sensible defaults.

import { test } from "tap";
import "agent-doctest/tap";
import { serialize } from "../../../src/tap-check/text/compare.js";

// Strings pass through unchanged:
void test("Strings pass through unchanged:", async (t) => {
  // doctest:L12
  t.check(serialize("hello"), "hello");
});

// Numbers and primitives use `String()`:
void test("Numbers and primitives use String():", async (t) => {
  // doctest:L19
  await t.checkText(serialize(42), "42");
});

// `null` and `undefined` become their names:
void test("null and undefined become their names:", async (t) => {
  // doctest:L26
  await t.checkText(serialize(null), "null");
});

void test("line 30", async (t) => {
  // doctest:L31
  await t.checkText(serialize(undefined), "undefined");
});

// Objects get `JSON.stringify` with 2-space indent:
void test("Objects get JSON.stringify with 2-space indent:", async (t) => {
  // doctest:L38
  await t.checkText(serialize({ a: 1, b: "two" }), `{
  "a": 1,
  "b": "two"
}`);
});

void test("line 46", async (t) => {
  // doctest:L47
  await t.checkText(serialize([1, 2, 3]), `[
  1,
  2,
  3
]`);
});

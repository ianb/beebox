// # print() in doctests
//
// Verify that `print()` is available as a scope-local function in doctest blocks.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { printed } from "@ianbicking/tap-check/check";

// ## Basic print
void test("Basic print", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L8
  print("hello");
  print("world");
  t.check(out.with("done"), "hello\nworld\ndone");
});

// ## Print then a final line
void test("Print then a final line", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L22
  print("line 1");
  print("line 2");
  t.check(out.with("line 3"), "line 1\nline 2\nline 3");
});

// ## Print drains after each check
//
// After an assertion, the print buffer resets.
void test("After an assertion, the print buffer resets.", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L36
  print("first");
  t.check(out.with("a"), "first\na");

  // doctest:L42
  print("second");
  t.check(out.with("b"), "second\nb");
});

// ## Print with objects
//
// Print lines are plain strings; serialize an object yourself to print it.
void test("Print lines are plain strings; serialize an object yourself to print it.", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L54
  print("result:");
  t.check(out.with(JSON.stringify({ status: "ok", count: 2 }, null, 2)), "result:\n{\n  \"status\": \"ok\",\n  \"count\": 2\n}");
});

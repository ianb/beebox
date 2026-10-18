// # print() in doctests
//
// Verify that `print()` is available as a scope-local function in doctest blocks.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";

// ## Basic print
void test("Basic print", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L8
  print("hello");
  print("world");
  await t.checkText(out.with("done"), `hello
world
done`);
});

// ## Print with no return value
//
// When the expression itself is `print(...)`, it returns undefined (excluded from output).
void test("When the expression itself is print(...), it returns undefined (excluded from...", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L22
  print("line 1");
  print("line 2");
  await t.checkText(out.with(print("line 3")), `line 1
line 2
line 3`);
});

// ## Print drains after each check
//
// After an assertion, the print buffer resets.
void test("After an assertion, the print buffer resets.", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L36
  print("first");
  await t.checkText(out.with("a"), `first
a`);

  // doctest:L42
  print("second");
  await t.checkText(out.with("b"), `second
b`);
});

// ## Print with objects
//
// Print lines are plain strings; the expression result is serialized normally.
void test("Print lines are plain strings; the expression result is serialized normally.", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L54
  print("result:");
  await t.checkText(out.with(({ status: "ok", count: 2 })), `result:
{
  "status": "ok",
  "count": 2
}`);
});

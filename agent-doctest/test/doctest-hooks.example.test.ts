// # Example doctest
//
// This is a simple example showing how doctests work. Each fenced code block becomes a test case. Prose between blocks is ignored — use it to explain what you're testing.
//
// ## Basic assertions

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";

// ## Setup blocks
//
// Use `ts setup` blocks for imports and helpers shared across all tests in the file:
function greet(name: string) {
  return `Hello, ${name}!`;
}

// Non-throwing expressions fail the assertion:
function mustThrow(fn: () => unknown) {
  try { fn(); return "did not throw"; } catch(_e) { return "threw"; }
}

// Expressions followed by `=>` are checked against the expected value:
void test("Expressions followed by => are checked against the expected value:", async (t) => {
  // doctest:L10
  t.check(1 + 1, 2);
});

// String results are compared literally (no quotes needed):
void test("String results are compared literally (no quotes needed):", async (t) => {
  // doctest:L17
  t.check("hello world".toUpperCase(), "HELLO WORLD");
});

// A checked line may end in a comment:
void test("A checked line may end in a comment:", async (t) => {
  // doctest:L24
  t.check(
    1 + 1 // the comment is the author's, not part of the value
    ,
    2,
  );
});

// ## Multiple examples in one block
//
// Examples in the same block share scope — variables persist between them:
void test("Examples in the same block share scope — variables persist between them:", async (t) => {
  // doctest:L33
  const items = ["a", "b", "c"];
  t.check(items.length, 3);

  // doctest:L37
  t.check(items.join(", "), "a, b, c");

  // doctest:L40
  t.check(items.reverse().join(", "), "c, b, a");
});

void test("Setup blocks", async (t) => {
  // doctest:L55
  t.check(greet("World"), "Hello, World!");
});

// ## Multi-line results
//
// Use `=>` alone on a line, then the expected output continues until a blank line:
void test("Use => alone on a line, then the expected output continues until a blank line:", async (t) => {
  // doctest:L64
  t.check({ name: "Alice", age: 30 }, {
    name: "Alice",
    age: 30,
  });
});

// ## Statements and expressions
//
// Lines ending with `;` are run as statements. The last non-semicolon expression is the one checked:
void test("Lines ending with ; are run as statements.", async (t) => {
  // doctest:L77
  const numbers = [1, 2, 3, 4, 5];
  const evens = numbers.filter(n => n % 2 === 0);
  t.check(evens.join(" "), "2 4");
});

// ## No assertion — just run
//
// Blocks without `=>` just verify the code doesn't throw:
void test("Blocks without => just verify the code doesn't throw:", async (t) => {
  // doctest:L88
  const x = new Map();
  x.set("key", "value");
});

// ## Continue blocks
//
// Use `continue` to split a test across multiple blocks while sharing scope:
void test("Use continue to split a test across multiple blocks while sharing scope:", async (t) => {
  // doctest:L97
  const counter = { value: 0 };
  t.check(counter.value, 0);

  // Increment and check again — same `counter` variable:

  // doctest:L105
  counter.value += 1;
  t.check(counter.value, 1);
});

// ## The print() function
//
// Each test gets a `print()` function. Printed lines drain into the next assertion:
void test("Each test gets a print() function.", async (t) => {
  const out2 = printed();
  const print = out2.print;
  // doctest:L115
  print("step 1");
  print("step 2");
  await t.checkText(out2.with("done"), `step 1
step 2
done`);
});

// ## Throws assertions
//
// Use `=> throws ErrorName` to assert that an expression throws:
void test("Use => throws ErrorName to assert that an expression throws:", async (t) => {
  // doctest:L128
  await t.checkThrows(async () => (JSON.parse("{bad json")), "SyntaxError");
});

// Include `: message` to also check the error message:
void test("Include :", async (t) => {
  // doctest:L135
  await t.checkThrows(async () => (new Array<number>().reduce((sum, n) => sum + n)), "TypeError: Reduce of empty array with no initial value");
});

// Await-containing expressions work too — a rejected promise counts as the
// throw:
void test("Await-containing expressions work too — a rejected promise counts as the throw:", async (t) => {
  // doctest:L143
  await t.checkThrows(async () => (await Promise.reject(new RangeError("out of range"))), "RangeError: out of range");
});

void test("Throws assertions", async (t) => {
  // doctest:L156
  t.check(mustThrow(() => { const x = 1 + 1; return x; }), "did not throw");
});

// ## Multi-line template literals
//
// Template literals can span lines inside example blocks. Blank lines,
// `=>`-like lines, and `;` line-endings inside the literal are string
// content, not example/statement boundaries — and the content round-trips
// exactly, with no indentation injected by the transform.
void test("Template literals can span lines inside example blocks.", async (t) => {
  // doctest:L168
  const doc = `line one

  two-space indented line
=> looks like an arrow but is content
end`;
  t.check(doc.split("\n").length, 5);

  // doctest:L176
  t.check(doc.includes("\n  two-space indented line\n"), true);
});

// upgradeExpected(): which doctest expected texts become a typed t.check
// literal, and what each becomes. Whether a literal fits the actual value is
// decided later by typecheck and the run.

import { test } from "tap";
import { unwrapStringify, upgradeExpected } from "../../src/convert/upgrade.js";

const literal = (text: string): string => {
  const u = upgradeExpected(text);
  return u.kind === "typed" ? u.literal : `TEXT: ${u.reason}`;
};

void test("scalars and bare words", async (t) => {
  t.check(literal("300000"), "300000");
  t.check(literal("true"), "true");
  t.check(literal("null"), "null");
  t.check(literal("undefined"), "undefined");
  t.check(literal("b.txt"), '"b.txt"');
  t.check(literal('"quoted"'), '"quoted"');
});

void test("objects and arrays print as TypeScript literals, one entry per line", async (t) => {
  t.check(literal('{ status: 410, code: "GONE" }'), '{\n  status: 410,\n  code: "GONE",\n}');
  t.check(literal('{"a":[1,2]}'), "{\n  a: [\n    1,\n    2,\n  ],\n}");
});

void test("whole-value wildcards become patterns", async (t) => {
  t.check(literal("{ id: «uuid», n: «int», at: «date», x: «*» }"), "{\n  id: uuid(),\n  n: any(Number).int(),\n  at: isoDate(),\n  x: anything(),\n}");
  t.check(literal("{ id: «noteId=uuid» }"), "{\n  id: uuid(),\n}");
  t.check(upgradeExpected("{ id: «uuid» }"), { kind: "typed", literal: "{\n  id: uuid(),\n}", patterns: new Set(["uuid"]) });
});

void test("a wildcard inside a string becomes a str template", async (t) => {
  t.check(literal('{ path: "/notes/«uuid».md" }'), "{\n  path: str`/notes/${uuid()}.md`,\n}");
  t.check(literal("saved «int» cards"), String.raw`str` + "`saved ${any(String).matches(/^-?\\d+$/)} cards`");
  t.check(literal("a `tick` and «*»"), "str`a \\`tick\\` and ${any(String)}`");
});

void test("what stays a text check", async (t) => {
  t.check(literal("«show»"), "TEXT: show");
  t.check(literal("«*»"), "TEXT: wildcard as the whole value");
  t.check(literal("«int»"), "TEXT: wildcard as the whole value");
  t.check(literal("first\nsecond"), "TEXT: multi-line text");
  t.check(literal("{ «key»: 1 }"), "TEXT: structure that is not a literal");
  t.check(literal("Map(1) { 'a' => 1 }"), "TEXT: structure that is not a literal");
  t.check(literal("x «blankline» y"), "TEXT: wildcard type not expressible");
});

void test("JSON.stringify(x) as the checked expression unwraps to x", async (t) => {
  t.check(unwrapStringify("JSON.stringify(user)"), { inner: "user", textOf: "(v) => JSON.stringify(v)" });
  t.check(unwrapStringify("JSON.stringify(f(a, [b, c]), null, 2)"), { inner: "f(a, [b, c])", textOf: "(v) => JSON.stringify(v, null, 2)" });
  t.check(unwrapStringify('JSON.stringify(s.split(","))'), { inner: 's.split(",")', textOf: "(v) => JSON.stringify(v)" });
  // A replacer changes the text; a call that continues past the parens is not the whole expression.
  t.check(unwrapStringify("JSON.stringify(x, ['a'])"), null);
  t.check(unwrapStringify("JSON.stringify(x).length"), null);
  t.check(unwrapStringify("JSON.stringify(a) + JSON.stringify(b)"), null);
});

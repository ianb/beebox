// t.check: whole-value comparison against a typed expected value.
//
// Most cases call `checkValue`, the pure comparison behind `t.check`, so a
// failure's report can itself be checked. The last group calls `t.check`
// through tap to cover promises and captures end to end.

import { test } from "tap";
import "../../../src/tap-check/tap.js";
import {
  any,
  anything,
  capture,
  checkValue,
  containing,
  NO_EXPECTED,
  instanceOf,
  is,
  isoDate,
  not,
  notAllowed,
  oneOf,
  optional,
  others,
  str,
  unordered,
  uuid,
} from "../../../src/exports/check.js";

const ID = "0b9c6f0e-6c43-4c8e-9a52-0d6a7c1d2e3f";

/** The failure report as one text, for checking with checkText. */
function report(actual: unknown, expected: unknown): string {
  const outcome = checkValue(actual, expected);
  if (outcome.pass) return "pass";
  const parts = [outcome.message];
  if (outcome.mismatches !== undefined) parts.push(`mismatches:\n${outcome.mismatches}`);
  parts.push(`suggested:\n${outcome.suggested}`);
  if (outcome.generalized !== undefined) parts.push(`generalized:\n${outcome.generalized}`);
  return parts.join("\n");
}

function passes(actual: unknown, expected: unknown): boolean {
  return checkValue(actual, expected).pass;
}

void test("equal values pass, whatever the key order", async (t) => {
  t.ok(passes({ a: 1, b: { c: [1, 2], d: "x" } }, { b: { d: "x", c: [1, 2] }, a: 1 }));
  t.ok(passes([1, "two", null, true], [1, "two", null, true]));
  t.ok(passes(Number.NaN, Number.NaN));
});

void test("an extra key fails: matching is exact", async (t) => {
  t.checkText(report({ id: 1, name: "a", extra: true }, { id: 1, name: "a" }), `check failed: 1 mismatch
mismatches:
$.extra: unexpected key; matching is exact (list it, or add [others])
  actual: true
suggested:
{
  id: 1,
  name: "a",
  extra: true,
}`);
});

void test("a missing key fails", async (t) => {
  t.checkText(report({ id: 1 }, { id: 1, name: "a" }), `check failed: 1 mismatch
mismatches:
$.name: missing key
  expected: "a"
suggested:
{
  id: 1,
}`);
});

void test("a nested difference names its path", async (t) => {
  t.checkText(report({ items: [{ id: 1, tags: ["a", "b"] }] }, { items: [{ id: 1, tags: ["a", "c"] }] }), `check failed: 1 mismatch
mismatches:
$.items[0].tags[1]: not equal
  expected: "c"
  actual: "b"
suggested:
{
  items: [
    {
      id: 1,
      tags: [
        "a",
        "b",
      ],
    },
  ],
}`);
});

void test("array length differences are missing or unexpected items", async (t) => {
  t.checkText(report([1, 2, 3], [1, 2]), `check failed: 1 mismatch
mismatches:
$[2]: unexpected item
  actual: 3
suggested:
[
  1,
  2,
  3,
]`);
  t.checkText(report([1], [1, 2]), `check failed: 1 mismatch
mismatches:
$[1]: missing item
  expected: 2
suggested:
[
  1,
]`);
});

void test("a wrong kind of value says what was expected", async (t) => {
  t.checkText(report([1], { a: 1 }), `check failed: 1 mismatch
mismatches:
$: expected an object
  expected: an object
  actual: [
    1,
  ]
suggested:
[
  1,
]`);
});

void test("a key with an undefined value is compared; a function-valued key is not", async (t) => {
  t.ok(passes({ a: 1, b: undefined }, { a: 1, b: undefined }));
  t.notOk(passes({ a: 1, b: undefined }, { a: 1 }), "an undefined-valued key must be listed");
  t.notOk(passes({ a: 1 }, { a: 1, b: undefined }), "a listed key must exist");
  t.ok(passes({ a: 1, f: () => 1 }, { a: 1 }), "methods and callbacks are not data");
});

void test("a class instance compares by its own data", async (t) => {
  class Point {
    constructor(readonly x: number, readonly y: number) {}
    norm(): number {
      return Math.hypot(this.x, this.y);
    }
  }
  t.ok(passes(new Point(1, 2), { x: 1, y: 2 }));
  t.notOk(passes(new Point(1, 2), { x: 1, y: 3 }));
});

void test("an Error compares name, message, and its own data", async (t) => {
  const err = Object.assign(new TypeError("bad input"), { code: "E_BAD" });
  t.ok(passes(err, { name: "TypeError", message: "bad input", code: "E_BAD" }));
  t.checkText(report(err, { name: "TypeError", message: "bad input" }), `check failed: 1 mismatch
mismatches:
$.code: unexpected key; matching is exact (list it, or add [others])
  actual: "E_BAD"
suggested:
{
  name: "TypeError",
  message: "bad input",
  code: "E_BAD",
}`);
});

void test("Map compares entries in order; Set compares members in order", async (t) => {
  t.ok(passes(new Map([["a", 1], ["b", 2]]), new Map([["a", 1], ["b", 2]])));
  t.notOk(passes(new Map([["a", 1], ["b", 2]]), new Map([["b", 2], ["a", 1]])));
  t.ok(passes(new Set([1, 2]), new Set([1, 2])));
  t.checkText(report(new Map([["a", { n: 1 }]]), new Map([["a", { n: 2 }]])), `check failed: 1 mismatch
mismatches:
$.get("a").n: not equal
  expected: 2
  actual: 1
suggested:
new Map([
  ["a", {
    n: 1,
  }],
])`);
});

void test("a Date matches an equal Date or its ISO string", async (t) => {
  const when = new Date("2026-10-17T12:00:00.000Z");
  t.ok(passes(when, new Date("2026-10-17T12:00:00.000Z")));
  t.ok(passes({ at: when }, { at: "2026-10-17T12:00:00.000Z" }));
  t.ok(passes({ at: when }, { at: isoDate() }));
  t.notOk(passes(when, new Date("2026-10-17T12:00:01.000Z")));
});

void test("patterns: any, refinements, uuid, isoDate, oneOf", async (t) => {
  t.ok(passes({ id: ID, n: 3, flag: true, at: "2026-10-17T12:00:00Z" }, {
    id: uuid(),
    n: any(Number).int().between(1, 5),
    flag: any(Boolean),
    at: isoDate(),
  }));
  t.ok(passes("/box/notes/today", any(String).startsWith("/box/").endsWith("/today").includes("notes")));
  t.ok(passes("abc-123", any(String).matches(/^[a-z]+-\d+$/)));
  t.ok(passes(0.1 + 0.2, any(Number).closeTo(0.3, 1e-9)));
  t.ok(passes(7.9, any(Number).below(8)));
  t.notOk(passes(8, any(Number).below(8)), "below is strict");
  t.notOk(passes(1000, any(Number).above(1000)), "above is strict");
  t.ok(passes("open", oneOf("open", "closed")));
  t.ok(passes("b2", not("a1")));
  t.notOk(passes("a1", not("a1")));
  t.ok(passes("<p>ok</p>", not(any(String).includes("<script"))));
  t.notOk(passes("<script>x</script>", not(any(String).includes("<script"))));
  const first = { n: 1 };
  t.ok(passes(first, is(first)));
  t.notOk(passes({ n: 1 }, is(first)), "an equal copy is not the same object");
  t.ok(passes({ n: 1 }, not(is(first))), "a different object");
  t.notOk(passes(first, not(is(first))));
  t.check([is(-0).source, is(1n).source, not(Number.NaN).source, not(Infinity).source, is(first).source], ["is(-0)", "is(1n)", "not(NaN)", "not(Infinity)", "is(<reference>)"]);
  t.ok(passes(new RangeError("x"), instanceOf(Error)));
  t.notOk(passes(new Error("x"), instanceOf(RangeError)));
  t.checkText(report({ n: 7 }, { n: any(Number).int().between(1, 5) }), `check failed: 1 mismatch
mismatches:
$.n: does not match .between(1, 5)
  expected: any(Number).int().between(1, 5)
  actual: 7
suggested:
{
  n: 7,
}`);
  t.checkText(report({ status: "draft" }, { status: oneOf("open", "closed") }), `check failed: 1 mismatch
mismatches:
$.status: does not match oneOf("open", "closed")
  expected: oneOf("open", "closed")
  actual: "draft"
suggested:
{
  status: "draft",
}`);
});

void test("str: patterns inside a string", async (t) => {
  t.ok(passes("/box/abc/notes", str`/box/${any(String)}/notes`));
  t.ok(passes(`id-${ID}`, str`id-${uuid()}`));
  t.checkText(report("/box/abc/notes", str`/box/${any(String).startsWith("x")}/notes`), `check failed: 1 mismatch
mismatches:
$: does not match str\`/box/\${any(String).startsWith("x")}/notes\`
  expected: str\`/box/\${any(String).startsWith("x")}/notes\`
  actual: "/box/abc/notes"
suggested:
"/box/abc/notes"`);
});

void test("[others]: keys not listed must match one pattern", async (t) => {
  t.ok(passes({ id: 1, a: 2, b: 3 }, { id: 1, [others]: any(Number) }));
  t.ok(passes({ id: 1 }, { id: 1, [others]: notAllowed() }));
  t.notOk(passes({ id: 1, a: 2 }, { id: 1, [others]: notAllowed() }));
  t.checkText(report({ id: 1, a: 2, b: "x" }, { id: 1, [others]: any(Number) }), `check failed: 1 mismatch
mismatches:
$.b: does not match a number
  expected: any(Number)
  actual: "x"
suggested:
{
  id: 1,
  b: "x",
  [others]: any(Number),
}`);
});

void test("optional: a key that may be absent", async (t) => {
  t.ok(passes({ id: 1 }, { id: 1, note: optional(any(String)) }));
  t.ok(passes({ id: 1, note: "x" }, { id: 1, note: optional(any(String)) }));
  t.notOk(passes({ id: 1, note: 3 }, { id: 1, note: optional(any(String)) }));
});

void test("unordered: a multiset match", async (t) => {
  t.ok(passes([3, 1, 2], unordered([1, 2, 3])));
  t.ok(passes([{ id: "b" }, { id: "a" }], unordered([{ id: "a" }, { id: "b" }])));
  // Multiplicity counts: two 1s are not one 1.
  t.notOk(passes([1, 1], unordered([1])));
  t.notOk(passes([1], unordered([1, 1])));
  // A general pattern listed first must not take the item a literal needs.
  t.ok(passes(["x", "y"], unordered([any(String), "x"])));
  t.checkText(report([1, 4], unordered([1, 2])), `check failed: 2 mismatches
mismatches:
$[1]: unordered: no expected item matches this actual item
  actual: 4
$: unordered: no actual item matches this expected item
  expected: 2
suggested:
unordered([
  1,
  4,
])`);
});

void test("containing: these items among others", async (t) => {
  t.ok(passes([3, 1, 2], containing([1, 3])));
  t.ok(passes([{ id: "b" }, { id: "a" }], containing([{ id: "a" }])));
  t.ok(passes([], containing([])));
  // Multiplicity still counts.
  t.notOk(passes([1], containing([1, 1])));
  t.notOk(passes("1", containing(["1"])));
  // Nothing to keep: the suggestion is the empty array itself, not containing([]).
  t.match(report([], containing([2])), /suggested:\n\[]$/);
  t.checkText(report([1, 4], containing([2])), `check failed: 1 mismatch
mismatches:
$: containing: no actual item matches this expected item
  expected: 2
suggested:
containing([
  1,
  4,
])`);
});

void test("a suggestion keeps the patterns that matched", async (t) => {
  t.checkText(report({ id: ID, title: "Draft 2", at: "2026-10-17T12:00:00Z" }, { id: uuid(), title: "Draft 1", at: isoDate() }), `check failed: 1 mismatch
mismatches:
$.title: not equal
  expected: "Draft 1"
  actual: "Draft 2"
suggested:
{
  id: uuid(),
  title: "Draft 2",
  at: isoDate(),
}`);
});

void test("with no expected value, the suggestion generalizes volatile strings and says so", async (t) => {
  t.checkText(report({ id: ID, title: "Draft", created: "2026-10-17T12:00:00.000Z", day: "2026-10-17" }, NO_EXPECTED), `check() has no expected value; read the suggested value, then pass it as the second argument
suggested:
{
  id: uuid(),
  title: "Draft",
  created: isoDate(),
  day: "2026-10-17",
}
generalized:
$.id — UUID string
$.created — ISO timestamp`);
});

void test("anything() matches any value except undefined", async (t) => {
  t.ok(passes({ y: null }, { y: anything() }));
  t.ok(passes({ y: [1] }, { y: anything() }));
  t.notOk(passes({ y: undefined }, { y: anything() }));
});

void test("anything() as the whole expected value is refused", async (t) => {
  t.checkText(report({ a: 1 }, anything()), `check(x, anything()) checks nothing; write the expected value
suggested:
{
  a: 1,
}`);
});

void test("functions and promises cannot be compared", async (t) => {
  t.checkText(report({ run: Promise.resolve(1) }, { run: 1 }), `check failed: 1 mismatch
mismatches:
$.run: cannot compare a function, promise, WeakMap, or WeakSet; check a projection of it, or use checkText
  actual: {}
suggested:
{
  run: 1,
}`);
});

void test("a circular value prints without looping", async (t) => {
  const a: Record<string, unknown> = { name: "a" };
  a.self = a;
  t.checkText(report(a, { name: "b" }), `check failed: 2 mismatches
mismatches:
$.name: not equal
  expected: "b"
  actual: "a"
$.self: unexpected key; matching is exact (list it, or add [others])
  actual: {
    name: "a",
    self: [Circular],
  }
suggested:
{
  name: "a",
  self: {
    name: "a",
    self: [Circular],
  },
}`);
});

void test("the diff shows only real differences", async (t) => {
  const outcome = checkValue({ id: ID, n: 2, title: "x" }, { id: uuid(), n: any(Number), title: "y" });
  t.equal(outcome.pass, false);
  if (!outcome.pass && outcome.diff !== undefined) t.checkText(outcome.diff, `- expected
+ actual

  {
    id: "0b9c6f0e-6c43-4c8e-9a52-0d6a7c1d2e3f",
    n: 2,
-   title: "y",
+   title: "x",
  }`);
});

void test("capture keeps a matched value for a later check", async (t) => {
  const noteId = capture(uuid());
  t.check({ id: ID, title: "Draft" }, { id: noteId, title: "Draft" });
  t.check([{ id: ID, title: "Draft" }], [{ id: noteId.value, title: "Draft" }]);
  t.checkText(report({ id: ID, title: "Final" }, { id: capture(uuid()), title: "Draft" }), `check failed: 1 mismatch
mismatches:
$.title: not equal
  expected: "Draft"
  actual: "Final"
suggested:
{
  id: uuid(),
  title: "Final",
}`);
  t.throws(() => capture(uuid()).value, { message: "capture(uuid()) has not matched a value yet; run the check that uses it first" });
});

void test("review findings: no silent passes", async (t) => {
  // Keys are own keys: an inherited key does not satisfy a listed one.
  t.notOk(passes({}, { constructor: 1 }));
  // A "__proto__" own key is data, not lost.
  t.notOk(passes(Object.defineProperty({}, "__proto__", { value: 1, enumerable: true }), {}));
  // Symbol keys cannot be compared, so they fail rather than vanish.
  t.notOk(passes({ [Symbol("id")]: 1 }, {}));
  // Values with hidden state fail rather than match {}.
  t.notOk(passes(/a/, {}));
  t.notOk(passes(new Object(1), {}));
  t.notOk(passes(new ArrayBuffer(2), {}));
  class Secret {
    readonly #value = 1;
    reveal(): number {
      return this.#value;
    }
  }
  t.notOk(passes(new Secret(), {}));
  // -0 is not 0.
  t.notOk(passes(-0, 0));
  // A thenable inside a value cannot be compared.
  t.notOk(passes({ later: { then: () => 1 } }, { later: {} }));
  // An expected Error matches an equal Error.
  t.ok(passes(new TypeError("x"), new TypeError("x")));
  t.notOk(passes(new TypeError("x"), new RangeError("x")));
  // An invalid expected Date reports instead of throwing.
  t.notOk(passes(new Date(0), new Date("invalid")));
  // A RegExp compares by its source and flags.
  t.ok(passes(/a+/g, /a+/g));
  t.notOk(passes(/a+/g, /a+/));
  // A real "[others]" string key is not the [others] marker.
  t.checkText(report({ "[others]": 1 }, {}), `check failed: 1 mismatch
mismatches:
$["[others]"]: unexpected key; matching is exact (list it, or add [others])
  actual: 1
suggested:
{
  "[others]": 1,
}`);
});

void test("str tries every split, and keeps a captured run", async (t) => {
  t.ok(passes("xy", str`${any(String).startsWith("x")}${any(String)}`));
  const id = capture(uuid());
  t.ok(passes(`note-${ID}`, str`note-${id}`));
  t.equal(id.value, ID);
});

void test("t.check through tap awaits a promise", async (t) => {
  const first = capture(any(String));
  await t.check(Promise.resolve([{ id: ID }]), [{ id: first }]);
  t.equal(first.value, ID);
});

void test("mismatches name the likely fix", async (t) => {
  // A misspelled key: the missing key names the near-miss the actual has.
  t.match(report({ name: "bo" }, { nmae: "bo" }), /\$\.nmae: missing key; the actual has "name": is one of them misspelled\?/);
  // Markdown-test wildcards are literal text in t.check.
  t.match(report("count: 7", "count: «int»"), /t\.check does not read «» wildcards/);
  // A Date against a short date names what a Date matches.
  t.match(report(new Date("2026-10-18T00:00:00.000Z"), "2026-10-18"), /a Date matches its full ISO string \("2026-10-18T00:00:00\.000Z"\)/);
  // The right items in another order point at unordered().
  t.match(report(["new", "trial"], ["trial", "new"]), /\$: the same items in another order; if order does not matter, write unordered/);
  t.notMatch(report(["a", "b"], ["b", "c"]), /another order/);
  // The hint never fails a passing check: objects equal in another key order,
  // and values JSON cannot write.
  t.ok(passes([{ a: 1, b: 2 }, { b: 2, a: 1 }], [{ b: 2, a: 1 }, { a: 1, b: 2 }]));
  t.ok(passes([1n, 2n], [1n, 2n]));
});

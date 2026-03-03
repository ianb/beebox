import { test } from "tap";
import { check, inspect, CheckError, registerSerializer } from "../src/test-lib/check.js";
import "../src/test-lib/tap-check.js";

// ── Standalone check() — throwing API ──

test("check passes on exact match", async (t) => {
  check("hello", "hello"); // should not throw
  t.pass("exact match passed");
});

test("check throws CheckError on mismatch", async (t) => {
  t.throws(
    () => check("actual", "expected"),
    { name: "CheckError" },
  );
});

test("CheckError has diff, found, wanted", async (t) => {
  try {
    check("got this", "want this");
    t.fail("should have thrown");
  } catch (err) {
    t.ok(err instanceof CheckError);
    const e = err as CheckError;
    t.ok(e.diff.includes("got this"), "shows actual in diff");
    t.ok(e.diff.includes("want this"), "shows expected in diff");
    t.equal(e.found, "got this");
    t.equal(e.wanted, "want this");
  }
});

test("label appears in error message", async (t) => {
  try {
    check("a", { expected: "b", label: "my check" });
    t.fail("should have thrown");
  } catch (err) {
    const e = err as CheckError;
    t.ok(e.message.includes("my check"), "label in message");
  }
});

// ── t.check() — tap-integrated API ──

test("exact match", async (t) => {
  t.check("hello", "hello");
});

test("single-line diff points to first difference", async (t) => {
  const r = inspect("abcXef", "abcYef");
  t.equal((r as { pass: boolean }).pass, false);
  t.ok((r as { diff: string }).diff.includes("^"), "has caret marker");
});

test("multi-line diff shows line-by-line", async (t) => {
  const r = inspect("line1\nline2\nline3", "line1\nchanged\nline3");
  const diff = (r as { diff: string }).diff;
  t.ok(diff.includes("- line2"), "shows removed line");
  t.ok(diff.includes("+ changed"), "shows added line");
  t.ok(diff.includes("  line1"), "shows matching line");
});

// ── Wildcards ──

test("___ wildcard matches any text", async (t) => {
  t.check("hello world 123", "hello ___ 123");
  t.check("hello  123", "hello ___ 123"); // empty match
});

test("named wildcard ___foo___ matches any text", async (t) => {
  t.check("2026-03-02T20:00:00Z commit abc123: initial", "___date___ commit ___hash___: initial");
});

test("wildcard mismatch still fails", async (t) => {
  const r = inspect("hello world", "goodbye ___");
  t.equal((r as { pass: boolean }).pass, false);
});

test("multiple wildcards in sequence", async (t) => {
  t.check("start MIDDLE end", "start ___ end");
  t.check("a:b:c", "a___c");
});

// ── Serialization ──

test("serialize objects as JSON", async (t) => {
  t.check({ a: 1, b: [2, 3] }, `{
  "a": 1,
  "b": [
    2,
    3
  ]
}`);
});

test("serialize null and undefined", async (t) => {
  t.check(null, "null");
  t.check(undefined, "undefined");
});

test("serialize numbers", async (t) => {
  t.check(42, "42");
  t.check(3.14, "3.14");
});

test("custom serializer takes priority", async (t) => {
  registerSerializer((v) => {
    if (typeof v === "object" && v !== null && "custom" in v) {
      return `Custom<${(v as { custom: string }).custom}>`;
    }
    return null;
  });

  t.check({ custom: "test" }, "Custom<test>");
});

// ── Options ──

test("normalizeWhitespace collapses runs", async (t) => {
  t.check("  hello   world  ", {
    expected: "hello world",
    normalizeWhitespace: true,
  });
});

// ── Promise support ──

test("check awaits promises", async (t) => {
  await t.check(Promise.resolve("hello"), "hello");
});

test("check awaits promise and serializes result", async (t) => {
  await t.check(Promise.resolve({ x: 1 }), `{
  "x": 1
}`);
});

// ── Function support ──

test("function return value becomes actual", async (t) => {
  t.check((_print) => "computed", "computed");
});

test("function with print() captures output", async (t) => {
  t.check((print) => {
    print("line 1");
    print("line 2");
  }, "line 1\nline 2");
});

test("print() output + return value combined", async (t) => {
  t.check((print) => {
    print("side effect");
    return "result";
  }, "side effect\nresult");
});

test("print() with serialized return value", async (t) => {
  t.check((print) => {
    print("created file");
    return { status: "ok" };
  }, `created file
{
  "status": "ok"
}`);
});

test("async function with print()", async (t) => {
  await t.check(async (print) => {
    print("starting");
    await Promise.resolve();
    print("done");
    return "final";
  }, "starting\ndone\nfinal");
});

// ── inspect() — non-throwing result ──

test("inspect returns pass on match", async (t) => {
  const r = inspect("hello", "hello");
  t.check(r, `{
  "pass": true,
  "actual": "hello",
  "expected": "hello",
  "diff": null,
  "message": ""
}`);
});

test("inspect returns diff on single-line mismatch", async (t) => {
  const r = inspect("got this", "want this");
  t.equal((r as { pass: boolean }).pass, false);
  t.check((r as { diff: string }).diff, `expected: "want this"
  actual: "got this"
  ~~~~~~~~~~~^`);
});

test("inspect returns diff on multi-line mismatch", async (t) => {
  const r = inspect("line1\nchanged\nline3", "line1\noriginal\nline3");
  t.check((r as { diff: string }).diff, `expected vs actual:
    line1
  - changed
  + original
    line3`);
});

test("inspect shows missing lines", async (t) => {
  const r = inspect("only one", "only one\nextra line");
  t.check((r as { diff: string }).diff, `expected vs actual:
    only one
  + extra line`);
});

test("inspect shows extra lines", async (t) => {
  const r = inspect("line1\nextra\nline3", "line1\nline3");
  t.check((r as { diff: string }).diff, `expected vs actual:
    line1
  - extra
  + line3
  - line3`);
});

test("inspect with wildcards shows pattern on mismatch", async (t) => {
  const r = inspect("hello world", "goodbye ___");
  t.equal((r as { pass: boolean }).pass, false);
  t.check((r as { diff: string }).diff, `expected: "goodbye ___"
  actual: "hello world"
  ~~~~~~~~~~~^`);
});

test("inspect on objects shows JSON diff", async (t) => {
  const r = inspect({ a: 1, b: 2 }, `{
  "a": 1,
  "b": 3
}`);
  t.check((r as { diff: string }).diff, `expected vs actual:
    {
      "a": 1,
  -   "b": 2
  +   "b": 3
    }`);
});

test("inspect with printer function", async (t) => {
  const r = inspect((print) => {
    print("did something");
    return "result";
  }, "did something\nwrong");
  t.equal((r as { pass: boolean }).pass, false);
  t.check((r as { actual: string }).actual, "did something\nresult");
});

test("inspect with async function", async (t) => {
  const r = await inspect(async (_print) => "async value", "async value");
  t.check(r, `{
  "pass": true,
  "actual": "async value",
  "expected": "async value",
  "diff": null,
  "message": ""
}`);
});

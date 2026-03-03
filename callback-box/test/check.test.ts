import { test } from "tap";
import { check, inspect, CheckError, serialize, registerSerializer } from "../src/test-lib/check.js";

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

test("check error message shows expected vs actual", async (t) => {
  try {
    check("got this", "want this");
    t.fail("should have thrown");
  } catch (err) {
    t.ok(err instanceof CheckError);
    const msg = (err as CheckError).message;
    t.ok(msg.includes("got this"), "shows actual");
    t.ok(msg.includes("want this"), "shows expected");
  }
});

test("single-line diff points to first difference", async (t) => {
  try {
    check("abcXef", "abcYef");
    t.fail("should have thrown");
  } catch (err) {
    const msg = (err as CheckError).message;
    // The caret should point at position 3
    t.ok(msg.includes("^"), "has caret marker");
  }
});

test("multi-line diff shows line-by-line", async (t) => {
  try {
    check("line1\nline2\nline3", "line1\nchanged\nline3");
    t.fail("should have thrown");
  } catch (err) {
    const msg = (err as CheckError).message;
    t.ok(msg.includes("- line2"), "shows removed line");
    t.ok(msg.includes("+ changed"), "shows added line");
    t.ok(msg.includes("  line1"), "shows matching line");
  }
});

// ── Wildcards ──

test("___ wildcard matches any text", async (t) => {
  check("hello world 123", "hello ___ 123");
  check("hello  123", "hello ___ 123"); // empty match
  t.pass("wildcards matched");
});

test("named wildcard ___foo___ matches any text", async (t) => {
  check("2026-03-02T20:00:00Z commit abc123: initial", "___date___ commit ___hash___: initial");
  t.pass("named wildcards matched");
});

test("wildcard mismatch still shows diff", async (t) => {
  t.throws(
    () => check("hello world", "goodbye ___"),
    { name: "CheckError" },
  );
});

test("multiple wildcards in sequence", async (t) => {
  check("start MIDDLE end", "start ___ end");
  check("a:b:c", "a___c");
  t.pass("multi-wildcard matched");
});

// ── Serialization ──

test("serialize objects as JSON", async (t) => {
  check({ a: 1, b: [2, 3] }, `{
  "a": 1,
  "b": [
    2,
    3
  ]
}`);
  t.pass("JSON serialization matched");
});

test("serialize null and undefined", async (t) => {
  check(null, "null");
  check(undefined, "undefined");
  t.pass("null/undefined serialized");
});

test("serialize numbers", async (t) => {
  check(42, "42");
  check(3.14, "3.14");
  t.pass("numbers serialized");
});

test("custom serializer takes priority", async (t) => {
  registerSerializer((v) => {
    if (typeof v === "object" && v !== null && "custom" in v) {
      return `Custom<${(v as { custom: string }).custom}>`;
    }
    return null;
  });

  check({ custom: "test" }, "Custom<test>");
  t.pass("custom serializer used");
});

// ── Options ──

test("normalizeWhitespace collapses runs", async (t) => {
  check("  hello   world  ", {
    expected: "hello world",
    normalizeWhitespace: true,
  });
  t.pass("whitespace normalized");
});

test("label appears in error message", async (t) => {
  try {
    check("a", { expected: "b", label: "my check" });
    t.fail("should have thrown");
  } catch (err) {
    const msg = (err as CheckError).message;
    t.ok(msg.includes("my check"), "label in message");
  }
});

// ── Promise support ──

test("check awaits promises", async (t) => {
  await check(Promise.resolve("hello"), "hello");
  t.pass("promise resolved and matched");
});

test("check awaits promise and serializes result", async (t) => {
  await check(Promise.resolve({ x: 1 }), `{
  "x": 1
}`);
  t.pass("promise object serialized");
});

test("check rejects on promise mismatch", async (t) => {
  await t.rejects(
    check(Promise.resolve("actual"), "expected") as Promise<void>,
    { name: "CheckError" },
  );
});

// ── Function support ──

test("function return value becomes actual", async (t) => {
  check((_print) => "computed", "computed");
  t.pass("function return value matched");
});

test("function with print() captures output", async (t) => {
  check((print) => {
    print("line 1");
    print("line 2");
  }, "line 1\nline 2");
  t.pass("print output matched");
});

test("print() output + return value combined", async (t) => {
  check((print) => {
    print("side effect");
    return "result";
  }, "side effect\nresult");
  t.pass("combined output matched");
});

test("print() with serialized return value", async (t) => {
  check((print) => {
    print("created file");
    return { status: "ok" };
  }, `created file
{
  "status": "ok"
}`);
  t.pass("print + serialized return matched");
});

test("async function with print()", async (t) => {
  await check(async (print) => {
    print("starting");
    await Promise.resolve();
    print("done");
    return "final";
  }, "starting\ndone\nfinal");
  t.pass("async function with print matched");
});

test("function mismatch throws CheckError", async (t) => {
  t.throws(
    () => check((_print) => "got", "want"),
    { name: "CheckError" },
  );
});

// ── inspect() — non-throwing result ──

test("inspect returns pass on match", async (t) => {
  const r = inspect("hello", "hello");
  check(r, `{
  "pass": true,
  "actual": "hello",
  "expected": "hello",
  "diff": null,
  "message": ""
}`);
});

test("inspect returns diff on single-line mismatch", async (t) => {
  const r = inspect("got this", "want this");
  // Use inspect's own fields to verify the diff format
  t.equal((r as { pass: boolean }).pass, false);
  check((r as { diff: string }).diff, `expected: "want this"
  actual: "got this"
  ~~~~~~~~~~~^`);
});

test("inspect returns diff on multi-line mismatch", async (t) => {
  const r = inspect("line1\nchanged\nline3", "line1\noriginal\nline3");
  check((r as { diff: string }).diff, `expected vs actual:
    line1
  - changed
  + original
    line3`);
});

test("inspect shows missing lines", async (t) => {
  const r = inspect("only one", "only one\nextra line");
  check((r as { diff: string }).diff, `expected vs actual:
    only one
  + extra line`);
});

test("inspect shows extra lines", async (t) => {
  const r = inspect("line1\nextra\nline3", "line1\nline3");
  check((r as { diff: string }).diff, `expected vs actual:
    line1
  - extra
  + line3
  - line3`);
});

test("inspect with wildcards shows pattern on mismatch", async (t) => {
  const r = inspect("hello world", "goodbye ___");
  t.equal((r as { pass: boolean }).pass, false);
  // The diff shows the wildcard pattern vs actual
  check((r as { diff: string }).diff, `expected: "goodbye ___"
  actual: "hello world"
  ~~~~~~~~~~~^`);
});

test("inspect on objects shows JSON diff", async (t) => {
  const r = inspect({ a: 1, b: 2 }, `{
  "a": 1,
  "b": 3
}`);
  check((r as { diff: string }).diff, `expected vs actual:
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
  check((r as { actual: string }).actual, "did something\nresult");
});

test("inspect with async function", async (t) => {
  const r = await inspect(async (_print) => "async value", "async value");
  check(r, `{
  "pass": true,
  "actual": "async value",
  "expected": "async value",
  "diff": null,
  "message": ""
}`);
});

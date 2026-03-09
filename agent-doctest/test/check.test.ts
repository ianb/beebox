import { test } from "tap";
import { check, inspect, CheckError, registerSerializer, type Extractions, type CheckResult } from "../src/check.js";
import "../src/tap-check.js";

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

test("«*» wildcard matches any text", async (t) => {
  t.check("hello world 123", "hello «*» 123");
  t.check("hello  123", "hello «*» 123"); // empty match
});

test("named wildcard matches any text", async (t) => {
  t.check("2026-03-02T20:00:00Z commit abc123: initial", "«date» commit «hash=*»: initial");
});

test("wildcard mismatch still fails", async (t) => {
  const r = inspect("hello world", "goodbye «*»");
  t.equal((r as { pass: boolean }).pass, false);
});

test("multiple wildcards in sequence", async (t) => {
  t.check("start MIDDLE end", "start «*» end");
  t.check("a:b:c", "a«*»c");
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
  const r = inspect("hello", "hello") as CheckResult;
  t.equal(r.pass, true);
  t.equal(r.actual, "hello");
  t.equal(r.expected, "hello");
  t.equal(r.diff, null);
  t.equal(r.extractions.length, 0);
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
  const r = inspect("hello world", "goodbye «*»");
  t.equal((r as { pass: boolean }).pass, false);
  t.check((r as { diff: string }).diff, `expected: "goodbye «*»"
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
  const r = await inspect(async (_print) => "async value", "async value") as CheckResult;
  t.equal(r.pass, true);
  t.equal(r.actual, "async value");
});

// ── Guillemet wildcards ──

test("«*» matches anything", async (t) => {
  t.check("hello world 123", "hello «*» 123");
});

test("«*» extractions are positional", async (t) => {
  const ext = t.check("a X b Y c", "a «*» b «*» c");
  t.equal(ext[0], "X");
  t.equal(ext[1], "Y");
  t.equal(ext.length, 2);
});

test("«*» matches empty string", async (t) => {
  const ext = t.check("ab", "a«*»b");
  t.equal(ext[0], "");
});

test("«*» matches across newlines", async (t) => {
  const ext = t.check("start\nmiddle\nend", "start«*»end");
  t.equal(ext[0], "\nmiddle\n");
});

// ── Named extractions ──

test("«name» without =type is anonymous (positional only)", async (t) => {
  const ext = t.check("commit abc123 done", "commit «hash» done");
  t.equal(ext.hash, undefined);
  t.equal(ext[0], "abc123");
});

test("«name=*» captures with name", async (t) => {
  const ext = t.check("commit abc123 done", "commit «hash=*» done");
  t.equal(ext.hash, "abc123");
  t.equal(ext[0], "abc123");
});

test("«name=*» captures anything with name", async (t) => {
  const ext = t.check("id: xyz", "id: «val=*»");
  t.equal(ext.val, "xyz");
});

test("duplicate names use first match", async (t) => {
  const ext = t.check("a X b Y c", "a «thing=*» b «thing=*» c");
  t.equal(ext.thing, "X", "named access gets first match");
  t.equal(ext[0], "X");
  t.equal(ext[1], "Y");
});

// ── Typed matchers ──

test("«date» matches ISO datetime", async (t) => {
  const ext = t.check("created 2026-03-02T20:00:00Z", "created «date»");
  t.equal(ext.date, "2026-03-02T20:00:00Z");
});

test("«date» matches date-only", async (t) => {
  const ext = t.check("on 2026-03-02", "on «date»");
  t.equal(ext.date, "2026-03-02");
});

test("«date» rejects non-dates", async (t) => {
  const r = inspect("created not-a-date", "created «date»");
  t.equal((r as { pass: boolean }).pass, false);
});

test("«uuid» matches UUIDs", async (t) => {
  const ext = t.check("id: 550e8400-e29b-41d4-a716-446655440000", "id: «uuid»");
  t.equal(ext.uuid, "550e8400-e29b-41d4-a716-446655440000");
});

test("«int» matches integers", async (t) => {
  const ext = t.check("count: 42", "count: «int»");
  t.equal(ext.int, "42");
});

test("«int» matches negative integers", async (t) => {
  const ext = t.check("offset: -5", "offset: «int»");
  t.equal(ext.int, "-5");
});

test("«number» matches decimals", async (t) => {
  const ext = t.check("pi: 3.14", "pi: «number»");
  t.equal(ext.number, "3.14");
});

test("«number» matches scientific notation", async (t) => {
  const ext = t.check("tiny: 1.5e-10", "tiny: «number»");
  t.equal(ext.number, "1.5e-10");
});

test("«string» matches double-quoted strings", async (t) => {
  const ext = t.check('name: "Alice"', "name: «string»");
  t.equal(ext.string, '"Alice"');
});

test("«string» matches single-quoted strings", async (t) => {
  const ext = t.check("name: 'Bob'", "name: «string»");
  t.equal(ext.string, "'Bob'");
});

test("«string» handles escaped quotes", async (t) => {
  const ext = t.check('say: "he said \\"hi\\""', "say: «string»");
  t.equal(ext.string, '"he said \\"hi\\""');
});

// ── Named + typed ──

test("«name=date» captures typed with custom name", async (t) => {
  const ext = t.check("from 2026-01-01 to 2026-12-31", "from «start=date» to «end=date»");
  t.equal(ext.start, "2026-01-01");
  t.equal(ext.end, "2026-12-31");
  t.equal(ext[0], "2026-01-01");
  t.equal(ext[1], "2026-12-31");
});

test("«count=int» captures integer with custom name", async (t) => {
  const ext = t.check("items: 5, pages: 2", "items: «items=int», pages: «pages=int»");
  t.equal(ext.items, "5");
  t.equal(ext.pages, "2");
});

// ── Async extractions ──

test("async check returns extractions", async (t) => {
  const ext = await t.check(Promise.resolve("count: 42"), "count: «int»");
  t.equal(ext.int, "42");
});

// ── Extractions from standalone check() ──

test("standalone check() returns extractions", async (t) => {
  const ext = check("hello 42 world", "hello «n=int» world");
  t.equal((ext as Extractions).n, "42");
});

// ── No wildcards returns empty extractions ──

test("no wildcards returns empty extractions", async (t) => {
  const ext = t.check("hello", "hello");
  t.equal(ext.length, 0);
});

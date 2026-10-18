import { test } from "tap";
import { check, inspect, CheckError, registerSerializer, type Extractions, type CheckResult, type PrintFn } from "../../../src/tap-check/text/compare.js";
import "../../../src/tap-check/tap.js";
import os from "node:os";
import { suggestExpected } from "../../../src/tap-check/text/suggest.js";

/** The extractions of a synchronous check; fails if the check was async. */
function extracted(r: Extractions | Promise<Extractions>): Extractions {
  if (r instanceof Promise) throw new Error("expected a synchronous check");
  return r;
}

/** The result of a synchronous inspect(); fails if it was async. */
function syncResult(r: CheckResult | Promise<CheckResult>): CheckResult {
  if (r instanceof Promise) throw new Error("expected a synchronous inspect");
  return r;
}

function messageOf(first: unknown): string {
  return typeof first === "string" ? first : "";
}

function failed(r: CheckResult | Promise<CheckResult>): CheckResult & { pass: false } {
  const result = r as CheckResult;
  if (result.pass) throw new Error("expected a failing check");
  return result;
}

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
    t.equal(e.suggested, "got this");
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

// ── t.checkText() — tap-integrated API ──

test("exact match", async (t) => {
  t.checkText("hello", "hello");
});

test("single-line diff points to first difference", async (t) => {
  const r = inspect("abcXef", "abcYef");
  t.equal((r as { pass: boolean }).pass, false);
  t.ok((r as { diff: string }).diff.includes("^"), "has caret marker");
});

test("multi-line diff shows line-by-line", async (t) => {
  const r = inspect("line1\nline2\nline3", "line1\nchanged\nline3");
  const diff = (r as { diff: string }).diff;
  t.ok(diff.includes("- changed"), "shows expected line with -");
  t.ok(diff.includes("+ line2"), "shows actual line with +");
  t.ok(diff.includes("  line1"), "shows matching line");
});

// ── Wildcards ──

test("«*» wildcard matches any text", async (t) => {
  t.checkText("hello world 123", "hello «*» 123");
  t.checkText("hello  123", "hello «*» 123"); // empty match
});

test("named wildcard matches any text", async (t) => {
  t.checkText("2026-03-02T20:00:00Z commit abc123: initial", "«date» commit «hash=*»: initial");
});

test("wildcard mismatch still fails", async (t) => {
  const r = inspect("hello world", "goodbye «*»");
  t.equal((r as { pass: boolean }).pass, false);
});

test("multiple wildcards in sequence", async (t) => {
  t.checkText("start MIDDLE end", "start «*» end");
  t.checkText("a:b:c", "a«*»c");
});

// ── Serialization ──

test("serialize objects as JSON", async (t) => {
  t.checkText({ a: 1, b: [2, 3] }, `{
  "a": 1,
  "b": [
    2,
    3
  ]
}`);
});

test("serialize null and undefined", async (t) => {
  t.checkText(null, "null");
  t.checkText(undefined, "undefined");
});

test("serialize numbers", async (t) => {
  t.checkText(42, "42");
  t.checkText(3.14, "3.14");
});

test("custom serializer takes priority", async (t) => {
  registerSerializer((v) => {
    if (typeof v === "object" && v !== null && "custom" in v) {
      return `Custom<${(v as { custom: string }).custom}>`;
    }
    return null;
  });

  t.checkText({ custom: "test" }, "Custom<test>");
});

// ── Options ──

test("normalizeWhitespace collapses runs", async (t) => {
  t.checkText("  hello   world  ", {
    expected: "hello world",
    normalizeWhitespace: true,
  });
});

// ── Promise support ──

test("check awaits promises", async (t) => {
  await t.checkText(Promise.resolve("hello"), "hello");
});

test("check awaits promise and serializes result", async (t) => {
  await t.checkText(Promise.resolve({ x: 1 }), `{
  "x": 1
}`);
});

// ── Function support ──

test("function return value becomes actual", async (t) => {
  t.checkText((_print: PrintFn) => "computed", "computed");
});

test("function with print() captures output", async (t) => {
  t.checkText((print: PrintFn) => {
    print("line 1");
    print("line 2");
  }, "line 1\nline 2");
});

test("print() output + return value combined", async (t) => {
  t.checkText((print: PrintFn) => {
    print("side effect");
    return "result";
  }, "side effect\nresult");
});

test("print() with serialized return value", async (t) => {
  t.checkText((print: PrintFn) => {
    print("created file");
    return { status: "ok" };
  }, `created file
{
  "status": "ok"
}`);
});

test("async function with print()", async (t) => {
  await t.checkText(async (print: PrintFn) => {
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
  t.checkText((r as { diff: string }).diff, `expected: "want this"
  actual: "got this"
           ^`);
});

test("inspect returns diff on multi-line mismatch", async (t) => {
  const r = inspect("line1\nchanged\nline3", "line1\noriginal\nline3");
  t.checkText((r as { diff: string }).diff, `- expected
+ actual

  line1
- original
+ changed
  line3`);
});

test("inspect shows missing lines", async (t) => {
  const r = inspect("only one", "only one\nextra line");
  t.checkText((r as { diff: string }).diff, `- expected
+ actual

  only one
- extra line`);
});

test("inspect aligns an inserted line (LCS, not by index)", async (t) => {
  const r = inspect("line1\nextra\nline3", "line1\nline3");
  t.checkText((r as { diff: string }).diff, `- expected
+ actual

  line1
+ extra
  line3`);
});

test("inspect with wildcards shows pattern on mismatch", async (t) => {
  const r = inspect("hello world", "goodbye «*»");
  t.equal((r as { pass: boolean }).pass, false);
  t.checkText((r as { diff: string }).diff, `expected: "goodbye «*»"
  actual: "hello world"
           ^`);
});

test("inspect on objects shows JSON diff", async (t) => {
  const r = inspect({ a: 1, b: 2 }, `{
  "a": 1,
  "b": 3
}`);
  t.checkText((r as { diff: string }).diff, `- expected
+ actual

  {
    "a": 1,
-   "b": 3
+   "b": 2
  }`);
});

test("inspect with printer function", async (t) => {
  const r = inspect((print: PrintFn) => {
    print("did something");
    return "result";
  }, "did something\nwrong");
  t.equal((r as { pass: boolean }).pass, false);
  t.checkText((r as { actual: string }).actual, "did something\nresult");
});

test("inspect with async function", async (t) => {
  const r = await inspect(async (_print: PrintFn) => "async value", "async value") as CheckResult;
  t.equal(r.pass, true);
  t.equal(r.actual, "async value");
});

// ── Guillemet wildcards ──

test("«*» matches anything", async (t) => {
  t.checkText("hello world 123", "hello «*» 123");
});

test("«*» extractions are positional", async (t) => {
  const ext = extracted(t.checkText("a X b Y c", "a «*» b «*» c"));
  t.equal(ext[0], "X");
  t.equal(ext[1], "Y");
  t.equal(ext.length, 2);
});

test("«*» matches empty string", async (t) => {
  const ext = extracted(t.checkText("ab", "a«*»b"));
  t.equal(ext[0], "");
});

test("«*» matches across newlines", async (t) => {
  const ext = extracted(t.checkText("start\nmiddle\nend", "start«*»end"));
  t.equal(ext[0], "\nmiddle\n");
});

// ── Named extractions ──

test("«name» without =type is anonymous (positional only)", async (t) => {
  const ext = extracted(t.checkText("commit abc123 done", "commit «hash» done"));
  t.equal(ext.hash, undefined);
  t.equal(ext[0], "abc123");
});

test("«name=*» captures with name", async (t) => {
  const ext = extracted(t.checkText("commit abc123 done", "commit «hash=*» done"));
  t.equal(ext.hash, "abc123");
  t.equal(ext[0], "abc123");
});

test("«name=*» captures anything with name", async (t) => {
  const ext = extracted(t.checkText("id: xyz", "id: «val=*»"));
  t.equal(ext.val, "xyz");
});

test("duplicate names use first match", async (t) => {
  const ext = extracted(t.checkText("a X b Y c", "a «thing=*» b «thing=*» c"));
  t.equal(ext.thing, "X", "named access gets first match");
  t.equal(ext[0], "X");
  t.equal(ext[1], "Y");
});

// ── Typed matchers ──

test("«date» matches ISO datetime", async (t) => {
  const ext = extracted(t.checkText("created 2026-03-02T20:00:00Z", "created «date»"));
  t.equal(ext.date, "2026-03-02T20:00:00Z");
});

test("«date» matches date-only", async (t) => {
  const ext = extracted(t.checkText("on 2026-03-02", "on «date»"));
  t.equal(ext.date, "2026-03-02");
});

test("«date» rejects non-dates", async (t) => {
  const r = inspect("created not-a-date", "created «date»");
  t.equal((r as { pass: boolean }).pass, false);
});

test("«uuid» matches UUIDs", async (t) => {
  const ext = extracted(t.checkText("id: 550e8400-e29b-41d4-a716-446655440000", "id: «uuid»"));
  t.equal(ext.uuid, "550e8400-e29b-41d4-a716-446655440000");
});

test("«int» matches integers", async (t) => {
  const ext = extracted(t.checkText("count: 42", "count: «int»"));
  t.equal(ext.int, "42");
});

test("«int» matches negative integers", async (t) => {
  const ext = extracted(t.checkText("offset: -5", "offset: «int»"));
  t.equal(ext.int, "-5");
});

test("«number» matches decimals", async (t) => {
  const ext = extracted(t.checkText("pi: 3.14", "pi: «number»"));
  t.equal(ext.number, "3.14");
});

test("«number» matches scientific notation", async (t) => {
  const ext = extracted(t.checkText("tiny: 1.5e-10", "tiny: «number»"));
  t.equal(ext.number, "1.5e-10");
});

test("«string» matches double-quoted strings", async (t) => {
  const ext = extracted(t.checkText('name: "Alice"', "name: «string»"));
  t.equal(ext.string, '"Alice"');
});

test("«string» matches single-quoted strings", async (t) => {
  const ext = extracted(t.checkText("name: 'Bob'", "name: «string»"));
  t.equal(ext.string, "'Bob'");
});

test("«string» handles escaped quotes", async (t) => {
  const ext = extracted(t.checkText('say: "he said \\"hi\\""', "say: «string»"));
  t.equal(ext.string, '"he said \\"hi\\""');
});

// ── Named + typed ──

test("«name=date» captures typed with custom name", async (t) => {
  const ext = extracted(t.checkText("from 2026-01-01 to 2026-12-31", "from «start=date» to «end=date»"));
  t.equal(ext.start, "2026-01-01");
  t.equal(ext.end, "2026-12-31");
  t.equal(ext[0], "2026-01-01");
  t.equal(ext[1], "2026-12-31");
});

test("«count=int» captures integer with custom name", async (t) => {
  const ext = extracted(t.checkText("items: 5, pages: 2", "items: «items=int», pages: «pages=int»"));
  t.equal(ext.items, "5");
  t.equal(ext.pages, "2");
});

// ── Async extractions ──

test("async check returns extractions", async (t) => {
  const ext = await t.checkText(Promise.resolve("count: 42"), "count: «int»");
  t.equal(ext.int, "42");
});

// ── Extractions from standalone check() ──

test("standalone check() returns extractions", async (t) => {
  const ext = check("hello 42 world", "hello «n=int» world");
  t.equal((ext as Extractions).n, "42");
});

// ── No wildcards returns empty extractions ──

test("no wildcards returns empty extractions", async (t) => {
  const ext = extracted(t.checkText("hello", "hello"));
  t.equal(ext.length, 0);
});

// ── Diff: LCS, context, collapsing, wildcards ──

test("diff: expected with extra lines after a single actual line (corpus 02)", async (t) => {
  const r = failed(inspect(2, "2\ns.toUpperCase()\n=> A,B"));
  t.checkText(r.diff, `- expected
+ actual

  2
- s.toUpperCase()
- => A,B`);
});

test("diff: collapses long equal runs to 3 lines of context", async (t) => {
  const expected = Array.from({ length: 20 }, (_, i) => `L${i + 1}`);
  const actual = expected.map((l) => (l === "L10" ? "X" : l));
  const r = failed(inspect(actual.join("\n"), expected.join("\n")));
  t.checkText(r.diff, `- expected
+ actual

  … 6 unchanged lines …
  L7
  L8
  L9
- L10
+ X
  L11
  L12
  L13
  … 7 unchanged lines …`);
});

test("diff: a 30-item array against [] stays short (corpus 25)", async (t) => {
  const value = { items: Array.from({ length: 30 }, (_, i) => ({ id: i, name: `item${i}`, tags: ["x"] })) };
  const r = failed(inspect(value, `{\n  "items": []\n}`));
  t.checkText(r.diff, `- expected
+ actual

  {
-   "items": []
+   "items": [
+     {
+       "id": 0,
+       "name": "item0",
+       "tags": [
+         "x"
+       ]
+     },
+ … 201 more lines …
+       ]
+     }
+   ]
  }`);
  t.ok(r.diff.split("\n").length < 25, "diff is short");
});

test("diff: wildcard lines that match are context, not changes (corpus 16c)", async (t) => {
  const r = failed(inspect({ id: "abc", at: "2026-09-29T02:28:16.337Z", n: 3 }, `{
  "id": "«uuid»",
  "at": "«date»",
  "n": «int»
}`));
  // t.equal: the diff text itself contains «» and would be read as a pattern.
  t.equal(r.diff, `- expected
+ actual

  {
-   "id": "«uuid»",
+   "id": "abc",
    "at": "«date»",
    "n": «int»
  }`);
});

test("diff: single-line caret lines up with JSON escapes", async (t) => {
  const r = failed(inspect('say "hi" now', 'say "ho" now'));
  const [e, a, caret] = r.diff.split("\n");
  t.equal(e, 'expected: "say \\"ho\\" now"');
  t.equal(a, '  actual: "say \\"hi\\" now"');
  t.equal(caret?.indexOf("^"), e?.indexOf("o\\"), "caret under the first differing character");
});

test("diff: single-line caret omitted when a wildcard precedes the difference", async (t) => {
  const r = failed(inspect("id 1 x", "id «int» y"));
  t.equal(r.diff.includes("^"), false);
});

// ── Suggested expected value ──

test("suggested: wildcards volatile parts and marks blank lines", async (t) => {
  const actual = [
    "created 2026-09-28T10:00:00.000Z by 550e8400-e29b-41d4-a716-446655440000",
    `path: ${os.tmpdir()}/doctest-abc123/box/card.md`,
    "commit 3f2a9c1d8e7b6a5f on 2020-01-02",
    "",
    "done",
  ].join("\n");
  const r = failed(inspect(actual, "nope"));
  t.equal(r.suggested, [
    "created «date» by «uuid»",
    "path: «*»/box/card.md",
    "commit «*» on 2020-01-02",
    "«blankline»",
    "done",
  ].join("\n"));
  t.checkText(actual, r.suggested);
});

test("suggested: pid, hostname, today's date, and epoch timestamps", async (t) => {
  const today = new Date().toISOString().slice(0, 10);
  const actual = `pid ${process.pid} on ${os.hostname()} at ${Date.now()} (${today})`;
  const r = failed(inspect(actual, "nope"));
  t.equal(r.suggested, "pid «int» on «*» at «int» («date»)");
  t.checkText(actual, r.suggested);
});

test("suggested: lines that already match keep the author's wildcards (corpus 16c)", async (t) => {
  const value = { id: "abc", at: "2026-09-29T02:28:16.337Z", n: 3 };
  const r = failed(inspect(value, `{\n  "id": "«uuid»",\n  "at": "«date»",\n  "n": «int»\n}`));
  t.equal(r.suggested, `{\n  "id": "abc",\n  "at": "«date»",\n  "n": «int»\n}`);
  t.checkText(value, r.suggested);
});

test("suggested: plain values come back unchanged", async (t) => {
  t.equal(failed(inspect({ a: 1 }, "{}")).suggested, `{\n  "a": 1\n}`);
});

test("suggested: falls back when the rewrite would not match", async (t) => {
  t.equal(suggestExpected("a«uuid»b"), null);
  t.equal(failed(inspect("a«uuid»b", "x")).suggested, "a«uuid»b");
});

// ── B1: expected written as a JS/JSON literal ──

test("literal: JS object literal matches an object", async (t) => {
  t.checkText({ kind: "box", targetBox: null }, `{ kind: "box", targetBox: null }`);
});

test("literal: compact JSON matches an object", async (t) => {
  t.checkText({ kind: "box" }, `{"kind":"box"}`);
});

test("literal: arrays, single quotes, trailing commas", async (t) => {
  t.checkText([1, 2, 3], "[1, 2, 3]");
  t.checkText(["a", "b"], "['a', 'b']");
  t.checkText({ a: 1, b: [1, 2] }, "{ 'a': 1, b: [1, 2,], }");
});

test("literal: wildcards in value position, bare or quoted", async (t) => {
  const ext = extracted(t.checkText(
    { id: "550e8400-e29b-41d4-a716-446655440000", at: "2026-09-28T10:00:00Z", n: 3 },
    `{ id: «uuid», at: "«date»", n: «int» }`,
  ));
  t.equal(ext.uuid, "550e8400-e29b-41d4-a716-446655440000");
  t.equal(ext.int, "3");
  t.checkText([1, 2, 3], "[1, «*»]");
});

test("literal: a mismatch shows the normalized form, in the actual's key order", async (t) => {
  const r = failed(inspect({ a: 1, b: 2 }, "{ b: 3, a: 1 }"));
  t.checkText(r.diff, `- expected
+ actual

  {
    "a": 1,
-   "b": 3
+   "b": 2
  }`);
});

test("literal: expressions are not parsed", async (t) => {
  t.equal(failed(inspect({ a: 2 }, "{ a: 1 + 1 }")).expected, "{ a: 1 + 1 }");
});

test("literal: never applies to string actuals", async (t) => {
  failed(inspect("[1, 2]", "[\n  1,\n  2\n]"));
  failed(inspect("a", "'a'"));
});

test("literal: skipped when a custom serializer produced the actual", async (t) => {
  registerSerializer((v) => (typeof v === "object" && v !== null && "shape" in v ? `Shape(${String((v as { shape: unknown }).shape)})` : null));
  failed(inspect({ shape: "x" }, `{ shape: "x" }`));
  failed(inspect({ shape: "x" }, `{"shape": "x"}`));
});

// ── Hints ──

test("hint: quoted expected against the bare string", async (t) => {
  t.equal(failed(inspect("HELLO", '"HELLO"')).hint, "strings compare without quotes; drop the quotes");
});

test("hint: boolean expected", async (t) => {
  t.match(failed(inspect(false, "true")).hint, /boolean result hides the value/);
});

test("hint: trailing whitespace only", async (t) => {
  t.equal(failed(inspect("alpha \nbeta", "alpha\nbeta")).hint, "the values differ only in trailing whitespace");
});

test("hint: none for an ordinary mismatch", async (t) => {
  t.equal(failed(inspect("a", "b")).hint, null);
});

// ── t.checkText() report shape ──

test("t.checkText() names the test point with the label, pass or fail", async (t) => {
  const calls: [string, string, Record<string, unknown> | undefined][] = [];
  const fake = Object.create(t) as typeof t;
  fake.pass = (...args: Parameters<typeof t.pass>) => (calls.push(["pass", messageOf(args[0]), undefined]), true);
  fake.fail = (...args: Parameters<typeof t.fail>) => (calls.push(["fail", messageOf(args[0]), typeof args[0] === "string" ? args[1] : args[0]]), false);
  fake.checkText("a", { expected: "a", label: "line 3: x" });
  fake.checkText("a", { expected: "b", label: "line 7: y" });
  fake.checkText("a", "b");
  t.same(calls.map(([kind, msg]) => [kind, msg]), [["pass", "line 3: x"], ["fail", "line 7: y"], ["fail", "check failed"]]);
  const extra = calls[1]?.[2] ?? {};
  t.same(Object.keys(extra).sort(), ["diff", "suggested"], "no found/wanted next to the diff");
});

test("B1: a literal's key order follows the actual value; pretty JSON keeps its own", async (t) => {
  const actual = { kind: "box", targetBox: "test1", targetWorktree: "main" };
  t.ok(syncResult(inspect(actual, '{ kind: "box", targetWorktree: "main", targetBox: "test1" }')).pass, "literal in another order");
  t.ok(syncResult(inspect(actual, '{"kind":"box","targetWorktree":"main","targetBox":"test1"}')).pass, "compact JSON in another order");
  const pretty = '{\n  "kind": "box",\n  "targetWorktree": "main",\n  "targetBox": "test1"\n}';
  t.notOk(syncResult(inspect(actual, pretty)).pass, "pretty JSON in another order still fails: it is compared as written");
  t.notOk(syncResult(inspect(actual, '{ kind: "box", targetWorktree: "other", targetBox: "test1" }')).pass, "a different value still fails");
});

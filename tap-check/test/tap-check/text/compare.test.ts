import { test } from "tap";
import { TestBase } from "@tapjs/core";
import { compareText } from "../../../src/tap-check/text/compare.js";
import { matchExtractions } from "../../../src/tap-check/text/match.js";
import "../../../src/tap-check/tap.js";
import os from "node:os";
import { suggestExpected } from "../../../src/tap-check/text/suggest.js";

/** Captures of a match: positional values, and the named ones. */
function captures(actual: string, expected: string): { positional: string[]; named: Record<string, string> } | null {
  const ext = matchExtractions(actual, expected);
  if (ext === null) return null;
  const named = Object.fromEntries(Object.entries(ext).filter(([key]) => Number.isNaN(Number(key))));
  return { positional: [...ext], named };
}

function failure(actual: string, expected: string): { diff: string; suggested: string; hint: string | null } {
  const result = compareText(actual, expected);
  if (result.pass) throw new Error("expected a failing comparison");
  return { diff: result.diff, suggested: result.suggested, hint: result.hint };
}

// ── Exact match and diffs ──

test("exact match", async (t) => {
  t.checkText("hello", "hello");
  t.check(compareText("hello", "hello"), { pass: true });
});

test("single-line diff points to first difference", async (t) => {
  t.check(compareText("got this", "want this"), {
    pass: false,
    diff: `expected: "want this"
  actual: "got this"
           ^`,
    suggested: "got this",
    hint: null,
  });
});

test("multi-line diff shows line-by-line", async (t) => {
  t.check(failure("line1\nchanged\nline3", "line1\noriginal\nline3").diff, `- expected
+ actual

  line1
- original
+ changed
  line3`);
});

test("missing lines show in the diff", async (t) => {
  t.check(failure("only one", "only one\nextra line").diff, `- expected
+ actual

  only one
- extra line`);
});

test("diff aligns an inserted line (LCS, not by index)", async (t) => {
  t.check(failure("line1\nextra\nline3", "line1\nline3").diff, `- expected
+ actual

  line1
+ extra
  line3`);
});

test("diff with wildcards shows the pattern on mismatch", async (t) => {
  t.check(failure("hello world", "goodbye «*»").diff, `expected: "goodbye «*»"
  actual: "hello world"
           ^`);
});

test("diff: expected with extra lines after a single actual line (corpus 02)", async (t) => {
  t.check(failure("2", "2\ns.toUpperCase()\n=> A,B").diff, `- expected
+ actual

  2
- s.toUpperCase()
- => A,B`);
});

test("diff: collapses long equal runs to 3 lines of context", async (t) => {
  const expected = Array.from({ length: 20 }, (_, i) => `L${i + 1}`);
  const actual = expected.map((l) => (l === "L10" ? "X" : l));
  t.check(failure(actual.join("\n"), expected.join("\n")).diff, `- expected
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

test("diff: a long actual against a short expected stays short (corpus 25)", async (t) => {
  const value = JSON.stringify({ items: Array.from({ length: 30 }, (_, i) => ({ id: i, name: `item${i}`, tags: ["x"] })) }, null, 2);
  const { diff } = failure(value, "{\n  \"items\": []\n}");
  t.check(diff, `- expected
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
});

test("diff: wildcard lines that match are context, not changes (corpus 16c)", async (t) => {
  const actual = "{\n  \"id\": \"abc\",\n  \"at\": \"2026-09-29T02:28:16.337Z\",\n  \"n\": 3\n}";
  const expected = "{\n  \"id\": \"«uuid»\",\n  \"at\": \"«date»\",\n  \"n\": «int»\n}";
  t.check(failure(actual, expected).diff, `- expected
+ actual

  {
-   "id": "«uuid»",
+   "id": "abc",
    "at": "«date»",
    "n": «int»
  }`);
});

test("diff: single-line caret lines up with JSON escapes", async (t) => {
  const [e, a, caret] = failure('say "hi" now', 'say "ho" now').diff.split("\n");
  t.check(e, 'expected: "say \\"ho\\" now"');
  t.check(a, '  actual: "say \\"hi\\" now"');
  t.check(caret?.indexOf("^"), e?.indexOf("o\\"));
});

test("diff: single-line caret omitted when a wildcard precedes the difference", async (t) => {
  t.check(failure("id 1 x", "id «int» y").diff, `expected: "id «int» y"
  actual: "id 1 x"`);
});

// ── Wildcards ──

test("«*» wildcard matches any text", async (t) => {
  t.checkText("hello world 123", "hello «*» 123");
  t.checkText("hello  123", "hello «*» 123"); // empty match
});

test("named wildcard matches any text", async (t) => {
  t.checkText("2026-03-02T20:00:00Z commit abc123: initial", "«date» commit «hash=*»: initial");
});

test("multiple wildcards in sequence", async (t) => {
  t.checkText("start MIDDLE end", "start «*» end");
  t.checkText("a:b:c", "a«*»c");
});

test("«*» matches across newlines and empty text", async (t) => {
  t.check(captures("start\nmiddle\nend", "start«*»end"), { positional: ["\nmiddle\n"], named: {} });
  t.check(captures("ab", "a«*»b"), { positional: [""], named: {} });
});

test("«*» captures are positional", async (t) => {
  t.check(captures("a X b Y c", "a «*» b «*» c"), { positional: ["X", "Y"], named: {} });
});

test("trailing newlines of actual are not compared", async (t) => {
  t.checkText("hello\n\n", "hello");
});

// ── Named captures (matchExtractions) ──

test("«name» without =type is anonymous (positional only)", async (t) => {
  t.check(captures("commit abc123 done", "commit «hash» done"), { positional: ["abc123"], named: {} });
});

test("«name=*» captures with a name", async (t) => {
  t.check(captures("commit abc123 done", "commit «hash=*» done"), { positional: ["abc123"], named: { hash: "abc123" } });
});

test("duplicate names use the first match", async (t) => {
  t.check(captures("a X b Y c", "a «thing=*» b «thing=*» c"), { positional: ["X", "Y"], named: { thing: "X" } });
});

test("«name=date» and «name=int» capture typed values", async (t) => {
  t.check(captures("from 2026-01-01 to 2026-12-31", "from «start=date» to «end=date»"), {
    positional: ["2026-01-01", "2026-12-31"],
    named: { start: "2026-01-01", end: "2026-12-31" },
  });
  t.check(captures("items: 5, pages: 2", "items: «items=int», pages: «pages=int»"), {
    positional: ["5", "2"],
    named: { items: "5", pages: "2" },
  });
});

// ── Typed matchers ──

test("«date» matches ISO datetime and date-only", async (t) => {
  t.check(captures("created 2026-03-02T20:00:00Z", "created «date»"), { positional: ["2026-03-02T20:00:00Z"], named: { date: "2026-03-02T20:00:00Z" } });
  t.check(captures("on 2026-03-02", "on «date»"), { positional: ["2026-03-02"], named: { date: "2026-03-02" } });
});

test("«date» rejects non-dates", async (t) => {
  t.check(captures("created not-a-date", "created «date»"), null);
});

test("«uuid» matches UUIDs", async (t) => {
  t.checkText("id: 550e8400-e29b-41d4-a716-446655440000", "id: «uuid»");
  t.check(captures("id: 550e8400", "id: «uuid»"), null);
});

test("«int» matches integers, negative ones too", async (t) => {
  t.check(captures("count: 42", "count: «int»")?.named, { int: "42" });
  t.check(captures("offset: -5", "offset: «int»")?.named, { int: "-5" });
  t.check(captures("count: 4.2", "count: «int»"), null);
});

test("«number» matches decimals and scientific notation", async (t) => {
  t.check(captures("pi: 3.14", "pi: «number»")?.named, { number: "3.14" });
  t.check(captures("tiny: 1.5e-10", "tiny: «number»")?.named, { number: "1.5e-10" });
});

test("«string» matches quoted strings, escaped quotes included", async (t) => {
  t.check(captures('name: "Alice"', "name: «string»")?.named, { string: '"Alice"' });
  t.check(captures("name: 'Bob'", "name: «string»")?.named, { string: "'Bob'" });
  t.check(captures('say: "he said \\"hi\\""', "say: «string»")?.named, { string: '"he said \\"hi\\""' });
});

test("no wildcards: no captures", async (t) => {
  t.check(captures("hello", "hello"), { positional: [], named: {} });
});

// ── Promise support ──

test("checkText awaits promises", async (t) => {
  await t.checkText(Promise.resolve("hello"), "hello");
  await t.checkText(Promise.resolve("count: 42"), "count: «int»");
});

// ── Suggested expected value ──

test("suggested: wildcards volatile parts and marks blank lines", async (t) => {
  const actual = [
    "created 2026-09-28T10:00:00.000Z by 550e8400-e29b-41d4-a716-446655440000",
    `path: ${os.tmpdir()}/tap-check-abc123/box/card.md`,
    "commit 3f2a9c1d8e7b6a5f on 2020-01-02",
    "",
    "done",
  ].join("\n");
  const { suggested } = failure(actual, "nope");
  t.check(suggested, [
    "created «date» by «uuid»",
    "path: «*»/box/card.md",
    "commit «*» on 2020-01-02",
    "«blankline»",
    "done",
  ].join("\n"));
  t.checkText(actual, suggested);
});

test("suggested: pid, hostname, today's date, and epoch timestamps", async (t) => {
  const today = new Date().toISOString().slice(0, 10);
  const actual = `pid ${process.pid} on ${os.hostname()} at ${Date.now()} (${today})`;
  const { suggested } = failure(actual, "nope");
  t.check(suggested, "pid «int» on «*» at «int» («date»)");
  t.checkText(actual, suggested);
});

test("suggested: lines that already match keep the author's wildcards (corpus 16c)", async (t) => {
  const actual = "{\n  \"id\": \"abc\",\n  \"at\": \"2026-09-29T02:28:16.337Z\",\n  \"n\": 3\n}";
  const { suggested } = failure(actual, "{\n  \"id\": \"«uuid»\",\n  \"at\": \"«date»\",\n  \"n\": «int»\n}");
  t.check(suggested, "{\n  \"id\": \"abc\",\n  \"at\": \"«date»\",\n  \"n\": «int»\n}");
  t.checkText(actual, suggested);
});

test("suggested: plain text comes back unchanged", async (t) => {
  t.check(failure("plain", "other").suggested, "plain");
});

test("suggested: falls back when the rewrite would not match", async (t) => {
  t.check(suggestExpected("a«uuid»b"), null);
  t.check(failure("a«uuid»b", "x").suggested, "a«uuid»b");
});

// ── Hints ──

test("hint: quoted expected against the bare string", async (t) => {
  t.check(failure("HELLO", '"HELLO"').hint, "strings compare without quotes; drop the quotes");
});

test("hint: boolean expected", async (t) => {
  t.match(failure("false", "true").hint, /boolean result hides the value/);
});

test("hint: trailing whitespace only", async (t) => {
  t.check(failure("alpha \nbeta", "alpha\nbeta").hint, "the values differ only in trailing whitespace");
});

test("hint: none for an ordinary mismatch", async (t) => {
  t.check(failure("a", "b").hint, null);
});

// ── t.checkText() and t.checkThrows() report shape ──

type Call = [kind: string, message: string, extra: Record<string, unknown> | undefined];

/**
 * A stand-in test object that records pass/fail calls. Not derived from `t`:
 * assigning `pass` on an object that inherits from `t` would replace the real
 * test's own `pass` and lose its later assertions.
 */
function recorder(): { fake: TestBase; calls: Call[] } {
  const calls: Call[] = [];
  const fake = {
    pass: (message: string) => (calls.push(["pass", message, undefined]), true),
    fail: (message: string, extra: Record<string, unknown>) => (calls.push(["fail", message, extra]), false),
    waitOn: async () => {
      // A held check's settled copy; nothing to wait on here.
    },
  } as unknown as TestBase;
  return { fake, calls };
}

test("t.checkText() reports a pass with an empty name and a failure as 'check failed'", async (t) => {
  const { fake, calls } = recorder();
  TestBase.prototype.checkText.call(fake, "a", "a");
  TestBase.prototype.checkText.call(fake, "a", "b");
  t.check(calls.map(([kind, msg]) => [kind, msg]), [["pass", ""], ["fail", "check failed"]]);
  t.check(Object.keys(calls[1]?.[2] ?? {}).toSorted(), ["diff", "suggested"]);
});

test("t.checkText() adds the hint when there is one", async (t) => {
  const { fake, calls } = recorder();
  TestBase.prototype.checkText.call(fake, "HELLO", '"HELLO"');
  t.check(Object.keys(calls[0]?.[2] ?? {}).toSorted(), ["diff", "hint", "suggested"]);
});

test("t.checkThrows() compares the name, or name and message", async (t) => {
  const { fake, calls } = recorder();
  const boom = (): never => { throw new RangeError("bad 42"); };
  TestBase.prototype.checkThrows.call(fake, boom, "RangeError");
  TestBase.prototype.checkThrows.call(fake, boom, "RangeError: bad «int»");
  TestBase.prototype.checkThrows.call(fake, boom, "TypeError");
  TestBase.prototype.checkThrows.call(fake, () => {}, "RangeError");
  t.check(calls.map(([kind]) => kind), ["pass", "pass", "fail", "fail"]);
});

test("t.checkThrows() puts the stack in the failure", async (t) => {
  const { fake, calls } = recorder();
  TestBase.prototype.checkThrows.call(fake, () => { throw new RangeError("x"); }, "TypeError");
  TestBase.prototype.checkThrows.call(fake, () => {}, "TypeError");
  t.check(Object.keys(calls[0]?.[2] ?? {}).toSorted(), ["diff", "stack", "suggested"]);
  const [kind, message, extra] = calls[1] ?? [];
  t.check({ kind, message, keys: Object.keys(extra ?? {}), expected: (extra?.expected as { value?: unknown } | undefined)?.value }, { kind: "fail", message: "no error thrown", keys: ["expected"], expected: "TypeError" });
});

test("t.checkThrows() settles an async fn through a promise", async (t) => {
  await t.checkThrows(async () => { throw new RangeError("late"); }, "RangeError: late");
});

test("t.checkThrows() fails when nothing throws, even against a wildcard", async (t) => {
  const { fake, calls } = recorder();
  TestBase.prototype.checkThrows.call(fake, () => "fine", "«*»");
  await TestBase.prototype.checkThrows.call(fake, async () => "fine", "«*»");
  t.check(calls.map(([kind, msg]) => [kind, msg]), [["fail", "no error thrown"], ["fail", "no error thrown"]]);
});

test("t.checkText() reports a rejected promise as a failed check", async (t) => {
  const { fake, calls } = recorder();
  await TestBase.prototype.checkText.call(fake, Promise.reject(new Error("boom")), "ready");
  t.check(calls.map(([kind, msg]) => [kind, msg]), [["fail", "the checked promise rejected"]]);
});

test("t.checkText() ignores trailing CRLF line ends", async (t) => {
  const { fake, calls } = recorder();
  TestBase.prototype.checkText.call(fake, "ready\r\n\r\n", "ready");
  t.check(calls.map(([kind]) => kind), ["pass"]);
});

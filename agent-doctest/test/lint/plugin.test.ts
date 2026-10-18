// The ESLint rules for t.check tests, run through ESLint's RuleTester.
// RuleTester reports through describe/it; each runs here as a tap subtest.

import { test, type Test } from "tap";
import { RuleTester } from "eslint";
import plugin from "../../src/lint/plugin.js";

function tester(t: Test): RuleTester {
  RuleTester.describe = (name, fn) => void t.test(name, async () => fn());
  RuleTester.it = (name, fn) => void t.test(name, async () => fn());
  RuleTester.itOnly = RuleTester.it;
  return new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } });
}

void test("check-whole-value flags lossy actual values", async (t) => {
  tester(t).run("check-whole-value", plugin.rules["check-whole-value"], {
    valid: [
      "t.check(list, [1, 2]);",
      "t.check(result, { id: 1 });",
      "t.check(user.name, 'Owner');",
      "t.checkText(JSON.stringify(x), '{}');",
      "other.check(list.length, 2);",
      "t.check(await load(), { ok: true });",
      // A default value is not a boolean test.
      "t.check(opts.name ?? 'default', 'x');",
    ],
    invalid: [
      { code: "t.check(a === b, true);", errors: [{ messageId: "comparison" }] },
      { code: "t.check(list.length, 4);", errors: [{ messageId: "size" }] },
      { code: "t.check(p.includes('a') && p.includes('b'), true);", errors: [{ messageId: "boolean" }] },
      { code: "t.check(map.size, 2);", errors: [{ messageId: "size" }] },
      { code: "t.check(JSON.stringify(x), '{}');", errors: [{ messageId: "json" }] },
      { code: "t.check(!!x, true);", errors: [{ messageId: "boolean" }] },
      { code: "t.check(Boolean(x), true);", errors: [{ messageId: "boolean" }] },
      { code: "t.check(names.includes('a'), true);", errors: [{ messageId: "predicate" }] },
      { code: "tap.check(set.has(1), true);", errors: [{ messageId: "predicate" }] },
    ],
  });
});

void test("no-voided-check flags void in front of a check", async (t) => {
  tester(t).run("no-voided-check", plugin.rules["no-voided-check"], {
    valid: ["await t.check(load(), 1);", "t.check(1, 1);", "void test('x', async () => {});"],
    invalid: [
      { code: "void t.check(load(), 1);", errors: [{ messageId: "voided" }] },
      { code: "void t.checkThrows(() => f(), 'TypeError');", errors: [{ messageId: "voided" }] },
    ],
  });
});

void test("no-tap-assert flags tap's own asserts", async (t) => {
  tester(t).run("no-tap-assert", plugin.rules["no-tap-assert"], {
    valid: ["t.check(x, 1);", "t.error(err);", "t.fail('unreachable');", "other.equal(a, b);", "assert.ok(x);"],
    invalid: [
      { code: "t.equal(a, 1);", errors: [{ messageId: "tapAssert", data: { method: "equal", replacement: "check" } }] },
      { code: "tap.same(list, []);", errors: [{ messageId: "tapAssert", data: { method: "same", replacement: "check" } }] },
      { code: "t.matchOnlyStrict(x, {});", errors: [{ messageId: "tapAssert", data: { method: "matchOnlyStrict", replacement: "check" } }] },
      { code: "t.ok(x);", errors: [{ messageId: "tapAssert", data: { method: "ok", replacement: "check" } }] },
      { code: "await t.rejects(p);", errors: [{ messageId: "tapAssert", data: { method: "rejects", replacement: "checkThrows" } }] },
    ],
  });
});

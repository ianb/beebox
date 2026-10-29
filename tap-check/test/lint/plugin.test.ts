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
      // Optional chaining and await wrap the same lossy value.
      { code: "t.check(errors[0]?.message.includes('Foo'), true);", errors: [{ messageId: "predicate" }] },
      { code: "t.check(result?.items.length, 2);", errors: [{ messageId: "size" }] },
      { code: "t.check(await store.has('k'), true);", errors: [{ messageId: "predicate" }] },
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

void test("no-text-locator flags finding an element by its text", async (t) => {
  tester(t).run("no-text-locator", plugin.rules["no-text-locator"], {
    valid: [
      // Checking the copy is allowed.
      "t.check(button.textContent, 'Save');",
      "t.check([...el.querySelectorAll('button')].map((b) => b.textContent), ['Save']);",
      "const text = el.querySelector('p')?.textContent;",
      // A search by something other than the text.
      "[...el.querySelectorAll('button')].find((b) => b.id === 'bbx-save');",
      // Text read in a nested non-search callback.
      "items.find((x) => x.parts.map((p) => p.textContent).length > 0);",
      // A computed property is not a known text read.
      "items.find((x) => x[key] === 'Save');",
    ],
    invalid: [
      {
        code: "[...el.querySelectorAll('button')].find((b) => b.textContent === 'Save');",
        errors: [{ messageId: "textLocator", data: { property: "textContent", method: "find" } }],
      },
      {
        code: "buttons.filter((b) => b.textContent?.startsWith('Soup')).length;",
        errors: [{ messageId: "textLocator", data: { property: "textContent", method: "filter" } }],
      },
      {
        code: "links.some(function (a) { return a.innerText.trim() === 'notes'; });",
        errors: [{ messageId: "textLocator", data: { property: "innerText", method: "some" } }],
      },
      {
        code: "rows.findIndex((r) => r.textContent.includes('x'));",
        errors: [{ messageId: "textLocator", data: { property: "textContent", method: "findIndex" } }],
      },
    ],
  });
});

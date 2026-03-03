/**
 * Tap integration for check().
 *
 * Adds t.check() to all tap tests via prototype patching.
 * Loaded automatically via `--import` in .taprc node-arg.
 *
 * Usage in tests (no import needed):
 *
 *   test("example", async (t) => {
 *     t.check("actual", "expected");
 *     await t.check(asyncFn(), "expected");
 *   });
 */

import { TestBase } from "@tapjs/core";
import { inspect, type CheckOptions, type CheckResult } from "./check.js";

declare module "@tapjs/core" {
  interface TestBase {
    check(
      actual: unknown,
      expected: string | CheckOptions,
    ): void | Promise<void>;
  }
}

function report(t: TestBase, result: CheckResult): void {
  t.currentAssert = t.check;

  if (result.pass) {
    t.pass(result.message || "check passed");
    return;
  }

  t.fail(result.message, {
    diff: result.diff!,
    found: result.actual,
    wanted: result.expected,
  });
}

TestBase.prototype.check = function tapCheck(actual: unknown, expected: string | CheckOptions): void | Promise<void> {
  const result = inspect(actual, expected);

  if (result instanceof Promise) {
    return result.then((r) => report(this, r));
  }

  report(this, result);
};

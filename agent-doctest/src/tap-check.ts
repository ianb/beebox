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
import { inspect, type CheckOptions, type CheckResult, type Extractions } from "./check.js";

declare module "@tapjs/core" {
  interface TestBase {
    check(
      actual: unknown,
      expected: string | CheckOptions,
    ): Extractions | Promise<Extractions>;
  }
}

function report(t: TestBase, result: CheckResult): Extractions {
  t.currentAssert = t.check;

  if (result.pass) {
    t.pass(result.message || "check passed");
    return result.extractions;
  }

  t.fail(result.message, {
    diff: result.diff!,
    found: result.actual,
    wanted: result.expected,
  });
  return result.extractions;
}

TestBase.prototype.check = function tapCheck(actual: unknown, expected: string | CheckOptions): Extractions | Promise<Extractions> {
  const result = inspect(actual, expected);

  if (result instanceof Promise) {
    return result.then((r) => report(this, r));
  }

  return report(this, result);
};
